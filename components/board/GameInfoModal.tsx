'use client';
import { useEffect, useRef } from 'react';

// ── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GameInfoModalProps {
  headers: Record<string, string>;
  onSetHeader: (key: string, value: string) => void;
  onClose: () => void;
}

// ── Field helpers ─────────────────────────────────────────────────────────────

const TITLE_OPTIONS = ['', 'GM', 'IM', 'FM', 'CM', 'NM', 'WGM', 'WIM', 'WFM', 'WCM', 'LM', 'BOT'];
const RESULT_OPTIONS = ['*', '1-0', '0-1', '1/2-1/2'];

const inputCls =
  'w-full px-2 py-1 rounded bg-zinc-700 border border-zinc-600 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500';
const labelCls = 'text-xs text-zinc-400 mb-0.5 block';

function TextField({ label, field, headers, onSetHeader, placeholder }: {
  label: string; field: string; headers: Record<string, string>;
  onSetHeader: (k: string, v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        className={inputCls}
        value={headers[field] ?? ''}
        onChange={e => onSetHeader(field, e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}

function SelectField({ label, field, options, headers, onSetHeader }: {
  label: string; field: string; options: string[];
  headers: Record<string, string>; onSetHeader: (k: string, v: string) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select
        className={inputCls + ' cursor-pointer'}
        value={headers[field] ?? ''}
        onChange={e => onSetHeader(field, e.target.value)}
      >
        {options.map(o => (
          <option key={o} value={o}>{o || '—'}</option>
        ))}
      </select>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function GameInfoModal({ headers, onSetHeader, onClose }: GameInfoModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (!dialogRef.current?.contains(e.target as Node)) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={handleBackdrop}
    >
      <div
        ref={dialogRef}
        className="bg-zinc-800 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl border border-zinc-700"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Game Info</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 transition-colors p-0.5 rounded"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-3">
          {/* Event & Site */}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Event" field="Event" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. World Championship" />
            <TextField label="Site" field="Site" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. lichess.org" />
          </div>

          {/* Date & Result */}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Date" field="Date" headers={headers} onSetHeader={onSetHeader} placeholder="YYYY.MM.DD" />
            <SelectField label="Result" field="Result" options={RESULT_OPTIONS} headers={headers} onSetHeader={onSetHeader} />
          </div>

          {/* White */}
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <TextField label="White" field="White" headers={headers} onSetHeader={onSetHeader} placeholder="Player name" />
            <SelectField label="White Title" field="WhiteTitle" options={TITLE_OPTIONS} headers={headers} onSetHeader={onSetHeader} />
          </div>
          <TextField label="White Elo" field="WhiteElo" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. 2389" />

          {/* Black */}
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <TextField label="Black" field="Black" headers={headers} onSetHeader={onSetHeader} placeholder="Player name" />
            <SelectField label="Black Title" field="BlackTitle" options={TITLE_OPTIONS} headers={headers} onSetHeader={onSetHeader} />
          </div>
          <TextField label="Black Elo" field="BlackElo" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. 2498" />

          {/* Opening */}
          <div className="grid grid-cols-[80px_1fr] gap-3">
            <TextField label="ECO" field="ECO" headers={headers} onSetHeader={onSetHeader} placeholder="D31" />
            <TextField label="Opening" field="Opening" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. Semi-Slav Defense" />
          </div>

          {/* Time & Variant */}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Time Control" field="TimeControl" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. 300+3" />
            <TextField label="Variant" field="Variant" headers={headers} onSetHeader={onSetHeader} placeholder="Standard" />
          </div>

          <TextField label="Termination" field="Termination" headers={headers} onSetHeader={onSetHeader} placeholder="e.g. Normal" />
        </div>
      </div>
    </div>
  );
}
