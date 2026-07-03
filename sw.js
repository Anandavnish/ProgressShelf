const CACHE_NAME = 'progressshelf-cache-v64';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'dashboard.html',
  'index.css',
  'app.js',
  'auth.js',
  'db.js',
  'login.js',
  'supabase-config.js',
  'favicon.svg',
  'logo.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.json'
];

// Install Event - Caching basic app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Cleaning up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serve cached assets immediately, fetch updates in background (Stale-While-Revalidate)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Do not intercept or cache Firebase, Firestore, Supabase, Google Auth, or other external APIs
  if (
    url.includes('firebase') || 
    url.includes('firestore') || 
    url.includes('supabase.co') ||
    url.includes('googleapis') || 
    url.includes('googleusercontent') ||
    url.includes('gstatic.com')
  ) {
    return;
  }

  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        // Fetch new version from network in parallel
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200 && url.startsWith(self.location.origin)) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch((err) => {
          // If offline and navigate request fails, return offline fallback from cache
          if (event.request.mode === 'navigate') {
            return caches.match('./', { ignoreSearch: true });
          }
          console.warn('[Service Worker] Fetch failed, using cache:', err);
        });

        // Serve cached version immediately if available, otherwise wait for network
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// --- FCM Push Notification Integration ---
try {
  importScripts('firebase-config.js');
} catch (e) {
  console.warn('[sw.js] Could not load firebase-config.js, FCM will be disabled.');
}

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

let messaging = null;
if (self.firebaseConfig && self.firebaseConfig.apiKey) {
  try {
    firebase.initializeApp(self.firebaseConfig);
    messaging = firebase.messaging();
  } catch (err) {
    console.error('[sw.js] Firebase initialization failed:', err);
  }
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('[sw.js] Received background message ', payload);
  });
}

self.addEventListener('push', event => {
  let data = { title: 'ProgressShelf', body: 'You have a deadline alert.' };
  try {
    if (event.data) {
      const json = event.data.json();
      // Extract title and body from nested notification or data properties
      if (json.notification) {
        data.title = json.notification.title || data.title;
        data.body = json.notification.body || data.body;
      } else if (json.data && json.data.title) {
        data.title = json.data.title || data.title;
        data.body = json.data.body || data.body;
      } else if (json.title) {
        data.title = json.title || data.title;
        data.body = json.body || data.body;
      }
      
      const tagVal = (json.data && json.data.tag) || json.tag;
      if (tagVal) data.tag = tagVal;
    }
  } catch (e) {}
  
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/ProgressShelf/icon-192.png',
      badge: '/ProgressShelf/favicon.svg',
      tag: data.tag || 'progressshelf-alert',
      renotify: true,
      requireInteraction: false,
      data: { url: '/ProgressShelf/dashboard.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('ProgressShelf') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/ProgressShelf/dashboard.html');
      }
    })
  );
});

// Message Event - Skip Waiting on command
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
