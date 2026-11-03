# Experimental MySecondSelf / Unmute bridge

This bridge keeps the production SYNQ.ME UI, AMÏA service, Supabase database, and Phonic pipeline unchanged.

It is an experimental one-user, read-only demonstration. The bridge signs in through Supabase Auth using the Cloudflare Turnstile site key, then fetches the signed-in user's profile, existing preferences and conversation messages with row-level security, calls the existing authenticated AMÏA `/api/chat` endpoint in spoken mode, and presents its reply as OpenAI-compatible streaming chunks to Unmute.

## Prerequisites

- Working Runpod Unmute demo from preceding conversation, website inside `/root/mss-unmute-frontend`, backend on 8000, STT on 8090, TTS on 8089, GPU Gemma LLM on 8091, Next website on 3002 and port 3000 proxy.
- Cloudflare Turnstile widget for public sitekey `0x4AAAAAAFxQtK2-J-A-K9oc` must allow `mm3pcre11b8rw9-3000.proxy.runpod.net`. Only the exact hostname is required; remove it after testing.
- Do not publish the Runpod URL or give untrusted people access to the test.

## Installation

Place `bridge.cjs` and `install.sh` in `/root/mss-unmute-frontend`, then run:

```bash
bash /root/mss-unmute-frontend/install.sh
```

It replaces only the `unmute-proxy` tmux session with `unmute-amia`, and starts a private LLM adapter at 127.0.0.1:8093.

Visit `https://mm3pcre11b8rw9-3000.proxy.runpod.net/mss/login` and sign in. Confirm account context at `/mss/status`.

To switch Unmute from Gemma to AMÏA, stop only the Uvicorn **backend** terminal (Ctrl+C), then restart it:

```bash
cd /workspace/unmute
export PYTHONDONTWRITEBYTECODE=1
export KYUTAI_LLM_URL=http://127.0.0.1:8093
export KYUTAI_LLM_MODEL=mss-amia
/root/unmute-backend-venv/bin/python -B -m uvicorn \
  unmute.main_websocket:app --host 0.0.0.0 --port 8000 \
  --ws-per-message-deflate=false
```

In a different Runpod terminal, verify:

```bash
curl -sS http://127.0.0.1:8000/v1/health
curl -sS -b "$(echo 'mss_voice_test=not-a-real-session')" http://127.0.0.1:3000/mss/status
```

The first should report all required model services healthy. The second will redirect to sign-in until browser authentication.

## Revert to Gemma

Stop only the backend Uvicorn terminal, unset `KYUTAI_LLM_URL`/`KYUTAI_LLM_MODEL`, and launch the original backend command; replace bridge proxy with the original proxy:

```bash
tmux kill-session -t unmute-amia 2>/dev/null || true
tmux new-session -d -s unmute-proxy \
  'cd /root/mss-unmute-frontend && node proxy.cjs > /root/unmute-proxy.log 2>&1'
```

## Security and limitations

- No secret service-role keys; only the project's publishable key is used.
- Requires existing MSS email/password authentication and valid Cloudflare Turnstile challenge.
- Auth tokens are held in memory only and expire after six hours; no credentials written to disk.
- The proxy guards the UI and WebSocket connection using a secure HTTP-only cookie.
- Not for public or multi-user deployment.
- The first test is intentionally **read-only**. It loads prior MSS history but does not save new answers to Supabase. New answers persist only within the current Unmute session.
- The MSS `/api/chat` endpoint does not stream; the bridge can stream its completed answer to TTS, but first-audio latency will reflect that API's full response latency.