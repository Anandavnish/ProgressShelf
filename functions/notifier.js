import admin from 'firebase-admin';

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

const db = admin.firestore();
const messaging = admin.messaging();

async function runNotifier() {
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
  const minNotifyAt = now - bufferMs;
  const maxNotifyAt = now + bufferMs;

  console.log(`Running notifier at: ${new Date(now).toISOString()}`);
  console.log(`Looking for trackers due between ${new Date(minNotifyAt).toISOString()} and ${new Date(maxNotifyAt).toISOString()}`);

  try {
    // Collection group query to check all 'bars' collections
    const barsRef = db.collectionGroup('bars');
    const snapshot = await barsRef
      .where('notifyAt', '>=', minNotifyAt)
      .where('notifyAt', '<=', maxNotifyAt)
      .get();

    if (snapshot.empty) {
      console.log("No trackers found within the notification window.");
      return;
    }

    console.log(`Found ${snapshot.size} candidate documents in query.`);

    for (const doc of snapshot.docs) {
      const barData = doc.data();
      
      // Filter out already notified or completed trackers
      if (barData.notified === true || barData.completed === true) {
        continue;
      }

      // Extract user ID from document path: users/{uid}/bars/{barId}
      const pathSegments = doc.ref.path.split('/');
      const uid = pathSegments[1];
      const barId = pathSegments[3];

      console.log(`Processing tracker "${barData.title}" (${barId}) for user ${uid}`);

      // 1. Fetch user's FCM token
      const tokenDoc = await db.doc(`users/${uid}/fcmToken/current`).get();
      if (!tokenDoc.exists) {
        console.log(`No FCM token found for user ${uid}. Skipping.`);
        continue;
      }

      const fcmToken = tokenDoc.data().token;
      if (!fcmToken) {
        console.log(`FCM token for user ${uid} is empty. Skipping.`);
        continue;
      }

      // 2. Send FCM Push Notification
      const payload = {
        notification: {
          title: `ProgressShelf Alert`,
          body: `Your tracker "${barData.title}" is approaching its deadline!`
        },
        token: fcmToken
      };

      try {
        await messaging.send(payload);
        console.log(`Notification sent successfully to user ${uid} for tracker ${barId}`);

        // 3. Mark as notified in database to prevent double triggers
        await doc.ref.update({ notified: true });
        console.log(`Marked tracker ${barId} as notified.`);
      } catch (fcmError) {
        console.error(`Failed to send FCM message for user ${uid}:`, fcmError);
        
        if (fcmError.code === 'messaging/invalid-registration-token' || fcmError.code === 'messaging/registration-token-not-registered') {
          console.log(`Cleaning up invalid FCM token for user ${uid}`);
          await doc.ref.update({ notified: true }); // Prevent trying again
        }
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
