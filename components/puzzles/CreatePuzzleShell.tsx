'use client';
// Puzzle Create page: always lands on an editable board (starting position by
// default), paired with a 4-tab panel (Workouts / Puzzle Set / Moves / Edit).
// An explicit Setup ⇄ Solution toggle tells the board how to behave — there's
// no separate "edit position" action, since Setup mode already IS position
// editing:
//  - Setup:    BoardEditor (free piece placement, same component /blunderable
//              uses) edits `setupFen` — the puzzle's starting position.
//  - Solution: normal legal-move dragging (useBoardGame — same hook /board
//              uses) builds the solution line from that position.
// Switching Setup→Solution re-roots the live game at setupFen (if it
// changed) and jumps to the Edit tab; switching back snapshots the current
// root back into setupFen. The current puzzle draft auto-saves (debounced)
// whenever the solution line or its metadata changes, so a preview card
// shows up in the Puzzle Set tab without an explicit save.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { nanoid } from 'nanoid';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, Piece } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import type { Square } from 'chess.js';
import { useBoardGame } from '@/hooks/useBoardGame';
import { BoardTransport } from '@/components/board/BoardControls';
import { BoardEditor } from '@/components/blunderable/BoardEditor';
import { db, type Puzzle } from '@/lib/db';
import { getMainLine, toPgnWithVariations } from '@/lib/gameTree';
import { buildSolutionSans, sanTextToUci, applyUci } from '@/lib/puzzleSolution';
import { devlog } from '@/lib/devlog';
import { WorkoutsTab } from './WorkoutsTab';
import { PuzzleSetTab } from './PuzzleSetTab';
import { PuzzleMovesTab } from './PuzzleMovesTab';
import { PuzzleEditTab } from './PuzzleEditTab';
import type { ImportedLichessPuzzle } from './LichessImportModal';

interface DraftMeta {
  note: string;
  themes: string[];
}
const EMPTY_DRAFT: DraftMeta = { note: '', themes: [] };
const BOARD_MAX = 540; // slightly larger than the previous 480, same responsive sizing logic
const AUTOSAVE_DELAY_MS = 500;

// Numbered movetext ("1. e4 e5 2. Nf3") for a SAN line starting from `fen`.
function sansToMovetext(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let moveNum = parseInt(parts[5] || '1', 10);
  let turn: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w';
  const bits: string[] = [];
  sans.forEach((san, i) => {
    if (turn === 'w') bits.push(`${moveNum}. ${san}`);
    else if (i === 0) bits.push(`${moveNum}... ${san}`);
    else bits.push(san);
    if (turn === 'b') moveNum++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  return bits.join(' ');
}

// Minimal PGN (FEN/SetUp headers + movetext) so a fen+SAN-line can be loaded
// in one shot via game.loadPgn — the only safe way to bulk-inject moves, since
// useBoardGame's makeMove reads `current` from closure state and can't be
// called in a tight synchronous loop.
function fenAndSansToPgn(fen: string, sans: string[]): string {
  return `[FEN "${fen}"]\n[SetUp "1"]\n\n${sansToMovetext(fen, sans)} *`;
}

function importedToPuzzle(p: ImportedLichessPuzzle): Puzzle {
  // Lichess convention: fen is BEFORE the opponent's setup move (solution[0]);
  // this app's convention: fen is the position the SOLVER moves from, with
  // the opponent's move kept separately as leadingMoveUci/San for the "what
  // just happened" highlight.
  const allUci = sanTextToUci(p.fen, p.solution.join(' '));
  const leadingUci = allUci[0];
  const solutionLineUci = allUci.slice(1);
  const leadingApplied = leadingUci ? applyUci(p.fen, leadingUci) : null;
  return {
    id: nanoid(),
    fen: leadingApplied?.fen ?? p.fen,
    solutionUci: solutionLineUci[0] ?? '',
    solutionLineUci,
    kind: 'avoid-blunder',
    severity: 'blunder',
    winPctLoss: 0,
    createdAt: Date.now(),
    note: `Lichess #${p.lichessId}${p.rating != null ? ` · ★${p.rating}` : ''}`,
    themes: p.themes.length ? p.themes : undefined,
    leadingMoveUci: leadingUci,
    leadingMoveSan: leadingApplied?.san,
  };
}

interface CreatePuzzleShellProps {
  initialOpenSetId?: string;
}

export function CreatePuzzleShell({ initialOpenSetId }: CreatePuzzleShellProps) {
  const router = useRouter();
  const game = useBoardGame();

  const [boardMode, setBoardMode] = useState<'setup' | 'solution'>('setup');
  const [setupFen, setSetupFen] = useState(DEFAULT_POSITION);
  const [flipped, setFlipped] = useState(false);
  const [activeTab, setActiveTab] = useState<'workouts' | 'set' | 'moves' | 'edit'>('workouts');

  const [openSetId, setOpenSetId] = useState<string | null>(initialOpenSetId ?? null);
  const [openSetName, setOpenSetName] = useState('');
  const [puzzlesInSet, setPuzzlesInSet] = useState<Puzzle[]>([]);

  const [editingPuzzleId, setEditingPuzzleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMeta>(EMPTY_DRAFT);
  // Surfaced in the Edit tab whenever a pasted FEN/PGN/solution fails to
  // parse, or a Dexie write throws — so bad input shows a message instead of
  // crashing the app (chess.js's Chess constructor throws on malformed FEN,
  // and that used to propagate straight into a render-phase useMemo).
  const [editError, setEditError] = useState<string | null>(null);

  const reloadSetPuzzles = useCallback((setId: string) => {
    db.workoutSets.get(setId).then((set) => {
      if (!set) return;
      setOpenSetName(set.name);
      db.puzzles.bulkGet(set.puzzleIds).then((ps) => setPuzzlesInSet(ps.filter((p): p is Puzzle => !!p)));
    });
  }, []);

  useEffect(() => { if (openSetId) reloadSetPuzzles(openSetId); }, [openSetId, reloadSetPuzzles]);

  // ── Board sizing ─────────────────────────────────────────────────────────
  // One ref around the whole board column (both setup and play modes) so the
  // measured width is consistent regardless of mode — BoardEditor's maxBoard,
  // the play-mode Chessboard, and the panel's height (to match the board,
  // same convention as /board and PuzzleGeneratorShell) all read from it.
  const columnRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const apply = (w: number) => { if (w > 0) setBoardWidth(Math.min(Math.floor(w), BOARD_MAX)); };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Setup ⇄ Solution toggle ───────────────────────────────────────────────
  const resetDraft = useCallback(() => {
    setEditingPuzzleId(null);
    setDraft(EMPTY_DRAFT);
  }, []);

  const switchToSetup = useCallback(() => {
    setSetupFen(game.root.fen);
    setBoardMode('setup');
  }, [game]);

  // Re-roots the live game at setupFen only if it actually changed, so
  // glancing at Setup and flipping straight back doesn't wipe an in-progress
  // solution. [game] trips the React Compiler's preserve-manual-memoization
  // check (it treats a hook return's fields as ref-like); game.root.fen is
  // genuinely the only reactive read here.
  const switchToSolution = useCallback(() => {
    if (setupFen !== game.root.fen) {
      const ok = game.loadFen(setupFen);
      if (!ok) {
        setEditError("That setup position isn't a valid FEN — fix it before switching to Solution mode.");
        return;
      }
    }
    setEditError(null);
    setBoardMode('solution');
    setActiveTab('edit');
  }, [setupFen, game.root.fen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Found via Playwright testing: this used to only reset the *cosmetic*
  // setupFen/draft state, leaving useBoardGame's actual tree (root/current)
  // untouched. switchToSolution only re-roots the tree when setupFen differs
  // from game.root.fen — and since every "fresh start" used the same
  // DEFAULT_POSITION string, that check silently no-opped, so the board
  // (and whose turn it was) carried over from whatever the previous puzzle
  // ended on. Concretely: puzzle 2 built right after puzzle 1 would save a
  // corrupted solution mixing both puzzles' moves — which is also why a
  // correct checkmate could get rejected as "wrong" when solving: the saved
  // solution genuinely wasn't what was played. game.loadFen() here forces
  // the real reset directly, instead of relying on that lazy comparison.
  const handleNewPuzzle = useCallback(() => {
    setSetupFen(DEFAULT_POSITION);
    game.loadFen(DEFAULT_POSITION);
    resetDraft();
    setEditError(null);
    setBoardMode('setup');
    setActiveTab('edit');
  }, [resetDraft, game]);

  // "+ New Workout" (Workouts tab) — name + time allocation are decided once,
  // up front, for the whole set (not per-puzzle — see PuzzleEditTab).
  const handleNewSet = useCallback(async (name: string, timerSeconds: number | null) => {
    const setId = nanoid();
    try {
      await db.workoutSets.add({
        id: setId,
        name: name.trim() || `Puzzle set — ${new Date().toLocaleDateString()}`,
        puzzleIds: [],
        createdAt: Date.now(),
        timerSeconds: timerSeconds ?? undefined,
      });
    } catch (err) {
      devlog('puzzles', 'handleNewSet: failed to create workout set', { error: String(err) });
      setEditError('Failed to create the new workout — try again.');
      return;
    }
    setOpenSetId(setId);
    setSetupFen(DEFAULT_POSITION);
    game.loadFen(DEFAULT_POSITION);
    resetDraft();
    setEditError(null);
    setBoardMode('setup');
    setActiveTab('edit');
  }, [resetDraft, game]);

  const handleOpenSet = useCallback((id: string) => {
    setOpenSetId(id);
    setActiveTab('set');
  }, []);

  // ── Live move-making (play mode) — click or drag, auto-queen promotion ───
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const legalTargets = useMemo(() => {
    if (!selectedSq) return new Set<string>();
    try {
      return new Set(new Chess(game.currentFen).moves({ square: selectedSq, verbose: true }).map((m) => m.to));
    } catch {
      return new Set<string>();
    }
  }, [selectedSq, game.currentFen]);

  const handleSquareClick = useCallback((sq: CbSquare, piece: Piece | undefined) => {
    const square = sq as Square;
    const mover = game.currentFen.split(' ')[1] as 'w' | 'b';
    if (selectedSq) {
      if (legalTargets.has(square)) { game.makeMove(selectedSq, square, 'q'); setSelectedSq(null); return; }
      setSelectedSq(piece && piece[0] === mover ? square : null);
      return;
    }
    if (piece && piece[0] === mover) setSelectedSq(square);
  }, [selectedSq, legalTargets, game]);

  const handlePieceDrop = useCallback((from: CbSquare, to: CbSquare): boolean => {
    setSelectedSq(null);
    return game.makeMove(from as Square, to as Square, 'q');
  }, [game]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (selectedSq) {
      styles[selectedSq] = { backgroundColor: 'rgba(250, 204, 21, 0.45)' };
      for (const sq of legalTargets) styles[sq] = { backgroundColor: 'rgba(34, 197, 94, 0.30)' };
    }
    return styles;
  }, [selectedSq, legalTargets]);

  const canPrev = game.current.parent !== null;
  const canNext = game.current.children.length > 0;

  // ── Solution ⇄ board sync ────────────────────────────────────────────────
  // game.root mutates in place on addMove (see useBoardGame) — game.tokens
  // (driven by its treeVersion) is what actually changes reference, so it has
  // to be a dep here even though this memo doesn't read it directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mainLine = useMemo(() => getMainLine(game.root), [game.root, game.tokens]);
  const solutionSans = useMemo(() => mainLine.slice(1).map((n) => n.move!.san), [mainLine]);
  const solutionText = useMemo(() => sansToMovetext(game.root.fen, solutionSans), [game.root.fen, solutionSans]);

  const applySolutionText = useCallback((text: string) => {
    try {
      const uci = sanTextToUci(game.root.fen, text);
      const { sans } = buildSolutionSans(game.root.fen, uci);
      const ok = game.loadPgn(fenAndSansToPgn(game.root.fen, sans));
      if (!ok) throw new Error('board rejected the resulting move list');
      setEditError(null);
    } catch (err) {
      devlog('puzzles', 'applySolutionText: failed to parse solution text', { text, error: String(err) });
      setEditError("Couldn't read that solution — check the move format (SAN like \"Qxf7\" or UCI like \"f7f8q\") and try again.");
    }
  }, [game]);

  // ── Save / update the puzzle currently being authored ────────────────────
  // The core persist step, parameterised so it can serve three callers:
  // the explicit Save button (switches to the Puzzle Set tab), the debounced
  // autosave below (silent), and FEN import (position-only, no solution yet
  // — the whole point being a card shows up immediately, before any moves).
  const persistPuzzle = useCallback(async (opts: {
    switchTab: boolean;
    fen?: string;
    solutionLineUci?: string[];
  }) => {
    const fen = opts.fen ?? game.root.fen;
    const solutionLineUci = opts.solutionLineUci
      ?? mainLine.slice(1).map((n) => n.move!.from + n.move!.to + (n.move!.promotion ?? ''));
    const id = editingPuzzleId ?? nanoid();
    const puzzle: Puzzle = {
      id,
      fen,
      solutionUci: solutionLineUci[0] ?? '',
      solutionLineUci,
      kind: 'avoid-blunder',
      severity: 'blunder',
      winPctLoss: 0,
      createdAt: Date.now(),
      note: draft.note || undefined,
      themes: draft.themes.length ? draft.themes : undefined,
      annotationPgn: opts.fen ? undefined : toPgnWithVariations(game.root),
    };

    const isNew = !editingPuzzleId;
    try {
      await db.puzzles.put(puzzle);
      if (isNew) {
        await db.leitnerBoxes.put({ puzzleId: puzzle.id, box: 0, lastSessionNum: 0, rightCount: 0, wrongCount: 0 });
        setEditingPuzzleId(puzzle.id);
      }

      let setId = openSetId;
      if (!setId) {
        setId = nanoid();
        await db.workoutSets.add({ id: setId, name: `Puzzle set — ${new Date().toLocaleDateString()}`, puzzleIds: [puzzle.id], createdAt: Date.now() });
        setOpenSetId(setId);
      } else if (isNew) {
        const set = await db.workoutSets.get(setId);
        if (set && !set.puzzleIds.includes(puzzle.id)) {
          await db.workoutSets.update(setId, { puzzleIds: [...set.puzzleIds, puzzle.id] });
        }
      }

      reloadSetPuzzles(setId);
      if (opts.switchTab) setActiveTab('set');
      return { setId, puzzleId: puzzle.id };
    } catch (err) {
      devlog('puzzles', 'persistPuzzle: Dexie write failed', { puzzleId: puzzle.id, error: String(err) });
      setEditError('Failed to save the puzzle to the database — try again.');
      return null;
    }
  }, [mainLine, game.root, editingPuzzleId, draft, openSetId, reloadSetPuzzles]);

  const handleSavePuzzle = useCallback(() => persistPuzzle({ switchTab: true }), [persistPuzzle]);
  // All fields non-empty before Preview/Save is enabled: a real solution line
  // (more than just the starting position) and a non-empty description.
  // Themes stay optional — not every puzzle needs a tag.
  const canSave = mainLine.length > 1 && draft.note.trim().length > 0;

  // Debounced autosave: while there's a solution line being built (or its
  // description/themes are being edited), keep the draft's db record current
  // so its preview card in the Puzzle Set tab reflects what's on the board.
  useEffect(() => {
    if (boardMode !== 'solution' || mainLine.length <= 1) return;
    const t = setTimeout(() => { persistPuzzle({ switchTab: false }); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainLine, draft, boardMode]);

  const handleEditPuzzle = useCallback((p: Puzzle) => {
    try {
      const { sans } = buildSolutionSans(p.fen, p.solutionLineUci?.length ? p.solutionLineUci : [p.solutionUci]);
      const ok = game.loadPgn(fenAndSansToPgn(p.fen, sans));
      if (!ok) throw new Error('board rejected this puzzle\'s solution line');
      setSetupFen(p.fen);
      setEditingPuzzleId(p.id);
      setDraft({ note: p.note ?? '', themes: p.themes ?? [] });
      setEditError(null);
      setBoardMode('solution');
      setActiveTab('edit');
    } catch (err) {
      devlog('puzzles', 'handleEditPuzzle: failed to load puzzle for editing', { puzzleId: p.id, fen: p.fen, error: String(err) });
      setEditError('This puzzle has corrupted data and could not be opened for editing.');
    }
  }, [game]);

  const handleDeletePuzzle = useCallback(async (puzzleId: string) => {
    try {
      await db.puzzles.delete(puzzleId);
      await db.leitnerBoxes.delete(puzzleId);
      if (openSetId) {
        const set = await db.workoutSets.get(openSetId);
        if (set) await db.workoutSets.update(openSetId, { puzzleIds: set.puzzleIds.filter((id) => id !== puzzleId) });
        reloadSetPuzzles(openSetId);
      }
      if (editingPuzzleId === puzzleId) resetDraft();
    } catch (err) {
      devlog('puzzles', 'handleDeletePuzzle: failed', { puzzleId, error: String(err) });
      setEditError('Failed to delete that puzzle — try again.');
    }
  }, [openSetId, editingPuzzleId, reloadSetPuzzles, resetDraft]);

  const handleReorderPuzzle = useCallback(async (puzzleId: string, direction: 'up' | 'down') => {
    if (!openSetId) return;
    try {
      const set = await db.workoutSets.get(openSetId);
      if (!set) return;
      const ids = [...set.puzzleIds];
      const i = ids.indexOf(puzzleId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i === -1 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await db.workoutSets.update(openSetId, { puzzleIds: ids });
      reloadSetPuzzles(openSetId);
    } catch (err) {
      devlog('puzzles', 'handleReorderPuzzle: failed', { puzzleId, error: String(err) });
      setEditError('Failed to reorder that puzzle — try again.');
    }
  }, [openSetId, reloadSetPuzzles]);

  const handleImportLichess = useCallback(async (imported: ImportedLichessPuzzle[]) => {
    try {
      const puzzles = imported.map(importedToPuzzle);
      await db.puzzles.bulkAdd(puzzles);
      await db.leitnerBoxes.bulkAdd(puzzles.map((p) => ({ puzzleId: p.id, box: 0, lastSessionNum: 0, rightCount: 0, wrongCount: 0 })));

      let setId = openSetId;
      if (!setId) {
        setId = nanoid();
        await db.workoutSets.add({ id: setId, name: `Lichess import — ${new Date().toLocaleDateString()}`, puzzleIds: puzzles.map((p) => p.id), createdAt: Date.now() });
        setOpenSetId(setId);
      } else {
        const set = await db.workoutSets.get(setId);
        if (set) await db.workoutSets.update(setId, { puzzleIds: [...set.puzzleIds, ...puzzles.map((p) => p.id)] });
      }
      reloadSetPuzzles(setId);
      setEditError(null);
    } catch (err) {
      devlog('puzzles', 'handleImportLichess: failed', { error: String(err) });
      setEditError('Failed to import the Lichess puzzle(s) — try again.');
    }
  }, [openSetId, reloadSetPuzzles]);

  // A pasted/typed FEN is a starting position — applies to whichever puzzle
  // is currently being authored (a fresh blank one, or an existing one
  // reopened via Edit). Updates setupFen AND the live game tree together so
  // Setup and Solution stay in sync no matter which one you look at next —
  // no lazy "only reload if it changed" comparison to go stale here.
  const handleApplyFen = useCallback((fen: string) => {
    const trimmed = fen.trim();
    if (!trimmed) { setEditError('FEN cannot be empty.'); return; }
    try {
      new Chess(trimmed);
    } catch (err) {
      devlog('puzzles', 'handleApplyFen: rejected invalid FEN', { fen: trimmed, error: String(err) });
      setEditError(`That FEN isn't valid: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSetupFen(trimmed);
    const ok = game.loadFen(trimmed);
    if (!ok) { setEditError("That FEN isn't valid — the board couldn't load it."); return; }
    setEditError(null);
    if (!editingPuzzleId) {
      persistPuzzle({ switchTab: false, fen: trimmed, solutionLineUci: [] });
    }
  }, [game, editingPuzzleId, persistPuzzle]);

  // A PGN (pasted or uploaded) is a whole game, not yet a single puzzle —
  // load it starting at the beginning so the ▶ replay control can step
  // through it; no draft is created until a real solution line exists
  // (autosave picks that up once moves are actually played from wherever the
  // puzzle is decided to start via the Setup/Solution toggle).
  const handleImportPgn = useCallback((pgn: string) => {
    const trimmed = pgn.trim();
    if (!trimmed) { setEditError('Paste a PGN or move list first.'); return; }
    let ok = false;
    try {
      ok = game.loadPgn(trimmed, { startAtBeginning: true });
    } catch (err) {
      devlog('puzzles', 'handleImportPgn: threw while parsing', { pgn: trimmed.slice(0, 300), error: String(err) });
      ok = false;
    }
    if (!ok) {
      devlog('puzzles', 'handleImportPgn: could not parse PGN/move text', { pgn: trimmed.slice(0, 300) });
      setEditError("Couldn't parse that PGN or move list — check the format and try again.");
      return;
    }
    setEditError(null);
    resetDraft();
    setBoardMode('solution');
    setActiveTab('moves');
  }, [game, resetDraft]);

  // ── Preview: save the current draft, then launch the solve/preview viewer ─
  const handlePreview = useCallback(async () => {
    if (!canSave) return;
    const result = await persistPuzzle({ switchTab: false });
    if (result) router.push(`/puzzles?workoutId=${result.setId}&previewPuzzleId=${result.puzzleId}`);
  }, [canSave, persistPuzzle, router]);

  const editingLabel = editingPuzzleId ? (draft.note || 'this puzzle') : 'new puzzle draft';

  const panelHeight = boardWidth > 0 ? boardWidth : undefined;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
      {/* Board column — single ref for both modes, so BoardEditor/Chessboard
          sizing and the panel's matched height read the same measurement. */}
      <div ref={columnRef} className="shrink-0 w-full min-w-0" style={{ width: `min(100vw, ${BOARD_MAX}px)`, maxWidth: '100%' }}>
        {/* Setup ⇄ Solution — tells the board (and every drag/click on it)
            what it's editing: the starting position, or the solution line.
            The board is always interactive either way; ＋ just clears the
            draft to start a genuinely new puzzle instead of continuing this
            one — kept here, next to the mode it resets, rather than as a
            separate toolbar button elsewhere. */}
        <div className="flex gap-1 p-1 mb-1.5 bg-zinc-800 rounded-md">
          <button
            onClick={switchToSetup}
            className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${boardMode === 'setup' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Setup
          </button>
          <button
            onClick={switchToSolution}
            className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${boardMode === 'solution' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Solution
          </button>
        </div>

        {boardMode === 'setup' ? (
          <BoardEditor
            fen={setupFen}
            onFenChange={setSetupFen}
            orientation={flipped ? 'black' : 'white'}
            onFlip={() => setFlipped((f) => !f)}
            maxBoard={boardWidth || BOARD_MAX}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="w-full" style={{ aspectRatio: '1 / 1' }}>
              {boardWidth > 0 && (
                <Chessboard
                  position={game.currentFen}
                  boardWidth={boardWidth}
                  boardOrientation={flipped ? 'black' : 'white'}
                  onSquareClick={handleSquareClick}
                  onPieceDrop={handlePieceDrop}
                  areArrowsAllowed={false}
                  customSquareStyles={squareStyles}
                />
              )}
            </div>
            <div className="flex gap-0.5">
              <BoardTransport
                onStart={game.goStart} onPrev={game.goPrev} onNext={game.goNext} onEnd={game.goEnd} onFlip={() => setFlipped((f) => !f)}
                canPrev={canPrev} canNext={canNext}
              />
            </div>
          </div>
        )}
      </div>

      {/* Panel — same height as the board (boardWidth), so its own board
          controls (below) can sit pinned to the bottom of that height while
          the tab content scrolls inside it, without ever overflowing. */}
      <div
        className="w-full lg:flex-1 lg:min-w-0 min-w-0 bg-zinc-900 rounded-md p-3 flex flex-col overflow-hidden"
        style={{ height: panelHeight, maxHeight: 'calc(100dvh - 6.5rem)' }}
      >
        <div className="flex items-center gap-1 border-b border-zinc-800 pb-2 shrink-0">
          <button onClick={() => setActiveTab('workouts')} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${activeTab === 'workouts' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Workouts</button>
          <button onClick={() => setActiveTab('set')} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${activeTab === 'set' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Puzzle Set</button>
          <button onClick={() => setActiveTab('moves')} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${activeTab === 'moves' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Moves</button>
          <button onClick={() => setActiveTab('edit')} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${activeTab === 'edit' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>Edit</button>
          <button
            onClick={handlePreview}
            disabled={!canSave}
            title={canSave ? 'Preview this puzzle' : 'Add a description and at least one solution move first'}
            className="flex-none w-8 h-8 grid place-items-center rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200"
          >
            ▷
          </button>
        </div>

        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden py-2">
          {activeTab === 'workouts' && (
            <WorkoutsTab openSetId={openSetId} onOpenSet={handleOpenSet} onNewSet={handleNewSet} />
          )}
          {activeTab === 'set' && (
            <PuzzleSetTab
              openSetId={openSetId}
              openSetName={openSetName}
              puzzlesInSet={puzzlesInSet}
              onGoToWorkouts={() => setActiveTab('workouts')}
              onNewPuzzle={handleNewPuzzle}
              onEditPuzzle={handleEditPuzzle}
              onDeletePuzzle={handleDeletePuzzle}
              onReorderPuzzle={handleReorderPuzzle}
            />
          )}
          {activeTab === 'moves' && <PuzzleMovesTab game={game} editingLabel={editingLabel} />}
          {activeTab === 'edit' && (
            <PuzzleEditTab
              setName={openSetName}
              fen={boardMode === 'setup' ? setupFen : game.root.fen}
              onApplyFen={handleApplyFen}
              onImportPgn={handleImportPgn}
              onImportLichess={handleImportLichess}
              note={draft.note}
              onNoteChange={(v) => setDraft((d) => ({ ...d, note: v }))}
              themes={draft.themes}
              onThemesChange={(themes) => setDraft((d) => ({ ...d, themes }))}
              solutionText={solutionText}
              onApplySolutionText={applySolutionText}
              onSave={handleSavePuzzle}
              isEditing={!!editingPuzzleId}
              canSave={canSave}
              error={editError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
