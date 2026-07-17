"""Stub: common.rainbow_utils — no-op in react agent skills.

Rainbow config is already in AgentContext.rb_config.
"""
from loguru import logger


def init_rainbow(*args, **kwargs):
    logger.debug("init_rainbow no-op in react agent skill")
    pass
