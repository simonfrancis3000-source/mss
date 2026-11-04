# MSS Unmute experiment: migrate from always-on Pod to pay-per-use Runpod Serverless

Status: **target architecture documented; NOT deployed**. No production change.
Created 2026-11-04.

## Motivation
Previous Runpod Pod `mm3pcre11b8rw9` (MSS-Unmute-Test) is STOPPED/EXITED.
GPU: NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb.
Pod was $0.69/hr, accrued roughly $15 in two days while allocated.
Existing 50 GB /workspace volume still incurs storage charges until terminated.

## Target configuration
- Runpod Serverless **LOAD_BALANCER** endpoint; websocket support required.
- Flex workers, `workers.min=0`, `workers.max=1`.
- GPU: same 24 GB MIG tier initially. Runpod catalogue listed $0.75/hr (2026-11-04) serverless active time. Recheck before deployment.
- Short idle timeout (5s initial, consider 30-60s if long gaps in voice interactions); scale to zero.
- Request-count scaling for responsive startup.
- Zero always-on (active) workers.
- Cap concurrency at one until reliability and cost metrics are confirmed.
- No new network volume by default; prefer model/image caching to avoid recurring storage. Use persistent storage only if necessary for cold-start performance.
- Watch spend from `list_serverless_billing` and user-visible monitoring.

## Architecture
Always-on CPU plane: MSS web/login + Supabase read-only profile access + AMÏA text adapter (existing Render and Supabase resources), providing authenticated browser front and forwarding WebSocket to the GPU endpoint. Keep Runpod authorization/API keys server-side; the browser must not receive them.

On-demand GPU worker: Unmute websocket backend :8000, Kyutai streaming STT :8090, Kyutai streaming TTS :8089 (Explanation for evaluation). No local vLLM. The Runpod load balancer must route a WebSocket to the Unmute handler and expose a health/ping endpoint. GPU process supervisor starts all 3 processes and only reports readiness when models have loaded.

The current experimental Runpod `bridge.cjs` uses in-memory sessions; move it off the GPU or replace this with a durable, token-validated CPU gateway before scaling down. Preserve the signed-in user's persona and AMÏA history; do not use a fabricated persona on transient Supabase 503. Existing Supabase policy must be respected.

## Deployment prerequisites
1. Build and publish a **new reproducible multi-process Docker image**, pinned Python/Rust versions and Kyutai checkpoints. The existing Pod template is not a Serverless worker; don't deploy it as an endpoint. Original /root data, including venvs and downloaded voices, is lost when the Pod stops, so the fix must live in the image or startup scripts.
2. Serverless load balancer routing and websocket authorization via CPU gateway, including websocket subprotocol `realtime`.
3. Test cold start, one complete bidirectional voice session, reconnect and scale-to-zero. Verify audio and correct TTS Explanation embedding. Protect user data.
4. Security assessment and production voice licensing review. The Kyutai Explanation voice is sourced from Expresso with noncommercial licensing; this is **evaluation only**, not production distribution.
5. Check actual account credits before first GPU invocation. A serverless endpoint with zero workers does not incur GPU idle compute; first test invocation does incur GPU startup/execution charges.
6. Only consider terminating old Pod after confirming nothing irreplaceable remains on its 50GB /workspace volume. Termination erases that volume.

## Acceptance tests
- No GPU worker running when no test is active; no GPU charges while scaled to zero.
- A signed-in user can establish WS realtime audio, see STT text, receive AMÏA reply and synthesized TTS.
- Account-specific context is preserved across worker cold starts.
- 30 minutes of one user conversation has an auditable billed GPU-seconds total and acceptable latency.
- Production MSS / Phonic remain untouched.
- Idle storage charges are disclosed separately from GPU runtime charges.

References:
- https://docs.runpod.io/serverless/pricing
- https://docs.runpod.io/serverless/load-balancing/build-a-worker
- https://docs.runpod.io/serverless/endpoints/endpoint-configurations
- https://docs.runpod.io/pods/storage/types
- https://github.com/kyutai-labs/unmute
