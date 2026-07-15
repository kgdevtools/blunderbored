#!/usr/bin/env python3
"""Diff the app's review (browser: copy(JSON.stringify(window.__review)) → app.json)
against the lab reference (review_lab.py --json lab.json).

Shows a verdict agreement matrix and a per-move table of every disagreement
with BOTH eval pairs — pinpoints cases like "+0.66 → -4.3 shown, verdict says
mistake": if the app's evals differ from the lab's, the bug is in eval
collection (engine failure placeholder, sign, off-by-one); if the evals match
but verdicts differ, the bug is in the classification gates.

Usage: ./.venv/bin/python compare_reviews.py app.json lab.json
"""
import json, sys
from collections import Counter

def load(path):
    with open(path) as f:
        d = json.load(f)
    return d['moves']

def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    app, lab = load(sys.argv[1]), load(sys.argv[2])
    if len(app) != len(lab):
        print(f"! move-count mismatch: app {len(app)} vs lab {len(lab)}")
    n = min(len(app), len(lab))

    matrix = Counter()
    diffs = []
    ev_deltas = []
    for i in range(n):
        a, l = app[i], lab[i]
        matrix[(a['quality'], l['quality'])] += 1
        ev_deltas.append(abs(a['evalAfter'] - l['evalAfter']))
        if a['quality'] != l['quality']:
            diffs.append((i, a, l))

    qs = ['book', 'good', 'inaccuracy', 'mistake', 'blunder']
    print(f"\nverdict matrix (rows=app, cols=lab) over {n} moves:")
    print(' ' * 12 + ''.join(f'{q[:5]:>7}' for q in qs))
    for qa in qs:
        row = ''.join(f'{matrix[(qa, ql)]:>7}' for ql in qs)
        print(f'{qa:<12}{row}')
    agree = sum(matrix[(q, q)] for q in qs)
    print(f"\nagreement: {agree}/{n} ({100 * agree / max(1, n):.1f}%)")
    print(f"|evalAfter| delta: median {sorted(ev_deltas)[n // 2]}cp · "
          f"max {max(ev_deltas)}cp")

    if diffs:
        print(f"\n{len(diffs)} disagreement(s):")
        print(f"{'#':>3} {'san':<10} {'app evals':>15} {'lab evals':>15}  app→lab verdict")
        for i, a, l in diffs:
            print(f"{i:>3} {a['moveSan']:<10} "
                  f"{a['evalBefore']:>6}/{a['evalAfter']:>7} "
                  f"{l['evalBefore']:>6}/{l['evalAfter']:>7}  "
                  f"{a['quality']} → {l['quality']}"
                  + ('   ← app evals differ (collection bug)' if abs(a['evalAfter'] - l['evalAfter']) > 80 else ''))

if __name__ == '__main__':
    main()
