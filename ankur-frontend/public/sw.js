// Service Worker for ANKUR Blood Emergency Network PWA
const CACHE_NAME = 'ankur-v1';
const URLS_TO_CACHE = [
  '/',
  '/dashboard',
  '/login',
  '/offline.html'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch(() => {
        console.log('Some URLs failed to cache during install');
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          return response || new Response('Offline - content not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      })
  );
});

// Push notification event - CRITICAL for PWA notifications
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.error('Push notification received without data');
    return;
  }

  let notificationData = {
    title: 'CRITICAL: Blood Needed!',
    body: 'An emergency blood request requires your immediate attention.',
    icon: '/ankur_logo.jpeg',
    badge: '/ankur_logo.jpeg',
    tag: 'ankur-emergency',
    requireInteraction: true,
    vibrate: [200, 100, 200],
    actions: [
      {
        action: 'open',
        title: 'View Details',
        icon: '/ankur_logo.jpeg'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };

  try {
    const payload = event.data.json();
    notificationData = {
      ...notificationData,
      title: `CRITICAL: ${payload.blood_type || 'Blood'} Required`,
      body: `A patient at ${payload.hospital || 'Hospital'} needs your help. Tap to see details.`,
      data: {
        emergencyId: payload.emergency_id,
        url: `/dashboard?emergency=${payload.emergency_id}`,
        timestamp: new Date().toISOString()
      }
    };
  } catch (e) {
    console.error('Error parsing push notification data:', e);
    notificationData.data = {
      url: '/dashboard',
      timestamp: new Date().toISOString()
    };
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
      vibrate: notificationData.vibrate,
      data: notificationData.data,
      actions: notificationData.actions
    })
  );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if dashboard window already exists
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification.tag);
});
