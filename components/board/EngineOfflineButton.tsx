'use client';

import { useEffect, useState } from 'react';
import { engineService } from '@/lib/engine';

const WASM_URL = '/engine/stockfish-18-lite-single.wasm';
const WARM_TIMEOUT_MS = 30_000;

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
 * Lets the user pre-download (warm) the Stockfish wasm so analysis works on a
 * first-ever offline session. Initializing the engine spawns the worker, which
 * fetches the wasm through the service worker's cache-first handler — so once
 * this completes, the engine is cached for offline use. A timeout guards
 * against the worker stalling so the button never hangs indefinitely.
 */
export function EngineOfflineButton() {
  const [state, setState] = useState<State>('checking');

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
    try {
      await Promise.race([
        engineService.initialize(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), WARM_TIMEOUT_MS),
        ),
      ]);
      setState((await isWasmCached()) ? 'cached' : 'idle');
    } catch {
      setState((await isWasmCached()) ? 'cached' : 'error');
    }
  }

  if (state === 'checking') return null;

  if (state === 'cached') {
    return (
      <p className="text-[10px] tracking-tight text-green-600 leading-none mt-1">
        ✓ Engine saved for offline use
      </p>
    );
  }

  const label =
    state === 'downloading'
      ? 'Saving engine… (7.3 MB)'
      : state === 'error'
        ? 'Download failed — retry'
        : '⤓ Save engine for offline';

  return (
    <button
      onClick={handleDownload}
      disabled={state === 'downloading'}
      className={[
        'mt-1 text-[10px] tracking-tight leading-none underline-offset-2 transition-colors',
        state === 'downloading'
          ? 'text-zinc-500 animate-pulse cursor-wait'
          : state === 'error'
            ? 'text-red-500 hover:text-red-400 underline'
            : 'text-zinc-500 hover:text-zinc-300 underline',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
