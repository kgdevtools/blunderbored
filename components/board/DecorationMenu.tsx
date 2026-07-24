'use client';
import { useEffect, useState } from 'react';
import {
  ARROW_COLOR_OPTIONS,
  HIGHLIGHT_COLOR_OPTIONS,
  ARROW_RENDER_COLOR,
  HIGHLIGHT_RENDER_COLOR,
  COLOR_LABEL,
  type DecorationColor,
  type AnimationEffect,
} from '@/lib/decorations';

// Small anchored popup for the board's right-click/long-press decoration
// engine. Built on the same fixed-position + outside-click-close pattern as
// MovesList.tsx's move context menu — no new UI primitive/library introduced.

// What the menu hands back once the user finishes a choice. BoardShell drives
// everything after this — arming an arrow/zone drag, or committing instantly
// for single-square highlight / animate-piece.
export type DecorationCommit =
  | { kind: 'arrow'; color: DecorationColor }
  | { kind: 'highlight'; target: 'square' | 'zone'; color: DecorationColor }
  | { kind: 'animate'; effect: AnimationEffect }
  | { kind: 'delete' }
  | { kind: 'replay' }
  | { kind: 'recolor'; color: DecorationColor };

// When the popup is opened on a square that already anchors a decoration, the
// root panel shows edit controls (Recolor/Delete/Replay) for that item *and*
// the normal create options — so you can add a new, separate decoration
// without disturbing the existing one.
export type EditingKind = 'arrow' | 'highlight' | 'animation' | null;

type Step =
  | 'root'
  | 'arrow-color'
  | 'highlight-type'
  | 'highlight-color'
  | 'animate-effect';

interface DecorationMenuProps {
  x: number;
  y: number;
  editing: EditingKind;
  onCommit: (commit: DecorationCommit) => void;
  onClose: () => void;
}

const PANEL_WIDTH = 176;

const EFFECT_LABEL: Record<AnimationEffect, string> = { bounce: 'Bounce', pulsate: 'Pulsate', shake: 'Shake' };

function ColorSwatch({ color, kind, onClick }: { color: DecorationColor; kind: 'arrow' | 'highlight'; onClick: () => void }) {
  const dot = kind === 'arrow' ? ARROW_RENDER_COLOR[color] : HIGHLIGHT_RENDER_COLOR[color];
  return (
    <button
      onClick={onClick}
      title={COLOR_LABEL[color]}
      className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded hover:bg-zinc-700"
    >
      <span className="w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: dot }} />
      <span className="text-[10px] text-zinc-400">{COLOR_LABEL[color]}</span>
    </button>
  );
}

function MenuButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 hover:bg-zinc-700 ${danger ? 'text-red-400' : 'text-zinc-200'}`}
    >
      {label}
    </button>
  );
}

export function DecorationMenu({ x, y, editing, onCommit, onClose }: DecorationMenuProps) {
  const [step, setStep] = useState<Step>('root');
  const [highlightTarget, setHighlightTarget] = useState<'square' | 'zone'>('square');

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('touchstart', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('touchstart', close);
    };
  }, [onClose]);

  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 0) - PANEL_WIDTH - 8);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 0) - 220);

  const commitAndClose = (commit: DecorationCommit) => {
    onCommit(commit);
    onClose();
  };

  return (
    <div
      className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 text-sm"
      style={{ left, top, width: PANEL_WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {step === 'root' && (
        <>
          {editing && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">This decoration</div>
              <div className="flex items-center gap-0.5 px-2 pb-1.5">
                {(editing === 'arrow' ? ARROW_COLOR_OPTIONS : HIGHLIGHT_COLOR_OPTIONS).map((c) => (
                  <ColorSwatch key={c} color={c} kind={editing === 'arrow' ? 'arrow' : 'highlight'} onClick={() => commitAndClose({ kind: 'recolor', color: c })} />
                ))}
              </div>
              {editing === 'animation' && <MenuButton label="Replay" onClick={() => commitAndClose({ kind: 'replay' })} />}
              <MenuButton label="Delete" danger onClick={() => commitAndClose({ kind: 'delete' })} />
              <div className="my-1 border-t border-zinc-700" />
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Add new</div>
            </>
          )}
          <MenuButton label="Arrow" onClick={() => setStep('arrow-color')} />
          <MenuButton label="Highlight" onClick={() => setStep('highlight-type')} />
          <MenuButton label="Animate" onClick={() => setStep('animate-effect')} />
        </>
      )}

      {step === 'arrow-color' && (
        <div className="flex items-center gap-0.5 px-2 py-1.5">
          {ARROW_COLOR_OPTIONS.map((c) => (
            <ColorSwatch key={c} color={c} kind="arrow" onClick={() => commitAndClose({ kind: 'arrow', color: c })} />
          ))}
        </div>
      )}

      {step === 'highlight-type' && (
        <>
          <MenuButton label="Square" onClick={() => { setHighlightTarget('square'); setStep('highlight-color'); }} />
          <MenuButton label="Zone" onClick={() => { setHighlightTarget('zone'); setStep('highlight-color'); }} />
        </>
      )}

      {step === 'highlight-color' && (
        <div className="flex items-center gap-0.5 px-2 py-1.5">
          {HIGHLIGHT_COLOR_OPTIONS.map((c) => (
            <ColorSwatch
              key={c}
              color={c}
              kind="highlight"
              onClick={() => commitAndClose({ kind: 'highlight', target: highlightTarget, color: c })}
            />
          ))}
        </div>
      )}

      {step === 'animate-effect' && (
        <>
          {(['bounce', 'pulsate', 'shake'] as AnimationEffect[]).map((e) => (
            <MenuButton key={e} label={EFFECT_LABEL[e]} onClick={() => commitAndClose({ kind: 'animate', effect: e })} />
          ))}
        </>
      )}
    </div>
  );
}
