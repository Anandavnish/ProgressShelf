import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

// Initialize firebase-admin using service account from env
const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountStr) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(serviceAccountStr);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("Failed to parse or initialize Firebase Admin cert:", error);
  process.exit(1);
}

const messaging = admin.messaging();

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || process.env.PS_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PS_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL / PS_URL or SUPABASE_SERVICE_ROLE_KEY / PS_SECRET_KEY environment variable.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runNotifier() {
  const now = new Date();
  const maxNotifyAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  console.log(`Running notifier at: ${now.toISOString()}`);
  console.log(`Looking for trackers due up to ${maxNotifyAt}`);

  try {
    // Query trackers
    const { data: trackers, error: trackersError } = await supabase
      .from('trackers')
      .select('*')
      .lte('notify_at', maxNotifyAt)
      .eq('notified', false)
      .eq('completed', false);

    if (trackersError) throw trackersError;

    if (!trackers || trackers.length === 0) {
      console.log("No trackers found within the notification window.");
      
      // RUN DIAGNOSTIC SCAN
      console.log("--- START AUTOMATIC DATABASE DIAGNOSTIC SCAN ---");
      const { data: allTrackers } = await supabase.from('trackers').select('*');
      console.log(`Total trackers found in entire Supabase: ${allTrackers ? allTrackers.length : 0}`);
      (allTrackers || []).forEach(row => {
        console.log(`- Tracker "${row.title}": notifyAt = ${row.notify_at}, notified = ${row.notified}, completed = ${row.completed}, notifyPercent = ${row.notify_percent}`);
      });
      console.log("--- END AUTOMATIC DATABASE DIAGNOSTIC SCAN ---");
      return;
    }

    console.log(`Found ${trackers.length} candidate documents in query.`);

    for (const tracker of trackers) {
      console.log(`Processing tracker "${tracker.title}" (${tracker.id}) for user ${tracker.user_id}`);

      // Fetch user's FCM tokens
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
      let sentAtLeastOne = false;

      for (const tokenRow of tokenRows) {
        const fcmToken = tokenRow.token;
        if (!fcmToken) continue;

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

        const payload = {
          notification: {
            title: titleText,
            body: bodyText
          },
          token: fcmToken
        };

        try {
          await messaging.send(payload);
          console.log(`Notification sent successfully to user ${tracker.user_id} for tracker ${tracker.id}`);
          sentAtLeastOne = true;
        } catch (fcmError) {
          console.error(`Failed to send FCM message to user ${tracker.user_id}:`, fcmError);
          const errorCode = fcmError.code || fcmError.errorInfo?.code || "";
          
          if (
            errorCode === 'messaging/invalid-registration-token' || 
            errorCode === 'messaging/registration-token-not-registered' ||
            errorCode.includes('not-registered')
          ) {
            console.log(`Cleaning up invalid/expired FCM token...`);
            await supabase
              .from('fcm_tokens')
              .delete()
              .eq('id', tokenRow.id);
          }
        }
      }

      // Mark tracker as notified
      if (sentAtLeastOne) {
        await supabase
          .from('trackers')
          .update({ notified: true })
          .eq('id', tracker.id);
        console.log(`Marked tracker ${tracker.id} as notified.`);
      }
    }
  } catch (error) {
    console.error("Notifier execution failed:", error);
    process.exit(1);
  }
}

runNotifier().then(() => {
  console.log("Notifier execution completed.");
  process.exit(0);
});
