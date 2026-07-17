from __future__ import annotations
"""Stub: tools.tool_common — no-op decorators for react agent skills."""


def function_tool(**kwargs):
    """No-op decorator. Returns the function unchanged."""
    def decorator(func):
        return func
    return decorator


def get_tool_enabled(tool_name: str):
    """Always returns a callable that returns True."""
    def _check(*args, **kwargs):
        return True
    return _check


def is_tool_enabled_for_current_step(tool_name: str, context=None) -> bool:
    """Always returns True — all tools enabled in react agent."""
    return True
