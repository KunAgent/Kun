"""Stub: common.config — globalvar reads from AgentContext.rb_config."""

import os
import random
import traceback
from loguru import logger


class _ExaManagerShim:
    """Lightweight EXA client manager that round-robins across API keys."""

    def __init__(self, api_keys: list):
        from exa_py import AsyncExa
        assert len(api_keys) > 0, "exa_api_key_list is empty"
        self.exas = [AsyncExa(api_key=k) for k in api_keys]

    async def search_and_contents(self, query, **kwargs):
        last_ex = None
        max_tries = min(len(self.exas), 3)
        for _ in range(max_tries):
            exa = random.choice(self.exas)
            try:
                return await exa.search_and_contents(query, **kwargs)
            except Exception as e:
                last_ex = e
                logger.error(
                    "exa error token_prefix={}: {}",
                    getattr(exa, "headers", {}).get("x-api-key", "")[:10],
                    traceback.format_exc(),
                )
        if last_ex is not None:
            raise last_ex
        raise RuntimeError("No EXA clients available")


class _GlobalVarShim:
    def __init__(self):
        self._ctx = None
        self._exa_client = None

    def _get_ctx(self):
        if self._ctx is None:
            from context_loader import get_context
            self._ctx = get_context()
        return self._ctx

    def _get_exa(self):
        if self._exa_client is None:
            ctx = self._get_ctx()
            rb = ctx.rb_config or {}
            api_keys = rb.get("exa_api_key_list", [])
            if api_keys:
                try:
                    self._exa_client = _ExaManagerShim(api_keys)
                except Exception:
                    logger.warning("Failed to init EXA client: {}", traceback.format_exc())
            else:
                logger.warning("exa_api_key_list not found in rb_config, EXA search disabled")
        return self._exa_client

    def get_value(self, name: str, defValue=None, expected_type=None):
        # Lazily-created client objects
        if name == "exa":
            return self._get_exa() or defValue

        ctx = self._get_ctx()
        rb = ctx.rb_config or {}
        key_map = {
            # rb_system_json maps to the entire rb_config dict (tools call .get("databrain_config"), etc.)
            "rb_system_json": rb,
            # strategy/test/url configs
            "rb_strategy_json": rb.get("rb_strategy_json", rb.get("strategy_json", {})),
            "rb_url_map_json": rb.get("rb_url_map_json", rb.get("url_map", {})),
            "rb_test_json": rb.get("rb_test_json", rb.get("test_json", {})),
            # direct sub-keys
            "agent_config": rb.get("agent_config", {}),
            "ENV": rb.get("ENV", os.environ.get("ENVIRONMENT", "local")),
            # SUPPORTED_METRICS_AND_SOURCES — may be stored lowercase by _build_rb_config_snapshot
            "SUPPORTED_METRICS_AND_SOURCES": rb.get("SUPPORTED_METRICS_AND_SOURCES",
                                                     rb.get("supported_metrics_and_sources", {})),
        }
        if name in key_map:
            return key_map[name]
        # Fallback: try exact key, then lowercase variant
        if name in rb:
            return rb[name]
        lower_name = name.lower()
        if lower_name in rb:
            return rb[lower_name]
        return defValue

    def set_value(self, name: str, value):
        pass


globalvar = _GlobalVarShim()
