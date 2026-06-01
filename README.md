# Chess Academy

A chess coaching and training platform built with Next.js 16, React 19, and Stockfish 18.

## Features

| Route | Status |
|-------|--------|
| `/board` | ✅ Interactive analysis board with MultiPV engine, eval bar, variations, annotations |
| `/analysis` | 🔄 Game Reviewer — Lichess-style move quality labels, accuracy scores, K-MAPS commentary |
| `/puzzle-generator` | 📋 Planned |
| `/position-trainer` | 📋 Planned |
| (and more) | 📋 Planned |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Engine Setup

Stockfish 18 Lite (single-threaded WASM) is required:

1. Place `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm` in `public/engine/`
2. The files are loaded directly as a Web Worker — no additional config needed

## Opening Book (optional)

For book move detection in the Game Reviewer:

1. Download `gm2600.bin` (Polyglot format, GM 2600+ games)
2. Place it at `public/books/gm2600.bin`

Without the book file, the Game Reviewer falls back to an opening-phase heuristic.

## Project Docs

- [`BOARD_PLAN.md`](BOARD_PLAN.md) — Board feature architecture
- [`GAME_REVIEWER_PLAN.md`](GAME_REVIEWER_PLAN.md) — Game Reviewer feature plan
- [`PUZZLE_GENERATOR_PLAN.md`](PUZZLE_GENERATOR_PLAN.md) — Puzzle Generator feature plan
- [`ANALYSIS_PIPELINE_SUMMARY.md`](ANALYSIS_PIPELINE_SUMMARY.md) — Project overview & file map
