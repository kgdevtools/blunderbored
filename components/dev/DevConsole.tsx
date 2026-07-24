'use client';
import { useEffect, useRef, useState } from 'react';
import { subscribeDevlog, clearDevlog, type DevLogEntry } from '@/lib/devlog';

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatData(data: unknown): string | null {
  if (data === undefined) return null;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// Terminal-style dev console: hidden behind a toggle icon, sticky to the
// bottom of the screen. Subscribes to lib/devlog.ts directly — no props
// needed, so it can be dropped into any page.
export function DevConsole() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DevLogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeDevlog(setEntries), []);

  useEffect(() => {
    if (open) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries.length, open]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-3 right-3 z-50 w-9 h-9 rounded-full bg-zinc-800 border border-zinc-600 text-green-400 font-mono text-xs flex items-center justify-center shadow-lg hover:bg-zinc-700"
        title={open ? 'Hide dev console' : 'Show dev console'}
      >
        &gt;_
      </button>

      {open && (
        <div className="fixed bottom-0 left-0 right-0 z-40 h-[40vh] flex flex-col bg-black border-t border-green-900 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-green-900 shrink-0">
            <span className="font-mono text-xs text-green-400">Dev Console · {entries.length} entries</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => clearDevlog()}
                className="font-mono text-xs text-green-600 hover:text-green-400"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="font-mono text-xs text-green-600 hover:text-green-400"
              >
                ×
              </button>
            </div>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
            {entries.length === 0 ? (
              <p className="text-green-800">No log entries yet.</p>
            ) : (
              entries.map((e, i) => {
                const dataStr = formatData(e.data);
                return (
                  <div key={i} className="mb-1">
                    <span className="text-green-700">{formatTs(e.ts)}</span>{' '}
                    <span className="text-green-500">[{e.scope}]</span>{' '}
                    <span className="text-green-400">{e.message}</span>
                    {dataStr && (
                      <pre className="text-green-700 whitespace-pre-wrap pl-4">{dataStr}</pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
