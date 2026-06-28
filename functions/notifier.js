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

// Helper to safely parse any Date/Timestamp/Number into numeric epoch ms
function getEpochMs(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val.toMillis) return val.toMillis();
  if (val.toDate) return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  return Number(val) || 0;
}

async function runNotifier() {
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
  const maxNotifyAt = now + bufferMs;

  console.log(`Running notifier at: ${new Date(now).toISOString()}`);
  console.log(`Looking for trackers due up to ${new Date(maxNotifyAt).toISOString()}`);

  try {
    // Collection group query to check all 'bars' collections
    const barsRef = db.collectionGroup('bars');
    const snapshot = await barsRef
      .where('notifyAt', '<=', maxNotifyAt)
      .get();

    if (snapshot.empty) {
      console.log("No trackers found within the notification window.");
      
      // RUN AUTOMATIC DIAGNOSTIC SCAN
      console.log("--- START AUTOMATIC DATABASE DIAGNOSTIC SCAN ---");
      const totalSnapshot = await barsRef.get();
      console.log(`Total trackers found in entire Firestore: ${totalSnapshot.size}`);
      totalSnapshot.docs.forEach(doc => {
        const d = doc.data();
        console.log(`- Tracker "${d.title}": notifyAt = ${d.notifyAt} (${typeof d.notifyAt}), notified = ${d.notified}, completed = ${d.completed}, notifyPercent = ${d.notifyPercent}`);
      });
      console.log("--- END AUTOMATIC DATABASE DIAGNOSTIC SCAN ---");
      return;
    }

    console.log(`Found ${snapshot.size} candidate documents in query.`);

    for (const doc of snapshot.docs) {
      const barData = doc.data();
      
      // Filter out already notified or completed trackers
      if (barData.notified === true || barData.completed === true) {
        console.log(`Skipping tracker "${barData.title}" because notified=${barData.notified} or completed=${barData.completed}`);
        continue;
      }

      // Extract user ID from document path: users/{uid}/bars/{barId}
      const pathSegments = doc.ref.path.split('/');
      const uid = pathSegments[1];
      const barId = pathSegments[3];

      console.log(`Processing tracker "${barData.title}" (${barId}) for user ${uid}`);

      // 1. Fetch user's FCM tokens
      const tokensRef = db.collection(`users/${uid}/fcmTokens`);
      const tokensSnapshot = await tokensRef.get();
      if (tokensSnapshot.empty) {
        console.log(`No FCM tokens found for user ${uid}. Skipping.`);
        continue;
      }

      console.log(`Found ${tokensSnapshot.size} registered tokens for user ${uid}`);

      let sentAtLeastOne = false;

      for (const tokenDoc of tokensSnapshot.docs) {
        const fcmToken = tokenDoc.data().token;
        if (!fcmToken) {
          continue;
        }

        // 1. Calculate dynamic title and body matching tracker progress & timing
        // 1. Calculate time remaining string
        let timeStr = "";
        if (barData.notifyPercent !== undefined && barData.notifyPercent !== null) {
          timeStr = `${barData.notifyPercent}% of duration left`;
        } else if (barData.deadlineAt && barData.notifyAt) {
          const deadlineMs = getEpochMs(barData.deadlineAt);
          const notifyMs = getEpochMs(barData.notifyAt);
          const diffMins = Math.round((deadlineMs - notifyMs) / 60000);
          if (diffMins >= 60) {
            const hrs = (diffMins / 60).toFixed(1);
            timeStr = `${hrs} hours remaining`;
          } else {
            timeStr = `${diffMins} minutes remaining`;
          }
        }

        // 2. Calculate progress suffix smartly depending on tracker type
        let progressStr = "";
        if (barData.type === "goal" && barData.targetSmallest) {
          const pct = Math.round((barData.currentSmallest / barData.targetSmallest) * 100);
          progressStr = ` • Progress: ${pct}%`;
        } else if (barData.type === "checklist" && barData.targetSmallest) {
          progressStr = ` • Checklist: ${barData.currentSmallest}/${barData.targetSmallest} done`;
        }

        const titleText = `ProgressShelf: ${barData.title}`;
        const bodyText = `${timeStr}${progressStr}`;

        // 2. Send FCM Push Notification
        const payload = {
          notification: {
            title: titleText,
            body: bodyText
          },
          token: fcmToken
        };

        try {
          await messaging.send(payload);
          console.log(`Notification sent successfully to user ${uid} on token ${tokenDoc.id.substring(0, 10)}... for tracker ${barId}`);
          sentAtLeastOne = true;
        } catch (fcmError) {
          console.error(`Failed to send FCM message to user ${uid} on token ${tokenDoc.id.substring(0, 10)}...:`, fcmError);
          
          if (fcmError.code === 'messaging/invalid-registration-token' || 
              fcmError.code === 'messaging/registration-token-not-registered') {
            console.log(`Cleaning up invalid/expired FCM token ${tokenDoc.id.substring(0, 10)}... for user ${uid}`);
            await tokenDoc.ref.delete();
          }
        }
      }

      // 3. Mark as notified in database to prevent double triggers
      if (sentAtLeastOne) {
        await doc.ref.update({ notified: true });
        console.log(`Marked tracker ${barId} as notified.`);
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
