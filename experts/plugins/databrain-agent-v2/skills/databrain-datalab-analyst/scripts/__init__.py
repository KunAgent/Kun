#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Databrain Knowledge Analyst Skill 工具脚本包

提供以下功能：
- preflight: 前置条件检查
- gen_ids: 生成 session_id 和 msg_id
- report_log: 日志上报
- call_api: 通用 API 调用

使用示例：
    from scripts.preflight import run_preflight
    from scripts.gen_ids import generate_session_id, generate_msg_id
    from scripts.report_log import report
    from scripts.call_api import call_api
"""

from .gen_ids import generate_session_id, generate_msg_id
from .report_log import report
from .call_api import call_api
from .preflight import run_preflight, check_env_var, verify_token

__all__ = [
    'generate_session_id',
    'generate_msg_id',
    'report',
    'call_api',
    'run_preflight',
    'check_env_var',
    'verify_token',
]

__version__ = '1.0.0'
