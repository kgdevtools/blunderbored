'use client';
// Direct Lichess API import — Single URL / Batch (by theme) — for the Puzzle
// Set tab's "Import from Lichess" action. Layout ported from lca-auth's
// academy lesson-puzzle importer, backed by this app's own
// app/api/puzzles/lichess/{batch,[puzzleId]} routes (LICHESS_API_TOKEN).

import { useState } from 'react';
import { Chessboard } from '@zoendev/react-chessboard';
import { devlog } from '@/lib/devlog';

export interface ImportedLichessPuzzle {
  lichessId: string;
  fen: string;
  pgn: string;
  solution: string[]; // SAN
  themes: string[];
  rating: number | null;
  orientation: 'white' | 'black';
}

interface BatchPreview extends ImportedLichessPuzzle {
  editSolution: string;
  editThemes: string;
  editOrientation: 'white' | 'black';
  removed?: boolean;
}

const BATCH_THEMES: { group: string; options: { value: string; label: string }[] }[] = [
  { group: 'Openings', options: [
    { value: 'caroKann', label: 'Caro-Kann' }, { value: 'slavDefense', label: 'Slav Defense' },
    { value: 'frenchDefense', label: 'French Defense' }, { value: 'sicilianDefense', label: 'Sicilian Defense' },
    { value: 'italianGame', label: 'Italian Game' }, { value: 'spanishGame', label: 'Spanish Game' },
    { value: 'kingsGambit', label: "King's Gambit" }, { value: 'queensGambit', label: "Queen's Gambit" },
    { value: 'englishOpening', label: 'English Opening' }, { value: 'scotchGame', label: 'Scotch Game' },
    { value: 'viennaGame', label: 'Vienna Game' }, { value: 'kingIndianDefense', label: "King's Indian" },
    { value: 'nimzoIndianDefense', label: 'Nimzo-Indian' }, { value: 'dutchDefense', label: 'Dutch Defense' },
  ]},
  { group: 'Tactics', options: [
    { value: 'fork', label: 'Fork' }, { value: 'pin', label: 'Pin' }, { value: 'skewer', label: 'Skewer' },
    { value: 'discoveredAttack', label: 'Discovered Attack' }, { value: 'doubleCheck', label: 'Double Check' },
    { value: 'deflection', label: 'Deflection' }, { value: 'hangingPiece', label: 'Hanging Piece' },
    { value: 'trappedPiece', label: 'Trapped Piece' }, { value: 'attraction', label: 'Attraction' },
    { value: 'interference', label: 'Interference' }, { value: 'clearance', label: 'Clearance' },
    { value: 'overloading', label: 'Overloading' }, { value: 'sacrifice', label: 'Sacrifice' },
    { value: 'quietMove', label: 'Quiet Move' },
  ]},
  { group: 'Mates', options: [
    { value: 'mateIn1', label: 'Mate in 1' }, { value: 'mateIn2', label: 'Mate in 2' },
    { value: 'mateIn3', label: 'Mate in 3' }, { value: 'mateIn4', label: 'Mate in 4' },
    { value: 'mateIn5', label: 'Mate in 5' }, { value: 'backRankMate', label: 'Back Rank Mate' },
    { value: 'smotheredMate', label: 'Smothered Mate' }, { value: 'arabianMate', label: 'Arabian Mate' },
    { value: 'hookMate', label: 'Hook Mate' }, { value: 'anastasiasMate', label: "Anastasia's Mate" },
    { value: 'epauletteMate', label: 'Epaulette Mate' },
  ]},
  { group: 'Endgame', options: [
    { value: 'endgame', label: 'Endgame (General)' }, { value: 'pawnEndgame', label: 'Pawn Endgame' },
    { value: 'rookEndgame', label: 'Rook Endgame' }, { value: 'queenEndgame', label: 'Queen Endgame' },
    { value: 'bishopEndgame', label: 'Bishop Endgame' }, { value: 'knightEndgame', label: 'Knight Endgame' },
  ]},
  { group: 'Strategy', options: [
    { value: 'advancedPawn', label: 'Advanced Pawn' }, { value: 'attackingF2F7', label: 'Attack on f2/f7' },
    { value: 'capturingDefender', label: 'Removing Defender' }, { value: 'exposedKing', label: 'Exposed King' },
    { value: 'kingsideAttack', label: 'Kingside Attack' }, { value: 'queensideAttack', label: 'Queenside Attack' },
    { value: 'crushing', label: 'Crushing' }, { value: 'defensiveMove', label: 'Defensive Move' },
  ]},
  { group: 'Special', options: [
    { value: 'enPassant', label: 'En Passant' }, { value: 'promotion', label: 'Promotion' },
    { value: 'zugzwang', label: 'Zugzwang' }, { value: 'xRayAttack', label: 'X-Ray Attack' },
    { value: 'coercion', label: 'Coercion' },
  ]},
];

const DIFFICULTIES = ['easiest', 'easier', 'normal', 'harder', 'hardest', 'mixed'] as const;

function LichessKnightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="5.89 5.91 68.19 68.14" width={size} height={size} style={{ flexShrink: 0 }}>
      <path fill="#bfad1e" d="m37.656 74.009c-4.8354-0.36436-9.6886-1.699-13.955-3.8378-3.4383-1.7236-6.4517-3.92-9.0933-6.628-7.0896-7.2676-10.055-17.334-8.1548-27.684 1.5646-8.5227 6.1202-15.614 12.927-20.122 6.4164-4.2497 14.836-6.2637 24.632-5.8922l2.1764 0.082493 0.71448-0.46162c2.8371-1.8331 5.781-2.7675 10.74-3.409 1.3469-0.17424 1.5334-0.18309 1.7288-0.082031 0.24019 0.1242 0.31608 0.26074 0.31608 0.56864 0 0.11136-0.4595 2.1736-1.0211 4.5828-1.0078 4.3233-1.0194 4.3838-0.89332 4.6483 0.07031 0.14737 0.50749 0.95627 0.97159 1.7975 0.4641 0.84128 0.96793 1.7581 1.1196 2.0374 0.15171 0.2793 1.5664 2.8457 3.1439 5.7031 1.5774 2.8574 3.8363 6.9531 5.0198 9.1016 3.237 5.8763 4.9952 9.0631 5.4255 9.8339 0.50792 0.90969 0.63287 1.4871 0.62769 2.9005-0.0037 0.91614-0.03691 1.2203-0.20664 1.8732-0.86524 3.328-3.915 6.1562-8.8068 8.167-1.1079 0.45544-2.3332 0.85827-2.6106 0.85827-0.25397 0-0.38898-0.15415-1.129-1.2891-1.3352-2.0478-3.9112-4.9986-6.541-7.4929-1.5045-1.427-2.0154-1.8499-5.6466-4.6744-4.6142-3.5891-6.2759-5.0009-8.48-7.2045-3.9949-3.9941-5.887-7.2765-6.1716-10.706-0.08995-1.0838 0.18839-2.7981 0.50585-3.1155 0.41619-0.41619 1.1662-0.01476 1.064 0.56953-0.02694 0.15422-0.06902 0.65348-0.09347 1.1095-0.03663 0.68284-0.01606 0.94126 0.11629 1.4648 0.63768 2.5217 3.041 5.405 7.3949 8.8718 2.0126 1.6025 3.381 2.5855 7.6172 5.4717 5.194 3.5387 5.6984 3.9377 8.1641 6.4574 2.308 2.3586 3.494 3.8269 4.3474 5.3817 0.22404 0.4082 0.4147 0.75294 0.42366 0.7661 0.03949 0.05785 1.0174-0.24498 1.6091-0.49822 2.5156-1.0767 4.1441-3.2328 4.6375-6.1402l0.12817-0.75512-2.3219-3.8933c-1.2771-2.1413-2.9627-4.9656-3.7459-6.2761-2.1258-3.5573-10.258-17.183-10.81-18.114-0.26416-0.44496-0.4989-0.88442-0.52166-0.97656-0.0251-0.10167 0.35524-1.304 0.96742-3.0582 1.1589-3.3208 1.1586-3.0658 0.0028-2.7713-1.7885 0.45585-3.5267 1.2861-7.057 3.3706-0.71397 0.4216-1.2524 0.68973-1.385 0.68973-0.11934 0-0.6484-0.06957-1.1757-0.15451-2.4739-0.39872-5.0621-0.55615-7.5603-0.45987-5.5228 0.21286-10.604 1.8776-14.844 4.8634-4.762 3.3535-8.8329 8.8527-10.751 14.524-2.991 8.8413-0.68144 19.066 6.03 26.696 4.991 5.6739 11.828 9.2927 19.487 10.315 1.578 0.21053 4.5386 0.28823 6.1195 0.16059 7.0509-0.56924 13.253-3.3262 18.267-8.1207 0.79159-0.75686 0.94438-0.87009 1.174-0.87009 0.61003 0 0.83436 0.48111 0.49462 1.0608-0.76303 1.302-2.9045 3.6393-4.5382 4.9532-4.0237 3.236-9.0858 5.1841-14.924 5.7434-1.1092 0.10625-4.5728 0.1453-5.655 0.06376z" />
    </svg>
  );
}

function parseLichessId(url: string): string | null {
  const m = url.match(/lichess\.org\/(?:training|puzzle)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

const pill = (active: boolean) =>
  `text-xs px-2 py-0.5 rounded-sm border capitalize transition-colors ${
    active ? 'bg-zinc-100 text-zinc-900 border-zinc-100 font-semibold' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
  }`;

interface LichessImportModalProps {
  onClose: () => void;
  onImport: (puzzles: ImportedLichessPuzzle[]) => void;
}

export function LichessImportModal({ onClose, onImport }: LichessImportModalProps) {
  const [tab, setTab] = useState<'single' | 'batch'>('single');

  // Single URL
  const [lichessUrl, setLichessUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Batch
  const [batchThemes, setBatchThemes] = useState<string[]>([]);
  const [batchMixed, setBatchMixed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(BATCH_THEMES.slice(1).map((g) => g.group)),
  );
  const [difficulty, setDifficulty] = useState<typeof DIFFICULTIES[number]>('normal');
  const [nb, setNb] = useState(10);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<BatchPreview[]>([]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const handleSingleImport = async () => {
    const id = parseLichessId(lichessUrl);
    if (!id) { setImportError('Invalid Lichess puzzle URL'); return; }
    setIsImporting(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/puzzles/lichess/${id}`);
      if (!res.ok) {
        devlog('lichess-import', `single import: HTTP ${res.status} from /api/puzzles/lichess/${id}`, { status: res.status });
      }
      const data = await res.json().catch((err) => {
        devlog('lichess-import', 'single import: response was not JSON (likely a routing 404, not an API error)', { status: res.status, error: String(err) });
        throw new Error(`Import route returned ${res.status} — check that the Lichess API routes are deployed`);
      });
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      onImport([{
        lichessId: data.lichessId, fen: data.fen, pgn: data.pgn, solution: data.solution,
        themes: data.themes, rating: data.rating, orientation: data.orientation,
      }]);
      onClose();
    } catch (err) {
      devlog('lichess-import', 'single import failed', { error: String(err) });
      setImportError(err instanceof Error ? err.message : 'Failed to import puzzle');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFetchBatch = async () => {
    setIsFetching(true);
    setFetchError(null);
    try {
      const themesParam = batchMixed ? 'mixed' : batchThemes.join(',');
      const url = `/api/puzzles/lichess/batch?themes=${encodeURIComponent(themesParam)}&nb=${nb}&difficulty=${difficulty}`;
      const res = await fetch(url);
      if (!res.ok) {
        devlog('lichess-import', `batch fetch: HTTP ${res.status} from ${url}`, { status: res.status });
      }
      const data = await res.json().catch((err) => {
        devlog('lichess-import', 'batch fetch: response was not JSON (likely a routing 404, not an API error)', { status: res.status, error: String(err) });
        throw new Error(`Batch route returned ${res.status} — check that the Lichess API routes are deployed`);
      });
      if (!res.ok) throw new Error(data.error ?? `Batch fetch failed (${res.status})`);
      const puzzles: ImportedLichessPuzzle[] = data.puzzles ?? [];
      setPreviews(puzzles.map((p) => ({
        ...p,
        editSolution: p.solution.join(' '),
        editThemes: p.themes.join(', '),
        editOrientation: p.orientation,
      })));
    } catch (err) {
      devlog('lichess-import', 'batch fetch failed', { error: String(err) });
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch batch puzzles');
    } finally {
      setIsFetching(false);
    }
  };

  const updatePreview = (i: number, patch: Partial<BatchPreview>) => {
    setPreviews((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const activePreviews = previews.filter((p) => !p.removed);

  const handleBatchImport = () => {
    onImport(activePreviews.map((p) => ({
      lichessId: p.lichessId, fen: p.fen, pgn: p.pgn,
      solution: p.editSolution.trim().split(/\s+/).filter(Boolean),
      themes: p.editThemes.split(',').map((t) => t.trim()).filter(Boolean),
      rating: p.rating, orientation: p.editOrientation,
    })));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-800 rounded-lg w-full max-w-lg max-h-[92vh] overflow-hidden shadow-2xl border border-zinc-700 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 shrink-0">
          <LichessKnightIcon size={18} />
          <h2 className="text-sm font-semibold text-zinc-100">Import from Lichess</h2>
        </div>

        <div className="mx-4 mt-3 mb-1 flex gap-1 p-1 bg-zinc-900 rounded-sm shrink-0">
          {(['single', 'batch'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-xs py-1.5 rounded-sm font-medium transition-colors ${tab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t === 'single' ? 'Single URL' : 'Batch Import'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
          {tab === 'single' && (
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Lichess puzzle URL</label>
              <input
                value={lichessUrl}
                onChange={(e) => setLichessUrl(e.target.value)}
                placeholder="https://lichess.org/training/abc123"
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded-sm px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
              />
              {importError && <p className="text-xs text-red-400">{importError}</p>}
            </div>
          )}

          {tab === 'batch' && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-500">Themes</label>
                  <div className="flex items-center gap-2">
                    {!batchMixed && batchThemes.length > 0 && (
                      <button onClick={() => setBatchThemes([])} className="text-[10px] text-zinc-500 hover:text-zinc-300">Clear</button>
                    )}
                    <button onClick={() => setBatchMixed((v) => !v)} className={pill(batchMixed)}>Mixed</button>
                  </div>
                </div>
                <div className={batchMixed ? 'opacity-40 pointer-events-none space-y-1' : 'space-y-1'}>
                  {BATCH_THEMES.map((g) => {
                    const isCollapsed = collapsedGroups.has(g.group);
                    const activeInGroup = g.options.filter((o) => batchThemes.includes(o.value)).length;
                    return (
                      <div key={g.group} className="border border-zinc-700 rounded-sm overflow-hidden">
                        <button onClick={() => toggleGroup(g.group)} className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-700/40 transition-colors">
                          <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">{g.group}</span>
                          <div className="flex items-center gap-2">
                            {activeInGroup > 0 && <span className="text-[10px] font-medium text-zinc-400">{activeInGroup} selected</span>}
                            <span className={`text-zinc-500 text-xs transition-transform inline-block ${!isCollapsed ? 'rotate-90' : ''}`}>›</span>
                          </div>
                        </button>
                        {!isCollapsed && (
                          <div className="flex flex-wrap gap-1 px-2.5 pb-2.5">
                            {g.options.map((o) => {
                              const isActive = batchThemes.includes(o.value);
                              return (
                                <button
                                  key={o.value}
                                  onClick={() => setBatchThemes((prev) => (prev.includes(o.value) ? prev.filter((t) => t !== o.value) : [...prev, o.value]))}
                                  className={pill(isActive)}
                                >
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Difficulty</label>
                  <div className="flex flex-wrap gap-1">
                    {DIFFICULTIES.map((d) => (
                      <button key={d} onClick={() => setDifficulty(d)} className={pill(difficulty === d)}>{d}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Count</label>
                  <input
                    type="number" min={1} max={50} value={nb}
                    onChange={(e) => setNb(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-20 h-8 bg-zinc-900 border border-zinc-700 rounded-sm px-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                onClick={handleFetchBatch}
                disabled={isFetching || (!batchMixed && batchThemes.length === 0)}
                className="w-full py-1.5 rounded-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {isFetching ? 'Fetching…' : 'Fetch Puzzles'}
              </button>
              {fetchError && <p className="text-xs text-red-400">{fetchError}</p>}

              {activePreviews.length > 0 && (
                <div className="space-y-2">
                  {previews.map((p, i) => p.removed ? null : (
                    <div key={p.lichessId} className="border border-zinc-700 rounded-sm p-2.5">
                      <div className="flex gap-2.5">
                        <div className="w-[62%] space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold text-zinc-200">#{p.lichessId}</span>
                              {p.rating != null && <span className="text-xs text-zinc-500">★ {p.rating}</span>}
                            </div>
                            <button onClick={() => updatePreview(i, { removed: true })} className="text-zinc-500 hover:text-red-400 text-sm">✕</button>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Solution</label>
                            <input
                              value={p.editSolution}
                              onChange={(e) => updatePreview(i, { editSolution: e.target.value })}
                              className="w-full h-7 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-sm px-1.5 text-zinc-200 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Themes</label>
                            <input
                              value={p.editThemes}
                              onChange={(e) => updatePreview(i, { editThemes: e.target.value })}
                              className="w-full h-7 text-xs bg-zinc-900 border border-zinc-700 rounded-sm px-1.5 text-zinc-200 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                        <div className="w-[38%] shrink-0">
                          <Chessboard position={p.fen} boardOrientation={p.editOrientation} arePiecesDraggable={false} areArrowsAllowed={false} customBoardStyle={{ borderRadius: '4px' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700 shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 rounded-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm transition-colors">Cancel</button>
          {tab === 'single' && (
            <button
              onClick={handleSingleImport}
              disabled={isImporting || !lichessUrl.trim()}
              className="px-3 py-1.5 rounded-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {isImporting ? 'Importing…' : 'Import'}
            </button>
          )}
          {tab === 'batch' && activePreviews.length > 0 && (
            <button onClick={handleBatchImport} className="px-3 py-1.5 rounded-sm bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
              Add {activePreviews.length} puzzle{activePreviews.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
