'use client';
import { KmapsResult } from '@/lib/analysis';

interface Section {
  key: keyof KmapsResult;
  label: string;
  abbr: string;
}

const SECTIONS: Section[] = [
  { key: 'kingSafety',    label: 'King',     abbr: 'K' },
  { key: 'activity',      label: 'Activity', abbr: 'A' },
  { key: 'pawnStructure', label: 'Pawns',    abbr: 'P' },
  { key: 'space',         label: 'Space',    abbr: 'S' },
];

interface MoveKmapsPanelProps {
  kmaps: KmapsResult;
}

export function MoveKmapsPanel({ kmaps }: MoveKmapsPanelProps) {
  const rows = SECTIONS.filter(s => kmaps[s.key] !== null);
  if (rows.length === 0) return null;

  return (
    <div className="mx-1 mb-1 pl-2 border-l-2 border-zinc-700 space-y-0.5">
      {rows.map(s => (
        <div key={s.key} className="flex gap-2 text-xs leading-snug">
          <span className="shrink-0 text-zinc-500 w-14">{s.label}</span>
          <span className="text-zinc-300">{kmaps[s.key]}</span>
        </div>
      ))}
    </div>
  );
}
