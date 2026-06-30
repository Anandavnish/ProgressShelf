// Minimal Service Worker stub for v3.0 (archived Firebase version)
// Delegates all actual caching to the root service worker.
// This file exists only to prevent registration errors.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
