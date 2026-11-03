#!/usr/bin/env bash
# Kyutai TTS repair v2. Align PyO3's Python 3.12.3 stdlib with the linked libpython,
# while loading TTS package dependencies from the existing Python 3.12 venv.
# Only touches isolated test files and TTS session. Never writes /workspace.
set -euo pipefail
BIN=/workspace/.cargo/bin/moshi-server
CFG=/root/mss-tts-single.toml
VENV=/root/unmute-tts-venv
NEW_SCRIPT=/root/mss-tts-embedded-sysfixed.py
NEW_CFG=/root/mss-tts-embedded-sysfixed.toml
LOG=/root/unmute-tts-explanation.log

for file in "$BIN" "$CFG" "$VENV/bin/python"; do
  test -e "$file" || { echo "Missing $file"; exit 1; }
done

# The linked /lib/x86_64-linux-gnu/libpython3.12.so.1.0 belongs to system Python.
# Do not use the uv-downloaded Python 3.12.8 standard library with this 3.12.3 runtime.
SYS_PY=
for candidate in /usr/bin/python3.12 /usr/local/bin/python3.12; do
  if [ -x "$candidate" ] && "$candidate" -c \
    'import sys, _contextvars; assert sys.version_info[:2] == (3,12)' >/dev/null 2>&1; then
    SYS_PY="$candidate"
    break
  fi
done
if [ -z "$SYS_PY" ]; then
  echo "System Python 3.12 with _contextvars not found. No changes made."
  echo "Diagnostics:"
  ls -l /usr/bin/python3.12 /usr/local/bin/python3.12 /usr/lib/python3.12/lib-dynload/_contextvars* 2>&1 || true
  exit 1
fi
"$SYS_PY" -c 'import sys,_contextvars; print("System Python:",sys.version); print("system module:",_contextvars.__spec__.origin)'
"$VENV/bin/python" -c 'import huggingface_hub, numpy, torch, safetensors, moshi; print("TTS packages verified")'

# Generate custom script from this precise installed server's embedded source.
# Use the interpreter matching system libpython for stdlib, venv only for packages.
"$SYS_PY" - "$SYS_PY" "$VENV" "$BIN" "$CFG" "$NEW_SCRIPT" "$NEW_CFG" <<'PY'
import pathlib, subprocess, sys, sysconfig
sys_py, venv, binary, old_cfg, new_script, new_cfg = sys.argv[1:]
stdlib = pathlib.Path(sysconfig.get_path("stdlib"))
dynload = stdlib / "lib-dynload"
site = pathlib.Path(venv)/"lib/python3.12/site-packages"
for p in (stdlib, dynload, site):
    if not p.is_dir():
        raise SystemExit(f"Required Python path missing: {p}")
# sys.path of the installed system interpreter may include dist-packages; we prefer
# a minimal controlled list with the correct native stdlib and preinstalled venv.
paths = [str(stdlib), str(dynload), str(site)]
script = subprocess.check_output([binary, "configs", "tts.py"], text=True)
config = pathlib.Path(old_cfg).read_text()
if "[modules.tts_py]\n" not in config:
    raise SystemExit("Missing TTS config header")
if "from __future__ import" in script:
    raise SystemExit("Unexpected future-import in embedded script, stopping")
preamble = (
    "import sys\n"
    f"sys.path[:] = {paths!r}\n"
    "import _contextvars\n"
    "import numpy\n"
    "print('MSS SYSTEM PYTHON PATH OK', sys.version, flush=True)\n"
)
pathlib.Path(new_script).write_text(preamble+script)
pathlib.Path(new_cfg).write_text(config.replace(
    "[modules.tts_py]\n",
    f'[modules.tts_py]\nscript = "{new_script}"\n',
    1,
))
print("Using Python library directories:", paths)
print("Isolated patched files created.")
PY
"$SYS_PY" -m py_compile "$NEW_SCRIPT"
echo "Patched TTS script syntax verified."

if curl --max-time 2 -fsS http://127.0.0.1:8089/api/build_info >/dev/null 2>&1; then
  echo "TTS is already running on 8089. Not restarting it."
  curl --max-time 5 -sS http://127.0.0.1:8000/v1/health || true
  exit 0
fi
if ss -ltnp | grep -qE '[:.]8089[[:space:]]'; then
  echo "Port 8089 is occupied but not healthy; inspect it before retrying."
  ss -ltnp | grep ':8089' || true
  exit 1
fi
tmux kill-session -t mss-tts-explanation 2>/dev/null || true
mkdir -p /root/static /tmp/unmute_logs

# Explicit system Python home for the Python 3.12.3 libpython linked to moshi-server.
tmux new-session -d -s mss-tts-explanation \
  "cd /root && \
   export PYTHONHOME=/usr \
          PYTHONPATH=/usr/lib/python3.12:/usr/lib/python3.12/lib-dynload:/root/unmute-tts-venv/lib/python3.12/site-packages \
          VIRTUAL_ENV=/root/unmute-tts-venv \
          PATH=/root/unmute-tts-venv/bin:\$PATH \
          HOME=/root HF_HOME=/root/.cache/huggingface \
          XDG_CACHE_HOME=/root/.cache TMPDIR=/tmp PYTHONDONTWRITEBYTECODE=1 && \
   exec $BIN worker --config $NEW_CFG --port 8089 > $LOG 2>&1"

echo "TTS startup requested..."
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
echo "=== IMPORTANT LOG LINES ==="
grep -E 'MSS SYSTEM PYTHON PATH|Error:|Traceback|ModuleNotFoundError|ImportError|quota exceeded|CUDA|out of memory' "$LOG" | tail -n 20 || true
echo "=== HEALTH ==="
curl --max-time 8 -sS http://127.0.0.1:8000/v1/health || true
echo
echo "=== LAST 25 LOG LINES ==="
tail -n 25 "$LOG"
test "$READY" -eq 1
