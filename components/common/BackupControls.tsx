'use client';
import { useRef, useState } from 'react';
import { downloadBackup, importBackup } from '@/lib/backup';

// Back up / restore the entire local database (library, positions, concepts,
// graph, challenge history) to a JSON file. The on-device copy already survives
// app updates (the service worker never touches IndexedDB, and storage is
// persisted); this is the off-device safety net + cross-device transfer.
export function BackupControls({ className = '' }: { className?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };

  const onExport = async () => {
    setBusy(true);
    try { await downloadBackup(); flash('Backup ready ✓'); }
    catch { flash('Backup failed'); }
    finally { setBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm('Restore from this backup?\nItems with the same id are overwritten; everything else is kept.')) return;
    setBusy(true);
    try {
      const res = await importBackup(await f.text(), 'merge');
      flash(res.ok ? 'Restored ✓' : (res.error ?? 'Import failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button onClick={onExport} disabled={busy} className="px-2.5 py-1 rounded-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-medium">Back up</button>
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="px-2.5 py-1 rounded-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-medium">Restore</button>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      {msg && <span className="text-xs text-emerald-400">{msg}</span>}
    </div>
  );
}
