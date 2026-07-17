#!/usr/bin/env python3
"""
统一身份工具函数。

所有需要获取操作用户名的脚本，统一通过 get_effective_user() 获取。
优先级：TIANQIONG_PROXY_USERNAME > KNOT_USERNAME > fallback_user。

用法（在业务脚本中）：
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'SkillBase', 'skill-context', 'scripts'))
    from auth_utils import get_effective_user

    user = get_effective_user(config_user)
"""

import os

# 环境变量名（按优先级排列）
PROXY_USER_ENV = "TIANQIONG_PROXY_USERNAME"
KNOT_USER_ENV = "KNOT_USERNAME"


def get_effective_user(fallback_user: str = "") -> str:
    """获取当前有效操作用户名。

    优先级：TIANQIONG_PROXY_USERNAME > KNOT_USERNAME > fallback_user。

    Args:
        fallback_user: 回退用户名，通常从 config.json 的 user 字段传入。

    Returns:
        有效的用户名字符串。
    """
    proxy_user = os.environ.get(PROXY_USER_ENV, "").strip()
    if proxy_user:
        return proxy_user
    knot_user = os.environ.get(KNOT_USER_ENV, "").strip()
    if knot_user:
        return knot_user
    return fallback_user


def is_agent_mode() -> bool:
    """判断当前是否为中心化 Agent 模式。

    任一环境变量非空即视为 Agent 模式。
    """
    return bool(
        os.environ.get(PROXY_USER_ENV, "").strip()
        or os.environ.get(KNOT_USER_ENV, "").strip()
    )
