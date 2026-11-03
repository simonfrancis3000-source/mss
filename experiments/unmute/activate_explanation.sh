#!/usr/bin/env bash
set -euo pipefail

PYTHON=/root/unmute-backend-venv/bin/python
FILE=/root/mss-unmute-frontend/force_explanation_backend.py
test -f "$FILE" || { echo "Download force_explanation_backend.py first"; exit 1; }
test -x "$PYTHON" || { echo "Unmute backend Python not found: $PYTHON"; exit 1; }

echo "Restarting only the experimental Unmute backend. The AMIA proxy stays running."
tmux kill-session -t unmute-backend-amia 2>/dev/null || true
tmux kill-session -t unmute-backend-explanation 2>/dev/null || true
existing="$(pgrep -f '[p]ython.*uvicorn.*unmute.main_websocket:app' || true)"
if [[ -n "$existing" ]]; then kill $existing 2>/dev/null || true; fi
sleep 2
tmux new-session -d -s unmute-backend-explanation \
  "cd /workspace/unmute && exec $PYTHON -B $FILE > /root/unmute-amia-backend.log 2>&1"
sleep 4

echo "=== ACTIVE MODEL ==="
pid="$(pgrep -f '[p]ython.*force_explanation_backend.py' | head -n 1 || true)"
if [[ -z "$pid" ]]; then echo "Explanation backend not running"; tail -n 40 /root/unmute-amia-backend.log; exit 1; fi
tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^KYUTAI_LLM_(URL|MODEL)=' || true
echo "=== UNMUTE HEALTH ==="
curl -fsS http://127.0.0.1:8000/v1/health; echo
echo "=== VOICE OVERRIDE LOG ==="
grep -E "Explanation voice override enabled|MSS Explanation voice pinned" /root/unmute-amia-backend.log | tail -n 5 || true
echo "Start a NEW browser conversation to apply the voice; existing conversations do not change."
