'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker once, after the page has loaded.
 * Only runs in production builds — in dev the SW would cache HMR assets
 * and fight Fast Refresh. Offline behaviour must be tested against a
 * production build (`next build && next start`).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('[sw] registration failed', err);
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
