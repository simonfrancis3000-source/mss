#!/usr/bin/env python3
"""Force Kyutai's Explanation voice for a single isolated MSS/Unmute evaluation.
This wrapper doesn't modify the production MSS application or Unmute source files.
"""
import logging
import os
import sys

sys.path.insert(0, "/workspace/unmute")

VOICE = "unmute-prod-website/ex04_narration_longform_00001.wav"
os.environ["KYUTAI_LLM_URL"] = "http://127.0.0.1:8093"
os.environ["KYUTAI_LLM_MODEL"] = "mss-amia"
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

from unmute.unmute_handler import UnmuteHandler  # noqa: E402
import uvicorn  # noqa: E402

previous_update_session = UnmuteHandler.update_session

async def enforce_explanation(self, session):
    previously_requested = session.voice
    session.voice = VOICE
    logging.getLogger("mss.voice").info(
        "MSS Explanation voice pinned for new session; frontend requested %r; TTS voice %r",
        previously_requested, VOICE
    )
    return await previous_update_session(self, session)

UnmuteHandler.update_session = enforce_explanation

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("mss.voice").info("Explanation voice override enabled: %s", VOICE)
    uvicorn.run("unmute.main_websocket:app", host="0.0.0.0", port=8000, ws_per_message_deflate=False)
