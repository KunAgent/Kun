"""Load AgentContext for standalone dashboard skill.

- Token: from DATABRAIN_TOKEN env var (user sets once, determines game permissions)
- All other config: built-in (embedded from Rainbow system.json)
"""
import os
from loguru import logger
from dashboard_strategy.context import AgentContext
from dashboard_common.builtin_config import build_rb_config

_cached_context = None


def get_context() -> AgentContext:
    global _cached_context
    if _cached_context is not None:
        return _cached_context

    token = os.environ.get("DATABRAIN_TOKEN", "")
    if not token:
        raise RuntimeError(
            "DATABRAIN_TOKEN environment variable is required. "
            "Set it before using the skill: export DATABRAIN_TOKEN='your_token'"
        )

    rb_config = build_rb_config()

    _cached_context = AgentContext(
        token=token,
        message_id="standalone_skill",
        rb_config=rb_config,
    )
    return _cached_context


def reset_context():
    """Reset cached context (for testing or token change)."""
    global _cached_context
    _cached_context = None
