const CACHE_NAME = 'progressshelf-cache-v9';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'dashboard.html',
  'index.css',
  'app.js',
  'auth.js',
  'db.js',
  'firebase-config.js',
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

// Fetch Event - Serve cached assets when offline, otherwise fetch
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Do not intercept or cache Firebase, Firestore, Google Auth, or other external APIs
  if (
    url.includes('firebase') || 
    url.includes('firestore') || 
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
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Fallback to network
      return fetch(event.request).then((response) => {
        // Cache new successful GET requests from the same origin
        if (response.status === 200 && url.startsWith(self.location.origin)) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        }
        return response;
      }).catch((err) => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./', { ignoreSearch: true });
        }
        console.error('[Service Worker] Fetch failed:', err);
      });
    })
  );
});
