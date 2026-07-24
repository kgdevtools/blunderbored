// Framework-free ring-buffer log store, feeding components/dev/DevConsole.tsx.
// Pure module state + listeners, same shape as lib/leitner.ts / lib/classification.ts —
// no React import, so any lib module can log without a UI dependency.

export interface DevLogEntry {
  ts: number;
  scope: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;

let entries: DevLogEntry[] = [];
const listeners = new Set<(entries: DevLogEntry[]) => void>();

export function devlog(scope: string, message: string, data?: unknown): void {
  entries = [...entries, { ts: Date.now(), scope, message, data }].slice(-MAX_ENTRIES);
  listeners.forEach((l) => l(entries));
}

export function subscribeDevlog(listener: (entries: DevLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function clearDevlog(): void {
  entries = [];
  listeners.forEach((l) => l(entries));
}
