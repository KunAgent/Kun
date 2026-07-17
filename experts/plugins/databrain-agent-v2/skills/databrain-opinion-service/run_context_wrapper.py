"""Thin RunContextWrapper shim for backward compatibility.

Tools that use context.context.xxx will continue to work unchanged.
The wrapper loads context from environment variable via context_loader.
"""
from context_loader import get_context


class RunContextWrapper:
    """Minimal shim: wraps AgentContext so that context.context.field still works."""
    def __init__(self, context=None):
        if context is None:
            context = get_context()
        self.context = context

    @classmethod
    def __class_getitem__(cls, _item):
        return cls
