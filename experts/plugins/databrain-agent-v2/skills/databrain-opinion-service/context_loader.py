"""Load AgentContext from environment variable.

The react agent injects AGENT_CONTEXT_JSON into the subprocess environment.
All tools should call get_context() to obtain the current AgentContext instance.
"""
import os
from opinion_strategy.context import AgentContext

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
        _cached_context = AgentContext.model_validate_json(raw)
    else:
        _cached_context = AgentContext()
    return _cached_context


def reset_context():
    """Reset cached context (for testing)."""
    global _cached_context
    _cached_context = None
