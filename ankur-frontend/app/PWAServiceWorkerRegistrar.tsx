'use client';

import { useEffect } from 'react';

export default function PWAServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA] Service Worker is not supported in this browser.');
      return;
    }

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        console.log('[PWA] Service Worker registered:', registration.scope);
        window.dispatchEvent(new Event('ankur-sw-ready'));
      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void registerServiceWorker();
      return;
    }

    const onWindowLoad = () => {
      void registerServiceWorker();
    };

    window.addEventListener('load', onWindowLoad);

    return () => {
      window.removeEventListener('load', onWindowLoad);
    };
  }, []);

  return null;
}
