// Service Worker for keeping connection alive
self.addEventListener('install', event => {
    console.log('Service Worker installed');
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('Service Worker activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    if (event.data.type === 'keepalive') {
        fetch('/ping').catch(err => console.log('Keepalive failed:', err));
    }
});

self.addEventListener('fetch', event => {
    // You can add custom fetch handling here if needed
});