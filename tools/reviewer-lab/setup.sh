#!/usr/bin/env bash
# Reviewer lab setup (Ubuntu, no sudo needed):
#   creates a venv with python-chess and fetches an official Stockfish binary.
# Run:  bash tools/reviewer-lab/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

# Prefer a venv; fall back to a --user install when python3-venv is missing
# (Ubuntu ships pip but not venv by default; installing python3-venv needs sudo).
# Wheel-only: the chess sdist needs newer setuptools than stock Ubuntu has.
if python3 -m venv .venv 2>/dev/null && [ -x .venv/bin/pip ]; then
  PY=./.venv/bin/python
  ./.venv/bin/pip install --quiet --only-binary=:all: chess || ./.venv/bin/pip install --quiet chess==1.10.0
else
  rm -rf .venv
  PY=python3
  pip3 install --quiet --user --only-binary=:all: chess || pip3 install --quiet --user chess==1.10.0
fi
echo "#!/usr/bin/env bash" > py
echo "exec $PY \"\$@\"" >> py
chmod +x py
echo "✓ python-chess $($PY -c 'import chess; print(chess.__version__)') (run scripts with ./py)"

mkdir -p bin
if [ ! -x bin/stockfish ]; then
  if command -v stockfish >/dev/null; then
    ln -sf "$(command -v stockfish)" bin/stockfish
    echo "✓ linked system stockfish"
  else
    echo "→ downloading official Stockfish 17.1 (linux avx2)…"
    URL="https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-ubuntu-x86-64-avx2.tar"
    curl -sL "$URL" -o /tmp/sf.tar
    tar -xf /tmp/sf.tar -C /tmp
    mv /tmp/stockfish/stockfish-ubuntu-x86-64-avx2 bin/stockfish
    chmod +x bin/stockfish
    rm -rf /tmp/sf.tar /tmp/stockfish
  fi
fi
echo "✓ engine: $(bin/stockfish --version 2>/dev/null | head -1 || echo bin/stockfish ready)"
echo
echo "Usage:"
echo "  ./py review_lab.py game.pgn --depth 18 --json lab.json -v"
echo "  ./py compare_reviews.py app-review.json lab.json"
