import { useEffect, useState, useCallback } from 'react';
import { engineService } from '@/lib/engine';
import type { EngineMultiLine } from '@/lib/engine';

const EVAL_DEPTH = 14; // depth 18 overflows the WASM stack on the lite single-threaded build
const PV_COUNT = 3;

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
        setLines(result);
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
    lines,
    depth,
    isComputing,
    enabled,
    toggleEngine,
    evalScore: lines[0]?.score ?? null,
  };
}
