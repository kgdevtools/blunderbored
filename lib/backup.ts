'use client';
import { db } from './db';

// Full-database backup/restore as a single JSON file. Works on every platform
// (download on desktop/Android, share-sheet on iOS) — unlike the File System
// Access API, which is desktop-Chromium only. Covers every table so a user can
// move their whole library + positions + concepts + history between devices, or
// keep an off-device copy in case storage is ever cleared.

const TABLES = ['folders', 'games', 'drafts', 'conceptNodes', 'graphEdges', 'challenges', 'savedPositions'] as const;

export interface BackupFile {
  app: 'blunderbored';
  schema: number;       // db.verno at export time
  exportedAt: number;
  data: Record<string, unknown[]>;
}

export async function buildBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { app: 'blunderbored', schema: db.verno, exportedAt: Date.now(), data };
}

// Download (or share, on mobile) the backup as a dated .json file.
export async function downloadBackup(): Promise<void> {
  const backup = await buildBackup();
  const name = `blunderbored-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });

  // iOS Safari has no real download — prefer the share sheet when files are shareable.
  const file = new File([blob], name, { type: 'application/json' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch { /* fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult { ok: boolean; counts?: Record<string, number>; error?: string; }

// Restore from a backup. 'merge' upserts by id (existing rows with the same id are
// overwritten, others kept); 'replace' clears each table first. Additive and safe
// for the live IndexedDB — runs in one transaction.
export async function importBackup(text: string, mode: 'merge' | 'replace' = 'merge'): Promise<ImportResult> {
  let parsed: BackupFile;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'That file isn’t valid JSON.' }; }
  if (parsed?.app !== 'blunderbored' || !parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: 'That isn’t a Blunderbored backup file.' };
  }

  const counts: Record<string, number> = {};
  try {
    await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) {
        const rows = parsed.data[t];
        if (!Array.isArray(rows)) continue;
        if (mode === 'replace') await db.table(t).clear();
        if (rows.length) await db.table(t).bulkPut(rows as never[]);
        counts[t] = rows.length;
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed.' };
  }
  return { ok: true, counts };
}
