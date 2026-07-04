'use client';
import { useState, useRef, useCallback } from 'react';
import {
  parsePgnGames, analyzeImport, addParsedGames, replaceWithParsed,
  gamesInFolderDeep, downloadPgn,
  type ImportAnalysis, type ImportProgress,
} from '@/lib/library';

// Shared import machinery: file picking, duplicate analysis (exact + fuzzy),
// conflict resolution, live progress and a final report — usable from the
// folder tree, folder rows and the library header alike.

// ─── Icons ────────────────────────────────────────────────────────────────────

export function ImportIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function ExportIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportReport {
  fileName: string;
  fileMB: string;
  parsed: number;
  saved: number;
  replaced: number;
  skippedExact: number;
  skippedFuzzy: number;
  secs: string;
  error?: string;
}

interface PendingConflict {
  analysis: ImportAnalysis;
  folderId: string;
  fileName: string;
  fileMB: string;
  t0: number;
}

export interface FolderImportState {
  importing: boolean;
  progress: { phase: ImportProgress['phase']; pct: number } | null;
  conflict: PendingConflict | null;
  report: ImportReport | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFolderImport() {
  const [state, setState] = useState<FolderImportState>({
    importing: false, progress: null, conflict: null, report: null,
  });
  const lastPaint = useRef(0);

  const onProgress = useCallback((p: ImportProgress) => {
    const now = performance.now();
    if (now - lastPaint.current < 200 && p.done < p.total) return;
    lastPaint.current = now;
    setState((s) => ({
      ...s,
      progress: { phase: p.phase, pct: p.total ? Math.round((100 * p.done) / p.total) : 0 },
    }));
  }, []);

  const importFile = useCallback(async (folderId: string, file: File) => {
    setState({ importing: true, progress: null, conflict: null, report: null });
    const t0 = performance.now();
    const fileMB = (file.size / 1048576).toFixed(2);
    try {
      console.log(`[pgn-import] file "${file.name}" · ${fileMB}MB → folder ${folderId}`);
      const text = await file.text();
      const parsed = parsePgnGames(text);
      if (parsed.length === 0) {
        setState({ importing: false, progress: null, conflict: null, report: {
          fileName: file.name, fileMB, parsed: 0, saved: 0, replaced: 0,
          skippedExact: 0, skippedFuzzy: 0, secs: '0.0', error: 'No valid games found in the file.',
        }});
        return;
      }
      const analysis = await analyzeImport(folderId, parsed, onProgress);
      if (analysis.conflicts.length === 0 && analysis.fuzzy.length === 0) {
        const saved = await addParsedGames(folderId, analysis.fresh, onProgress);
        setState({ importing: false, progress: null, conflict: null, report: {
          fileName: file.name, fileMB, parsed: parsed.length, saved, replaced: 0,
          skippedExact: 0, skippedFuzzy: 0, secs: ((performance.now() - t0) / 1000).toFixed(1),
        }});
      } else {
        setState({ importing: false, progress: null, report: null, conflict: {
          analysis, folderId, fileName: file.name, fileMB, t0,
        }});
      }
    } catch (err) {
      console.error('[pgn-import] failed:', err);
      setState({ importing: false, progress: null, conflict: null, report: {
        fileName: file.name, fileMB, parsed: 0, saved: 0, replaced: 0,
        skippedExact: 0, skippedFuzzy: 0, secs: ((performance.now() - t0) / 1000).toFixed(1),
        error: 'Failed to import — check the file and try again.',
      }});
    }
  }, [onProgress]);

  // 'skip'    → fresh only; both duplicate groups skipped
  // 'replace' → fresh + replace exact matches in place; fuzzy skipped (their
  //             movetext differs — replacing would be guesswork)
  // 'keep'    → import everything as new rows
  const resolveConflict = useCallback(async (action: 'skip' | 'replace' | 'keep') => {
    setState((s) => {
      if (s.conflict) void runResolution(s.conflict, action, onProgress, setState);
      return { ...s, conflict: null, importing: true };
    });
  }, [onProgress]);

  const cancelConflict = useCallback(() => {
    setState((s) => ({ ...s, conflict: null, importing: false, progress: null }));
  }, []);

  const dismissReport = useCallback(() => {
    setState((s) => ({ ...s, report: null }));
  }, []);

  return { state, importFile, resolveConflict, cancelConflict, dismissReport };
}

async function runResolution(
  pending: PendingConflict,
  action: 'skip' | 'replace' | 'keep',
  onProgress: ImportProgressFnLocal,
  setState: (fn: (s: FolderImportState) => FolderImportState) => void,
) {
  const { analysis, folderId, fileName, fileMB, t0 } = pending;
  const { fresh, conflicts, fuzzy } = analysis;
  try {
    const toAdd = action === 'keep'
      ? [...fresh, ...conflicts.map((c) => c.incoming), ...fuzzy.map((c) => c.incoming)]
      : fresh;
    const saved = await addParsedGames(folderId, toAdd, onProgress);
    let replaced = 0;
    if (action === 'replace') {
      for (const c of conflicts) {
        if (c.existingId) { await replaceWithParsed(c.existingId, c.incoming); replaced++; }
      }
    }
    setState(() => ({ importing: false, progress: null, conflict: null, report: {
      fileName, fileMB, parsed: fresh.length + conflicts.length + fuzzy.length,
      saved, replaced,
      skippedExact: action === 'keep' ? 0 : action === 'replace' ? 0 : conflicts.length,
      skippedFuzzy: action === 'keep' ? 0 : fuzzy.length,
      secs: ((performance.now() - t0) / 1000).toFixed(1),
    }}));
  } catch (err) {
    console.error('[pgn-import] failed:', err);
    setState(() => ({ importing: false, progress: null, conflict: null, report: {
      fileName, fileMB, parsed: 0, saved: 0, replaced: 0, skippedExact: 0, skippedFuzzy: 0,
      secs: ((performance.now() - t0) / 1000).toFixed(1),
      error: 'Failed to import — check the file and try again.',
    }}));
  }
}
type ImportProgressFnLocal = (p: ImportProgress) => void;

// ─── Export helper ────────────────────────────────────────────────────────────

export async function exportFolderDeep(folderId: string, folderName: string): Promise<number> {
  const games = await gamesInFolderDeep(folderId);
  if (games.length) downloadPgn(games, folderName);
  return games.length;
}

// ─── UI: overlays for the import lifecycle ────────────────────────────────────

export function ImportOverlays({
  state, onResolve, onCancel, onDismissReport,
}: {
  state: FolderImportState;
  onResolve: (a: 'skip' | 'replace' | 'keep') => void;
  onCancel: () => void;
  onDismissReport: () => void;
}) {
  return (
    <>
      {state.importing && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl px-4 py-3">
            <p className="text-xs font-semibold text-zinc-200 mb-2">
              {state.progress?.phase === 'saving' ? 'Importing games' : 'Checking for duplicates'}
              {state.progress != null && ` · ${state.progress.pct}%`}
            </p>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
                style={{ width: `${state.progress?.pct ?? 3}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {state.conflict && (
        <ConflictModal analysis={state.conflict.analysis} onResolve={onResolve} onCancel={onCancel} />
      )}

      {state.report && (
        <ReportModal report={state.report} onClose={onDismissReport} />
      )}
    </>
  );
}

function ConflictSection({ label, items, tint }: { label: string; items: { existingTitle: string }[]; tint: string }) {
  if (items.length === 0) return null;
  return (
    <div className="px-4 py-1 min-h-0">
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${tint} mb-0.5`}>
        {label} · {items.length}
      </p>
      <ul className="text-xs text-zinc-300 space-y-0.5 max-h-28 overflow-y-auto">
        {items.slice(0, 50).map((c, i) => (
          <li key={i} className="truncate flex gap-1.5">
            <span className="text-zinc-600 tabular-nums shrink-0">{i + 1}.</span>
            <span className="truncate">{c.existingTitle}</span>
          </li>
        ))}
        {items.length > 50 && <li className="text-zinc-500">…and {items.length - 50} more</li>}
      </ul>
    </div>
  );
}

function ConflictModal({
  analysis, onResolve, onCancel,
}: {
  analysis: ImportAnalysis;
  onResolve: (a: 'skip' | 'replace' | 'keep') => void;
  onCancel: () => void;
}) {
  const { fresh, conflicts, fuzzy } = analysis;
  const dupes = conflicts.length + fuzzy.length;
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 shrink-0">
          <h3 className="text-sm font-semibold text-zinc-100">
            {dupes} duplicate{dupes !== 1 ? 's' : ''} found
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            {fresh.length > 0
              ? `${fresh.length} new game${fresh.length !== 1 ? 's' : ''} will import either way.`
              : 'Nothing new to import besides these.'}
          </p>
        </div>

        <div className="overflow-y-auto min-h-0">
          <ConflictSection label="Identical moves" items={conflicts} tint="text-amber-400" />
          <ConflictSection label="Likely duplicates (same players, moves count & result)" items={fuzzy} tint="text-sky-400" />
        </div>

        <div className="px-4 pt-3 pb-4 flex flex-col gap-1.5 shrink-0 border-t border-zinc-700/60 mt-2">
          <button
            onClick={() => onResolve('skip')}
            className="w-full py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold transition-colors"
          >
            Skip duplicates{fresh.length > 0 && ` (import ${fresh.length} new only)`}
          </button>
          {conflicts.length > 0 && (
            <button
              onClick={() => onResolve('replace')}
              className="w-full py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
              title="Only identical-move duplicates are replaced; likely duplicates are skipped"
            >
              Replace identical, skip likely
            </button>
          )}
          <button
            onClick={() => onResolve('keep')}
            className="w-full py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold transition-colors"
          >
            Import everything as copies
          </button>
          <button onClick={onCancel} className="w-full py-1.5 rounded text-zinc-400 hover:text-zinc-200 text-xs transition-colors">
            Cancel import
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const rows: [string, string][] = report.error
    ? []
    : [
        ['Games in file', String(report.parsed)],
        ['Imported', String(report.saved)],
        ...(report.replaced ? [['Replaced', String(report.replaced)] as [string, string]] : []),
        ...(report.skippedExact ? [['Skipped (identical)', String(report.skippedExact)] as [string, string]] : []),
        ...(report.skippedFuzzy ? [['Skipped (likely dup)', String(report.skippedFuzzy)] as [string, string]] : []),
        ['Duration', `${report.secs}s`],
      ];
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-xs px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-sm font-semibold ${report.error ? 'text-red-300' : 'text-zinc-100'}`}>
          {report.error ? 'Import failed' : 'Import complete'}
        </h3>
        <p className="text-[11px] text-zinc-500 truncate mt-0.5">{report.fileName} · {report.fileMB}MB</p>
        {report.error ? (
          <p className="text-xs text-red-300 mt-2">{report.error}</p>
        ) : (
          <div className="mt-2 space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-zinc-400">{k}</span>
                <span className="text-zinc-100 tabular-nums font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={onClose}
          className="mt-3 w-full py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── UI: hidden file input + trigger ──────────────────────────────────────────

export function ImportFileButton({
  disabled, onFile, className, children, title,
}: {
  disabled?: boolean;
  onFile: (f: File) => void;
  className: string;
  children: React.ReactNode;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); ref.current?.click(); }}
        disabled={disabled}
        className={className}
        title={title}
      >
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        // Broad accept so the OS dialog never greys out a valid .pgn; the
        // parser validates content regardless.
        accept=".pgn,.PGN,.txt,application/x-chess-pgn,application/vnd.chess-pgn,application/octet-stream,text/plain"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}
