'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ChallengeReport } from '@/lib/db';
import {
  aggregateFacets, accuracySeries, successByRatingBand, FACET_LABELS,
  type Facets, type ChallengePoint, type RatingBand,
} from '@/lib/challengeStats';

export type ChartKind = 'spider' | 'line' | 'bar' | 'scatter';

const OK = '#34d399', BAD = '#f87171', ACCENT = '#818cf8', GRID = '#27272a', AXIS = '#3f3f46', DIM = '#52525b', LABEL = '#a1a1aa';

function useChallenges(): ChallengeReport[] {
  return useLiveQuery(() => db.challenges.orderBy('createdAt').toArray(), []) ?? [];
}

// ─── Spider / radar (skill facets) ────────────────────────────────────────────

function Spider({ facets }: { facets: Facets }) {
  const keys = ['survival', 'tactics', 'technique', 'time', 'conversion'] as (keyof Facets)[];
  const N = keys.length, cx = 150, cy = 145, R = 95;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const pt = (i: number, frac: number) => [cx + Math.cos(ang(i)) * R * frac, cy + Math.sin(ang(i)) * R * frac] as const;
  const ring = (frac: number) => keys.map((_, i) => pt(i, frac).join(',')).join(' ');
  const dataPts = keys.map((k, i) => pt(i, facets[k] / 100).join(',')).join(' ');
  return (
    <svg viewBox="0 0 300 285" className="w-full" style={{ maxHeight: 340 }}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke={AXIS} strokeWidth={1} />)}
      {keys.map((k, i) => { const [x, y] = pt(i, 1); return <line key={k} x1={cx} y1={cy} x2={x} y2={y} stroke={AXIS} strokeWidth={1} />; })}
      <polygon points={dataPts} fill="rgba(129,140,248,0.25)" stroke={ACCENT} strokeWidth={2} />
      {keys.map((k, i) => { const [x, y] = pt(i, 1.0); return <circle key={k} cx={x} cy={y} r={2.5} fill={ACCENT} />; })}
      {keys.map((k, i) => {
        const [x, y] = pt(i, 1.2);
        return <text key={k} x={x} y={y} fill={LABEL} fontSize={10} textAnchor="middle" dominantBaseline="middle">{FACET_LABELS[k]} {Math.round(facets[k])}</text>;
      })}
    </svg>
  );
}

// ─── Trend line (accuracy over time) ──────────────────────────────────────────

function TrendLine({ points }: { points: ChallengePoint[] }) {
  const W = 320, H = 190, pad = 26;
  const n = points.length;
  const x = (i: number) => pad + (n <= 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => pad + (1 - v / 100) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.accuracy)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={pad} y1={y(v)} x2={W - pad} y2={y(v)} stroke={GRID} /><text x={4} y={y(v) + 3} fill={DIM} fontSize={8}>{v}</text></g>
      ))}
      {n > 1 && <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.5} />}
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.accuracy)} r={3} fill={p.succeeded ? OK : BAD} />)}
      <text x={W - pad} y={H - 6} fill={DIM} fontSize={8} textAnchor="end">oldest → newest · accuracy %</text>
    </svg>
  );
}

// ─── Bar (success rate by opponent band) ──────────────────────────────────────

function Bars({ bands }: { bands: RatingBand[] }) {
  const W = 320, H = 200, pad = 30;
  const plotH = H - 2 * pad - 12;
  const bw = (W - 2 * pad) / bands.length;
  const y = (v: number) => pad + (1 - v / 100) * plotH;
  const base = pad + plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 50, 100].map((v) => <g key={v}><line x1={pad} y1={y(v)} x2={W - pad} y2={y(v)} stroke={GRID} /><text x={4} y={y(v) + 3} fill={DIM} fontSize={8}>{v}</text></g>)}
      {bands.map((b, i) => {
        const bx = pad + i * bw + bw * 0.2, w = bw * 0.6, top = y(b.successPct);
        return (
          <g key={b.label}>
            <rect x={bx} y={top} width={w} height={base - top} rx={2} fill={b.count ? ACCENT : AXIS} />
            {b.count > 0 && <text x={bx + w / 2} y={top - 3} fill={LABEL} fontSize={8} textAnchor="middle">{Math.round(b.successPct)}%</text>}
            <text x={bx + w / 2} y={base + 12} fill={LABEL} fontSize={8} textAnchor="middle">{b.label}</text>
            <text x={bx + w / 2} y={base + 22} fill={DIM} fontSize={7} textAnchor="middle">{b.count}×</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Scatter (opponent rating vs accuracy) ────────────────────────────────────

function Scatter({ points }: { points: ChallengePoint[] }) {
  const pts = points.filter((p) => p.rating != null);
  const W = 320, H = 210, pad = 30, RMIN = 1350, RMAX = 2600;
  const x = (r: number) => pad + ((r - RMIN) / (RMAX - RMIN)) * (W - 2 * pad);
  const y = (a: number) => pad + (1 - a / 100) * (H - 2 * pad - 12);
  if (pts.length === 0) return <Empty msg="No rated challenges yet." />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 50, 100].map((v) => <g key={v}><line x1={pad} y1={y(v)} x2={W - pad} y2={y(v)} stroke={GRID} /><text x={4} y={y(v) + 3} fill={DIM} fontSize={8}>{v}</text></g>)}
      {[1350, 1600, 1900, 2200, 2600].map((r) => <text key={r} x={x(r)} y={H - 8} fill={DIM} fontSize={7} textAnchor="middle">{r}</text>)}
      {pts.map((p, i) => <circle key={i} cx={x(p.rating as number)} cy={y(p.accuracy)} r={3.5} fill={p.succeeded ? OK : BAD} opacity={0.85} />)}
      <text x={W - pad} y={pad - 8} fill={DIM} fontSize={8} textAnchor="end">opponent rating →  ·  accuracy ↑</text>
    </svg>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-sm text-zinc-600 py-10 text-center">{msg}</p>;
}

const TITLES: Record<ChartKind, { title: string; sub: string }> = {
  spider: { title: 'Strength profile', sub: 'Five facets derived from your challenge history (0–100).' },
  line: { title: 'Accuracy trend', sub: 'Per-challenge accuracy over time — green held, red folded.' },
  bar: { title: 'Success by opponent', sub: 'How often you survive at each strength band.' },
  scatter: { title: 'Rating vs accuracy', sub: 'Each dot is a challenge — where you start to slip.' },
};

export function PerformanceCharts({ chart }: { chart: ChartKind }) {
  const reports = useChallenges();
  const { title, sub } = TITLES[chart];

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2">
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        <div className="text-[11px] text-zinc-500">{sub}</div>
      </div>
      {reports.length === 0 ? (
        <Empty msg="Play some Blunderable challenges to build your performance charts." />
      ) : (
        <div className="max-w-md mx-auto">
          {chart === 'spider' && <Spider facets={aggregateFacets(reports)} />}
          {chart === 'line' && <TrendLine points={accuracySeries(reports)} />}
          {chart === 'bar' && <Bars bands={successByRatingBand(reports)} />}
          {chart === 'scatter' && <Scatter points={accuracySeries(reports)} />}
          <div className="mt-2 text-[11px] text-zinc-500 text-center">{reports.length} challenge{reports.length === 1 ? '' : 's'}</div>
        </div>
      )}
    </div>
  );
}
