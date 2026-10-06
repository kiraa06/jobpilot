#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "── Python"
PYTHONPATH=host python3 -m unittest discover -s host/tests -t host -v
echo "── JavaScript"
if ls tests/js/*.test.cjs >/dev/null 2>&1; then node --test tests/js/*.test.cjs; else echo "(no JS tests yet)"; fi
