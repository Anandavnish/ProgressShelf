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

async function runTestNotifier() {
  console.log("Starting FCM Test Push sender...");

  try {
    // 0. Diagnostic print of all trackers in the DB
    const { data: trackers, error: trackersError } = await supabase
      .from('trackers')
      .select('*');

    if (trackersError) throw trackersError;

    console.log(`Diagnostic: Found ${trackers ? trackers.length : 0} total trackers in Supabase.`);
    (trackers || []).forEach(row => {
      console.log(`- Tracker "${row.title}": notifyAt = ${row.notify_at}, notified = ${row.notified}, completed = ${row.completed}, notifyPercent = ${row.notify_percent}`);
    });

    // Query all registered FCM tokens
    const { data: tokenRows, error: tokensError } = await supabase
      .from('fcm_tokens')
      .select('*');

    if (tokensError) throw tokensError;

    if (!tokenRows || tokenRows.length === 0) {
      console.log("No registered FCM tokens found in the database. Please visit the app, open Create/Edit modals, and allow notification permissions first!");
      return;
    }

    console.log(`Found ${tokenRows.length} tokens in the database. Sending test notifications...`);

    for (const tokenRow of tokenRows) {
      const fcmToken = tokenRow.token;
      if (!fcmToken) continue;

      const uid = tokenRow.user_id;

      console.log(`Sending test notification to user ${uid} on token ${tokenRow.id.substring(0, 10)}...`);

      const payload = {
        notification: {
          title: "ProgressShelf: Test Alert!",
          body: "Hooray! Your push notification setup is working perfectly! 🎉"
        },
        token: fcmToken
      };

      try {
        await messaging.send(payload);
        console.log(`Test notification successfully sent to user ${uid}!`);
      } catch (fcmError) {
        console.error(`Failed to send test push for user ${uid}:`, fcmError);
      }
    }
  } catch (error) {
    console.error("Test notifier failed:", error);
    process.exit(1);
  }
}

runTestNotifier().then(() => {
  console.log("Test execution completed.");
  process.exit(0);
});
