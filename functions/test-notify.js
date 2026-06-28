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

async function runTestNotifier() {
  console.log("Starting FCM Test Push sender...");

  try {
    // 0. Diagnostic print of all bars in the DB
    const barsRef = db.collectionGroup('bars');
    const barsSnapshot = await barsRef.get();
    console.log(`Diagnostic: Found ${barsSnapshot.size} total bars in Firestore.`);
    barsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`- Bar "${data.title}": notifyAt = ${data.notifyAt} (${typeof data.notifyAt}), notified = ${data.notified}, completed = ${data.completed}, notifyPercent = ${data.notifyPercent}`);
    });
    // Query all 'fcmTokens' collections across all users
    const tokensRef = db.collectionGroup('fcmTokens');
    const snapshot = await tokensRef.get();

    if (snapshot.empty) {
      console.log("No registered FCM tokens found in the database. Please visit the app, open Create/Edit modals, and allow notification permissions first!");
      return;
    }

    console.log(`Found ${snapshot.size} tokens in the database. Sending test notifications...`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const fcmToken = data.token;
      if (!fcmToken) continue;

      // Extract user ID from document path: users/{uid}/fcmTokens/{token}
      const pathSegments = doc.ref.path.split('/');
      const uid = pathSegments[1];

      console.log(`Sending test notification to user ${uid} on token ${doc.id.substring(0, 10)}...`);

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
