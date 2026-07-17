from __future__ import annotations
"""Load AgentContext from environment variable or temp file."""
import json
import os
from utils.context import AgentContext

_cached_context = None


def get_context() -> AgentContext:
    global _cached_context
    if _cached_context is not None:
        return _cached_context
    raw = os.environ.get("AGENT_CONTEXT_JSON", "")
    if not raw:
        ctx_file = os.environ.get("AGENT_CONTEXT_FILE", "") or "/tmp/databrain_agent_ctx.json"
        if ctx_file and os.path.exists(ctx_file):
            with open(ctx_file, "r", encoding="utf-8") as f:
                raw = f.read()
    if raw:
        payload = json.loads(raw)
        if isinstance(payload, dict) and payload.get("mgmt_info") is None:
            payload["mgmt_info"] = {}
        _cached_context = AgentContext.model_validate(payload)
    else:
        _cached_context = AgentContext()
    return _cached_context


def reset_context():
    global _cached_context
    _cached_context = None
