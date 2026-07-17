"""Stub: rainbow_utils — no-op in standalone skill.

All config is embedded in dashboard_common/builtin_config.py.
No Rainbow SDK required.
"""
from loguru import logger


def init_rainbow(*args, **kwargs):
    logger.debug("init_rainbow no-op in standalone skill")
    pass
