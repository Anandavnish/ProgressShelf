// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCDV0zHk8kjcXgLFd5zIpREmwxuMJed7FQ",
  authDomain: "progressshelf.firebaseapp.com",
  projectId: "progressshelf",
  storageBucket: "progressshelf.firebasestorage.app",
  messagingSenderId: "311368772862",
  appId: "1:311368772862:web:4806e3f2a41455c2b289af",
  measurementId: "G-VK2HK44LT1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title || "ProgressShelf Alert";
  const notificationOptions = {
    body: payload.notification.body || "",
    icon: './logo.svg',
    badge: './favicon.svg'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
