
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleAuth } from 'npm:google-auth-library'

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

    const serviceAccountStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!serviceAccountStr) {
      throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
    }
    const serviceAccount = JSON.parse(serviceAccountStr);

    // Get OAuth2 Access Token
    const auth = new GoogleAuth({
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;
    if (!accessToken) {
      throw new Error("Failed to generate Google OAuth2 access token.");
    }

    const now = new Date();
    const maxNotifyAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    console.log(`Running notifier at: ${now.toISOString()}`);
    console.log(`Looking for trackers due up to ${maxNotifyAt}`);

    // Query trackers
    const { data: trackers, error: trackersError } = await supabase
      .from('trackers')
      .select('*')
      .lte('notify_at', maxNotifyAt)
      .eq('notified', false)
      .eq('completed', false);

    if (trackersError) {
      throw trackersError;
    }

    if (!trackers || trackers.length === 0) {
      console.log("No trackers found within the notification window.");
      return new Response(JSON.stringify({ message: "No notifications to send" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      });
    }

    console.log(`Found ${trackers.length} candidate documents in query.`);

    for (const tracker of trackers) {
      console.log(`Processing tracker "${tracker.title}" (${tracker.id}) for user ${tracker.user_id}`);

      // Smart Notification Delivery — No Stale/Late Pushes (Rule 1)
      const nowTime = Date.now();
      const notifyAtMs = new Date(tracker.notify_at).getTime();
      if (notifyAtMs < nowTime - 10 * 60 * 1000) {
        console.log(`Tracker "${tracker.title}" (${tracker.id}) notification is older than 10 minutes (due ${tracker.notify_at}). Marking as notified but skipping delivery.`);
        await supabase
          .from('trackers')
          .update({ notified: true })
          .eq('id', tracker.id);
        continue;
      }

      // Fetch FCM tokens
      const { data: tokenRows, error: tokensError } = await supabase
        .from('fcm_tokens')
        .select('*')
        .eq('user_id', tracker.user_id);

      if (tokensError) {
        console.error(`Error fetching FCM tokens for user ${tracker.user_id}:`, tokensError);
        continue;
      }

      if (!tokenRows || tokenRows.length === 0) {
        console.log(`No FCM tokens found for user ${tracker.user_id}. Skipping.`);
        continue;
      }

      console.log(`Found ${tokenRows.length} registered tokens for user ${tracker.user_id}`);

      const sendPromises = tokenRows.map(async (tokenRow) => {
        const fcmToken = tokenRow.token;
        if (!fcmToken) return false;

        // Calculate time remaining string
        let timeStr = "";
        if (tracker.notify_percent !== undefined && tracker.notify_percent !== null) {
          timeStr = `${tracker.notify_percent}% of duration left`;
        } else if (tracker.deadline_at && tracker.notify_at) {
          const deadlineMs = new Date(tracker.deadline_at).getTime();
          const notifyMs = new Date(tracker.notify_at).getTime();
          const diffMins = Math.round((deadlineMs - notifyMs) / 60000);
          if (diffMins >= 60) {
            const hrs = (diffMins / 60).toFixed(1);
            timeStr = `${hrs} hours remaining`;
          } else {
            timeStr = `${diffMins} minutes remaining`;
          }
        }

        // Calculate progress suffix
        let progressStr = "";
        if (tracker.type === "goal" && tracker.target_smallest) {
          const pct = Math.round((tracker.current_smallest / tracker.target_smallest) * 100);
          progressStr = ` • Progress: ${pct}%`;
        } else if (tracker.type === "checklist" && tracker.target_smallest) {
          progressStr = ` • Checklist: ${tracker.current_smallest}/${tracker.target_smallest} done`;
        }

        const titleText = `ProgressShelf: ${tracker.title}`;
        const bodyText = `${timeStr}${progressStr}`;

        // Send FCM Push Notification via HTTP v1 API
        const projectId = serviceAccount.project_id || 'progressshelf';
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        
        const fcmPayload = {
          message: {
            token: fcmToken,
            notification: {
              title: titleText,
              body: bodyText
            }
          }
        };

        try {
          const fcmResponse = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(fcmPayload)
          });

          const fcmResult = await fcmResponse.json();

          if (fcmResponse.ok) {
            console.log(`Notification sent successfully to token ${fcmToken.substring(0, 10)}... for user ${tracker.user_id}`);
            return true;
          } else {
            console.error(`FCM send error response for token ${fcmToken.substring(0, 10)}...:`, fcmResult);
            // Check for invalid tokens
            const errorCode = fcmResult?.error?.status || "";
            const errorMessage = fcmResult?.error?.message || "";
            
            if (
              fcmResponse.status === 404 || 
              fcmResponse.status === 410 ||
              errorCode === 'UNREGISTERED' ||
              errorMessage.includes('not-registered') ||
              errorMessage.includes('NotRegistered')
            ) {
              console.log(`Cleaning up invalid/expired FCM token ${tokenRow.token.substring(0, 10)}... for user ${tracker.user_id}`);
              await supabase
                .from('fcm_tokens')
                .delete()
                .eq('id', tokenRow.id);
            }
            return false;
          }
        } catch (fcmError) {
          console.error(`Fetch exception sending FCM to token ${fcmToken.substring(0, 10)}... for user ${tracker.user_id}:`, fcmError);
          return false;
        }
      });

      const results = await Promise.allSettled(sendPromises);
      let sentAtLeastOne = false;
      results.forEach((result, i) => {
        const tokenVal = tokenRows[i]?.token?.substring(0, 10);
        if (result.status === "fulfilled") {
          console.log(`FCM send result for token ${tokenVal}...: ${result.value ? 'SUCCESS' : 'FAILED'}`);
          if (result.value) {
            sentAtLeastOne = true;
          }
        } else {
          console.error(`FCM promise rejected for token ${tokenVal}...:`, result.reason);
        }
      });

      // Mark tracker as notified to prevent double triggers
      if (sentAtLeastOne) {
        const { error: updateError } = await supabase
          .from('trackers')
          .update({ notified: true })
          .eq('id', tracker.id);

        if (updateError) {
          console.error(`Error marking tracker ${tracker.id} as notified:`, updateError);
        } else {
          console.log(`Marked tracker ${tracker.id} as notified.`);
        }
      }
    }

    return new Response(JSON.stringify({ message: "Completed processing notifications" }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    console.error("Notifier execution failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
