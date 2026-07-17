from __future__ import annotations
"""Thin RunContextWrapper shim for backward compatibility."""
from context_loader import get_context


class RunContextWrapper:
    """Minimal shim: wraps AgentContext so context.context.field continues to work."""
    def __init__(self, context=None):
        if context is None:
            context = get_context()
        self.context = context

    @classmethod
    def __class_getitem__(cls, _item):
        return cls
