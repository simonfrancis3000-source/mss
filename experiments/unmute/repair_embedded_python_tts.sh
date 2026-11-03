#!/usr/bin/env bash
# Isolated repair for PyO3-embedded Python imports in the MSS / Kyutai Unmute TTS experiment.
# Leaves the original /root/mss-tts-single.toml unchanged and does not touch other services.
set -euo pipefail

BINARY=/workspace/.cargo/bin/moshi-server
VENV_PY=/root/unmute-tts-venv/bin/python
SOURCE_CONFIG=/root/mss-tts-single.toml
PATCHED_CONFIG=/root/mss-tts-embedded-fixed.toml
PATCHED_SCRIPT=/root/mss-tts-embedded-fixed.py
LOG=/root/unmute-tts-explanation.log

for file in "$BINARY" "$VENV_PY" "$SOURCE_CONFIG"; do
  test -f "$file" || { echo "Missing prerequisite: $file"; exit 1; }
done

# Confirm imports from the original isolated interpreter before altering anything.
unset PYTHONHOME PYTHONPATH PYTHONUSERBASE PYTHONPLATLIBDIR
"$VENV_PY" -c 'import sys, _contextvars, numpy, huggingface_hub, torch, safetensors, moshi; print("Standalone Python OK:", sys.version)'

# Extract the exact Python program embedded in this binary and correct its sys.path
# before the first third-party imports. moshi-server's PyConfig.script supports this.
"$VENV_PY" - <<'PY'
import pathlib
import subprocess
import sys

binary = "/workspace/.cargo/bin/moshi-server"
original = pathlib.Path("/root/mss-tts-single.toml").read_text()
script = subprocess.check_output([binary, "configs", "tts.py"], text=True)

paths = [p for p in sys.path if p]
for p in paths:
    if not pathlib.Path(p).exists():
        print("WARNING: interpreter path does not exist:", p)

prefix = (
    "# Python paths captured from the verified Kyutai TTS virtual environment.\n"
    "import sys\n"
    f"sys.path[:] = {paths!r}\n"
    "import _contextvars\n"
    "print('MSS EMBEDDED PYTHON PATH OK', flush=True)\n"
)
if "from __future__ import" in script:
    raise SystemExit("Unexpected future imports in compiled script; no changes applied.")
if "[modules.tts_py]\n" not in original:
    raise SystemExit("Expected TTS module header not found; no changes applied.")

pathlib.Path("/root/mss-tts-embedded-fixed.py").write_text(prefix + script)
replacement = original.replace(
    "[modules.tts_py]\n",
    '[modules.tts_py]\nscript = "/root/mss-tts-embedded-fixed.py"\n',
    1,
)
pathlib.Path("/root/mss-tts-embedded-fixed.toml").write_text(replacement)
print("Patched script and separate TOML config prepared in /root")
PY

"$VENV_PY" -m py_compile "$PATCHED_SCRIPT"
echo "Patched Python syntax OK"
echo "Active original voice source: $(grep 'voice_folder' "$SOURCE_CONFIG")"

# Do not replace any running TTS server unexpectedly.
if curl --max-time 2 -fsS http://127.0.0.1:8089/api/build_info >/dev/null 2>&1; then
  echo "A TTS server is already healthy on port 8089; leave it running."
  exit 0
fi

# Avoid corrupting an unknown active session or competing for port 8089.
if ss -ltnp | grep -qE '[:.]8089[[:space:]]'; then
  echo "Port 8089 is in use; inspect process before proceeding."
  ss -ltnp | grep ':8089' || true
  exit 1
fi

tmux kill-session -t mss-tts-explanation 2>/dev/null || true
mkdir -p /root/static /tmp/unmute_logs

# Avoid the quota-limited /workspace filesystem for startup writes.
tmux new-session -d -s mss-tts-explanation \
  "cd /root && \
   unset PYTHONHOME PYTHONPATH PYTHONUSERBASE PYTHONPLATLIBDIR && \
   export VIRTUAL_ENV=/root/unmute-tts-venv \
          PATH=/root/unmute-tts-venv/bin:\$PATH \
          HOME=/root HF_HOME=/root/.cache/huggingface \
          XDG_CACHE_HOME=/root/.cache TMPDIR=/tmp PYTHONDONTWRITEBYTECODE=1 && \
   exec $BINARY worker --config $PATCHED_CONFIG --port 8089 > $LOG 2>&1"

echo "TTS start requested. Checking port and log..."
READY=0
for i in $(seq 1 60); do
  if curl --max-time 2 -fsS http://127.0.0.1:8089/api/build_info >/dev/null 2>&1; then
    READY=1
    echo "TTS READY"
    break
  fi
  if ! tmux has-session -t mss-tts-explanation 2>/dev/null; then
    echo "TTS PROCESS EXITED"
    break
  fi
  sleep 2
done

echo "=== KEY STARTUP LOG ==="
grep -E 'MSS EMBEDDED PYTHON|Error:|Traceback|ModuleNotFoundError|ImportError|Disk quota' "$LOG" | tail -n 15 || true
echo "=== HEALTH ==="
curl --max-time 10 -sS http://127.0.0.1:8000/v1/health || true
echo
echo "=== LAST 20 LOG LINES ==="
tail -n 20 "$LOG"
test "$READY" -eq 1
