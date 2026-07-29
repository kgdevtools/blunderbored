import { useEffect, useState, useCallback } from 'react';
import { engineService } from '@/lib/engine';
import type { EngineMultiLine } from '@/lib/engine';

const EVAL_DEPTH = 14; // depth 18 overflows the WASM stack on the lite single-threaded build
const PV_COUNT = 3;

// Stockfish reports scores/mates from the SIDE-TO-MOVE's perspective (UCI).
// Every consumer of this hook (EvalBar, EngineLines) renders White-POV, so
// normalize here once: negate when Black is to move. Leaving this raw was why
// the eval bar sat frozen/mirrored on Black-to-move positions.
function toWhitePov(lines: EngineMultiLine[], fen: string): EngineMultiLine[] {
  if (fen.split(' ')[1] !== 'b') return lines;
  return lines.map((l) => ({
    ...l,
    score: -l.score,
    mate: l.mate === null ? null : -l.mate,
  }));
}

export function useBoardEngine(currentFen: string) {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<EngineMultiLine[]>([]);
  const [depth, setDepth] = useState(0);
  const [isComputing, setIsComputing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      engineService.cancel();
      setLines([]);
      setDepth(0);
      setIsComputing(false);
      return;
    }

    let stale = false;
    setIsComputing(true);
    setLines([]);

    engineService.cancel();

    engineService
      .evaluateMulti(currentFen, EVAL_DEPTH, PV_COUNT)
      .then((result) => {
        if (stale) return;
        setLines(toWhitePov(result, currentFen));
        setDepth(result[0]?.depth ?? 0);
        setIsComputing(false);
      })
      .catch(() => {
        if (!stale) {
          setIsComputing(false);
          setEnabled(false); // worker crashed — reset so user can retry after re-enabling
        }
      });

    return () => {
      stale = true;
    };
  }, [currentFen, enabled]);

  const toggleEngine = useCallback(() => setEnabled((e) => !e), []);

  return {
    lines, // White-POV (normalized above)
    depth,
    isComputing,
    enabled,
    toggleEngine,
    evalScore: lines[0]?.score ?? null, // cp, White-POV
    evalMate: lines[0]?.mate ?? null,   // mate distance, White-POV sign
  };
}
