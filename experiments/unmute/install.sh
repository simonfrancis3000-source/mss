#!/usr/bin/env bash
set -euo pipefail
APP=/root/mss-unmute-frontend
[ -d "$APP/node_modules/http-proxy" ] || { echo 'Missing browser dependencies: /root/mss-unmute-frontend/node_modules/http-proxy'; exit 1; }
[ -f "$APP/bridge.cjs" ] || { echo 'Missing bridge.cjs in browser directory'; exit 1; }
export MSS_SUPABASE_PUBLISHABLE_KEY='sb_publishable_R3Sl3WZEGDmpzhdeG3Jj7A_ERmuozw3'
export MSS_TURNSTILE_SITE_KEY='0x4AAAAAAFxQtK2-J-A-K9oc'
node --check "$APP/bridge.cjs"
cat > /root/start-mss-amia-proxy.sh <<'START'
#!/usr/bin/env bash
cd /root/mss-unmute-frontend
export MSS_SUPABASE_PUBLISHABLE_KEY='sb_publishable_R3Sl3WZEGDmpzhdeG3Jj7A_ERmuozw3'
export MSS_TURNSTILE_SITE_KEY='0x4AAAAAAFxQtK2-J-A-K9oc'
exec node bridge.cjs
START
chmod 700 /root/start-mss-amia-proxy.sh
if tmux has-session -t unmute-proxy 2>/dev/null; then tmux kill-session -t unmute-proxy; fi
if tmux has-session -t unmute-amia 2>/dev/null; then tmux kill-session -t unmute-amia; fi
tmux new-session -d -s unmute-amia 'bash /root/start-mss-amia-proxy.sh > /root/unmute-amia-bridge.log 2>&1'
sleep 1
echo '=== Local AMIA model endpoint ==='
curl -fsS http://127.0.0.1:8093/v1/models || { echo 'Check /root/unmute-amia-bridge.log'; exit 1; }
echo; echo '=== Browser sign-in redirect ==='
curl -sSI http://127.0.0.1:3000/ | head -6
echo '=== Existing voice backend ==='
curl -fsS http://127.0.0.1:8000/v1/health
echo
echo 'Bridge is ready. Sign in via https://mm3pcre11b8rw9-3000.proxy.runpod.net/mss/login after allowing its hostname in Cloudflare Turnstile.'
echo 'IMPORTANT: Until the Unmute backend is restarted with KYUTAI_LLM_URL=http://127.0.0.1:8093 and KYUTAI_LLM_MODEL=mss-amia, Gemma remains the voice LLM.'