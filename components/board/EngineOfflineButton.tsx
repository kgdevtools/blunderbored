'use client';

import { useEffect, useState } from 'react';
import { engineService } from '@/lib/engine';

function DownloadIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const WASM_URL = '/engine/stockfish-18-lite-single.wasm';
// Fallback size (bytes) used to drive the bar when the server doesn't send a
// Content-Length header (e.g. chunked transfer in dev).
const FALLBACK_TOTAL = 7.3 * 1024 * 1024;

type State = 'checking' | 'idle' | 'downloading' | 'cached' | 'error';

async function isWasmCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return Boolean(await caches.match(WASM_URL));
  } catch {
    return false;
  }
}

/**
 * Compact, inline control (lives in the engine header) that lets the user
 * pre-download (warm) the Stockfish wasm so analysis works offline.
 *
 * The download streams the wasm with a reader so we can render a real filling
 * progress bar from the bytes received. The fetch passes through the service
 * worker's cache-first handler, so draining the stream also primes the cache.
 * Afterwards we initialize the engine to warm the worker JS and confirm it
 * actually starts.
 */
export function EngineOfflineButton() {
  const [state, setState] = useState<State>('checking');
  const [progress, setProgress] = useState(0); // 0..1

  useEffect(() => {
    let active = true;
    isWasmCached().then((cached) => {
      if (active) setState(cached ? 'cached' : 'idle');
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleDownload() {
    setState('downloading');
    setProgress(0);
    try {
      const resp = await fetch(WASM_URL);
      if (!resp.ok || !resp.body) throw new Error('fetch failed');

      const headerTotal = Number(resp.headers.get('content-length'));
      const total = headerTotal > 0 ? headerTotal : FALLBACK_TOTAL;
      const reader = resp.body.getReader();
      let received = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value?.length ?? 0;
        // Cap at 0.99 until we confirm completion so the bar never sticks at 100%.
        setProgress(Math.min(received / total, 0.99));
      }
      setProgress(1);

      // Warm the worker JS and verify the engine genuinely starts.
      await engineService.initialize().catch(() => {});
      setState((await isWasmCached()) ? 'cached' : 'error');
    } catch {
      setState((await isWasmCached()) ? 'cached' : 'error');
    }
  }

  if (state === 'checking') return null;

  // Shared shape, matched to ENGINE_BTN so it's the same size as ON / Show Lines
  // (same padding/text, no rounding so it sits flush in the segmented bar).
  const pill =
    'flex items-center gap-1.5 shrink-0 px-2 py-1 text-xs font-medium leading-none tracking-tight transition-colors';

  if (state === 'cached') {
    return (
      <span
        className={`${pill} bg-green-700 text-green-50`}
        title="Stockfish is saved on this device — analysis works offline"
      >
        <CheckIcon />
        Offline ready
      </span>
    );
  }

  if (state === 'downloading') {
    const pct = Math.round(progress * 100);
    return (
      <span
        className={`${pill} cursor-wait bg-blue-700 text-blue-50`}
        title="Downloading Stockfish for offline use…"
      >
        <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-blue-900">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-blue-200 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="w-8 text-right tabular-nums">{pct}%</span>
      </span>
    );
  }

  // idle or error
  const isError = state === 'error';
  return (
    <button
      onClick={handleDownload}
      title={
        isError
          ? 'Download failed — click to retry'
          : 'Download Stockfish (7.3 MB) so engine analysis works without internet'
      }
      className={`${pill} ${
        isError
          ? 'bg-red-700 hover:bg-red-600 text-red-50'
          : 'bg-amber-700 hover:bg-amber-600 text-amber-50'
      }`}
    >
      <DownloadIcon />
      {isError ? 'Retry' : 'Save offline'}
    </button>
  );
}
