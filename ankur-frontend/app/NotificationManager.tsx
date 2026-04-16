'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './LanguageProvider';
import { usePWAInstall } from './usePWAInstall';

interface NotificationPermissionState {
  isSupported: boolean;
  permission: NotificationPermission | null;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export default function NotificationManager() {
  const { t } = useI18n();
  const { deferredPrompt, isAppInstalled, isInstallPromptReady, clearDeferredPrompt } = usePWAInstall();
  const [state, setState] = useState<NotificationPermissionState>({
    isSupported: false,
    permission: null,
    isSubscribed: false,
    isLoading: false,
    error: null,
  });
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installHelp, setInstallHelp] = useState<string | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  const backendBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://127.0.0.1:8000';
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || '';

  // Check notification support and registration status on mount
  useEffect(() => {
    const initializeNotifications = async () => {
      try {
        // Check if browser supports Service Workers and push notifications
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          setState((prev) => ({
            ...prev,
            isSupported: false,
            error: 'Your browser does not support push notifications',
          }));
          return;
        }

        setState((prev) => ({ ...prev, isSupported: true }));

        // Check current permission state
        const permission = Notification.permission;
        setState((prev) => ({ ...prev, permission }));

        // Check if already subscribed
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setState((prev) => ({
          ...prev,
          isSubscribed: !!subscription,
        }));
      } catch (error) {
        console.error('Error initializing notifications:', error);
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to initialize notifications',
        }));
      }
    };

    initializeNotifications();

    const refreshSubscriptionState = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setState((prev) => ({ ...prev, isSubscribed: !!subscription }));
      } catch (error) {
        console.error('Error checking subscription after SW registration:', error);
      }
    };

    window.addEventListener('ankur-sw-ready', refreshSubscriptionState);

    return () => {
      window.removeEventListener('ankur-sw-ready', refreshSubscriptionState);
    };
  }, []);

  useEffect(() => {
    const helpMessage =
      t('Install prompt not ready. Open this in Chrome/Edge, avoid Incognito, then refresh once and wait 3-5 seconds.');

    const installHelpTimer = window.setTimeout(() => {
      if (!isAppInstalled && !isInstallPromptReady) {
        setInstallHelp(helpMessage);
      }
    }, 5000);
    
    if (isInstallPromptReady) {
      setInstallHelp(null);
      setInstallError(null);
    }

    return () => {
      window.clearTimeout(installHelpTimer);
    };
  }, [isAppInstalled, isInstallPromptReady, t]);

  const handleInstallApp = async () => {
    setInstallError(null);
    setShowInstallGuide(false);

    if (!deferredPrompt) {
      setShowInstallGuide(true);
      return;
    }

    setIsInstallingApp(true);

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      clearDeferredPrompt();

      if (choiceResult.outcome === 'accepted') {
        setInstallHelp(null);
      } else {
        setInstallError(t('Install was dismissed. Click Install ANKUR App again when you are ready.'));
      }
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Unable to show install prompt');
    } finally {
      setIsInstallingApp(false);
    }
  };

  const handleEnableNotifications = async () => {
    if (!state.isSupported) {
      alert('Push notifications are not supported on this device');
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request permission
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        setState((prev) => ({
          ...prev,
          isLoading: false,
            error: t('Notifications blocked. Check browser settings.'),
          permission,
        }));
        return;
      }

      setState((prev) => ({ ...prev, permission }));

      // Get VAPID public key from environment
      if (!vapidPublicKey) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: t('Push key is not configured yet'),
        }));
        return;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
      });

      console.log('Push subscription successful:', subscription);

      // Send subscription to backend
      const token = localStorage.getItem('ankur_token');
      if (!token) {
        throw new Error('Please login again to enable notifications');
      }

      let userId =
        localStorage.getItem('ankur_user_id') ||
        sessionStorage.getItem('ankur_user_id') ||
        localStorage.getItem('userId') ||
        sessionStorage.getItem('userId');

      if (!userId) {
        const meResponse = await fetch(`${backendBaseUrl}/api/me`, {
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!meResponse.ok) {
          throw new Error('Unable to load profile for notification setup');
        }
        const me = await meResponse.json();
        userId = String(me.id || '');
        if (userId) {
          localStorage.setItem('ankur_user_id', userId);
          sessionStorage.setItem('ankur_user_id', userId);
        }
      }

      if (!userId) {
        throw new Error('User ID not found');
      }

      const response = await fetch(`${backendBaseUrl}/api/notifications/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          user_id: userId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save subscription');
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
      }));

      console.log('Subscription saved to backend successfully');
    } catch (error) {
      console.error('Error enabling notifications:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to enable notifications',
      }));
    }
  };

  const handleDisableNotifications = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe from push
        await subscription.unsubscribe();

        // Notify backend to remove subscription
        const token = localStorage.getItem('ankur_token');
        const userId =
          localStorage.getItem('ankur_user_id') ||
          sessionStorage.getItem('ankur_user_id') ||
          localStorage.getItem('userId') ||
          sessionStorage.getItem('userId');
        if (userId) {
          await fetch(`${backendBaseUrl}/api/notifications/unsubscribe`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              user_id: userId,
              endpoint: subscription.endpoint,
            }),
          }).catch((error) => console.error('Error notifying backend of unsubscribe:', error));
        }
      }

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
      }));

      console.log('Push notifications disabled');
    } catch (error) {
      console.error('Error disabling notifications:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to disable notifications',
      }));
    }
  };

  // Utility function to convert VAPID key from base64
  function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray.buffer as ArrayBuffer;
  }

  if (!state.isSupported && isAppInstalled) {
    return null;
  }

  const isNotificationEnabled = state.permission === 'granted' && state.isSubscribed;

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      {!isAppInstalled && (
        <button
          onClick={handleInstallApp}
          disabled={isInstallingApp}
          className="whitespace-nowrap rounded-xl bg-linear-to-r from-[#9D1720]/85 to-[#c84a54]/75 px-3 py-2 text-xs font-medium text-white shadow-sm transition-all duration-300 hover:from-[#8a151d]/90 hover:to-[#b83f49]/80 disabled:opacity-50 sm:px-4 sm:text-sm"
          title={
            isInstallPromptReady
              ? t('Install ANKUR App')
              : t('Waiting for browser install eligibility checks')
          }
        >
          {isInstallingApp ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t('Installing...')}
            </span>
          ) : (
            <span className="flex items-center gap-2">{t('Install ANKUR App')}</span>
          )}
        </button>
      )}

      {!isAppInstalled && !isInstallPromptReady && installHelp && !installError && (
        <div className="max-w-xs rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-700 sm:max-w-sm">
          {installHelp}
        </div>
      )}

      {!isAppInstalled && showInstallGuide && (
        <div className="max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm sm:max-w-sm">
          <p className="font-semibold text-[#9D1720]">Install steps</p>
          <p className="mt-1">Chrome: menu (⋮), then Install ANKUR...</p>
          <p>Edge: click the install icon in the address bar (computer + down arrow).</p>
          <p>If no icon appears: menu (...), then Save and share, then Install this site as an app.</p>
          <button
            type="button"
            onClick={() => setShowInstallGuide(false)}
            className="mt-2 rounded-md bg-[#f3f4f6] px-2 py-1 text-[11px] font-semibold text-[#374151]"
          >
            Close
          </button>
        </div>
      )}

      {state.isSupported && (
      <button
        onClick={isNotificationEnabled ? handleDisableNotifications : handleEnableNotifications}
        disabled={state.isLoading || !vapidPublicKey}
        className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium shadow-sm transition-all duration-300 sm:px-4 sm:text-sm ${
          isNotificationEnabled
            ? 'bg-linear-to-r from-emerald-600/85 to-emerald-400/75 text-white hover:from-emerald-700/90 hover:to-emerald-500/80 disabled:opacity-50'
            : 'bg-linear-to-r from-white/95 to-rose-50/85 text-[#9D1720] border border-[#9D1720]/35 hover:from-rose-50/90 hover:to-rose-100/90 disabled:opacity-50'
        }`}
        title={
          !vapidPublicKey
            ? t('Push key is not configured yet')
            : state.permission === 'denied'
            ? t('Notifications blocked. Check browser settings.')
            : isNotificationEnabled
              ? 'Disable emergency alerts'
              : 'Enable emergency alerts'
        }
      >
        {state.isLoading ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {isNotificationEnabled ? t('Disabling...') : t('Enabling...')}
          </span>
        ) : (
          <span className="flex items-center gap-2">{isNotificationEnabled ? t('Alerts Active') : t('Enable Alerts')}</span>
        )}
      </button>
      )}

      {installError && (
        <div className="max-w-xs rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-700 sm:max-w-sm">
          {installError}
        </div>
      )}

      {state.error && (
        <div className="max-w-xs rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-700 sm:max-w-sm">
          {state.error}
        </div>
      )}

      {state.permission === 'denied' && (
        <div className="max-w-xs rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-700 sm:max-w-sm">
          {t('Notifications blocked. Check browser settings.')}
        </div>
      )}
    </div>
  );
}
