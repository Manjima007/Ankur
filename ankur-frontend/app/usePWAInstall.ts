'use client';

import { useEffect, useMemo, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

declare global {
  interface Window {
    __ankurInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  useEffect(() => {
    const checkInstallState = () => {
      const standaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
      setIsAppInstalled(standaloneMode);
    };

    const hydrateCapturedPrompt = () => {
      if (window.__ankurInstallPrompt) {
        setDeferredPrompt(window.__ankurInstallPrompt);
      }
    };

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      window.__ankurInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const onAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
      window.__ankurInstallPrompt = null;
    };

    checkInstallState();
    hydrateCapturedPrompt();

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('ankur-beforeinstallprompt-ready', hydrateCapturedPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('ankur-beforeinstallprompt-ready', hydrateCapturedPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const isInstallPromptReady = useMemo(
    () => !isAppInstalled && deferredPrompt !== null,
    [deferredPrompt, isAppInstalled]
  );

  return {
    deferredPrompt,
    isAppInstalled,
    isInstallPromptReady,
    clearDeferredPrompt: () => {
      setDeferredPrompt(null);
      window.__ankurInstallPrompt = null;
    },
  };
}
