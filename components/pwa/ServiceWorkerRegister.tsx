'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker once, after the page has loaded.
 * Only runs in production builds — in dev the SW would cache HMR assets
 * and fight Fast Refresh. Offline behaviour must be tested against a
 * production build (`next build && next start`).
 */
export function ServiceWorkerRegister() {
  // Ask the browser to make this origin's storage persistent so the library
  // (IndexedDB) isn't evicted under storage pressure. SW/Cache-API version bumps
  // never touch IndexedDB; this guards against best-effort eviction. Best-effort
  // and idempotent — granted automatically for installed PWAs.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    navigator.storage.persisted()
      .then((already) => { if (!already) return navigator.storage.persist().then(() => undefined); })
      .catch(() => {});
  }, []);

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
