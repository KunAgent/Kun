"""Shared helpers for databrain-opinion-metrics-service scripts.

- get_token / require_token: 读取 API token（环境变量 DATABRAIN_TOKEN）
- get_host:                  读取 API host（环境变量 DATABRAIN_HOST），三级优先级 CLI > env > 默认值
- get_display_host:          读取回答展示链接 host（可选 DATABRAIN_DISPLAY_HOST）
- check_http_auth:           统一处理 401/403 并给出友好提示

设计：单一 host，由上层 react_agent_service 通过 databrain_config.host 注入到
DATABRAIN_HOST 环境变量。不再做多主机 probe / 信任域校验（与 text2sql 风格对齐）。
"""

from __future__ import annotations

import os
import sys

TOKEN_ENV = "DATABRAIN_TOKEN"
HOST_ENV = "DATABRAIN_HOST"
DISPLAY_HOST_ENV = "DATABRAIN_DISPLAY_HOST"

DEFAULT_HOST = "https://databrain.intlgame.com"

TOKEN_HELP = (
    "请设置 DataBrain 请求 token（原始值，不含 Bearer 前缀）。\n"
    "请先设置系统环境变量：export DATABRAIN_TOKEN=<token>\n"
    "Token 获取地址：https://databrain.woa.com/v2/user-center/personal-tokens-center"
)


def get_token(cli_token: str | None = None) -> str:
    """读取 API token，优先级: 命令行参数 > 系统环境变量 DATABRAIN_TOKEN。"""
    if cli_token:
        return cli_token.strip()
    return os.environ.get(TOKEN_ENV, "").strip()


def get_host(cli_host: str | None = None, default: str = DEFAULT_HOST) -> str:
    """读取 API host，优先级: 命令行参数 > 系统环境变量 DATABRAIN_HOST > 默认值。"""
    if cli_host:
        return cli_host.strip().rstrip("/")
    return os.environ.get(HOST_ENV, default).strip().rstrip("/")


def get_display_host(default: str = "") -> str:
    """读取回答中展示链接的 host，优先使用 DATABRAIN_DISPLAY_HOST。"""
    return os.environ.get(DISPLAY_HOST_ENV, default).strip()


def require_token(cli_token: str | None = None) -> str:
    """读取 token；为空则打印提示并退出。"""
    token = get_token(cli_token)
    if not token:
        print(f"\n❌ 未找到 API Token (环境变量 {TOKEN_ENV})。\n{TOKEN_HELP}\n", file=sys.stderr)
        sys.exit(1)
    return token


def check_http_auth(resp) -> None:
    """在 raise_for_status 之前拦截 401/403，给出友好提示。"""
    if resp.status_code == 401:
        print(f"\n❌ 认证失败 (HTTP 401): Token 无效或已过期。\n{TOKEN_HELP}\n", file=sys.stderr)
        sys.exit(1)
    if resp.status_code == 403:
        print(
            "\n❌ 无权限 (HTTP 403): 当前用户没有该数据的访问权限。\n"
            "请联系数据管理员申请对应 game_code / 数据表的权限。\n",
            file=sys.stderr,
        )
        sys.exit(1)


# ---- Backward-compat: 早期版本暴露过 _is_trusted_host，保留空实现避免 import 错 -------
def _is_trusted_host(host: str) -> bool:  # noqa: D401 - 兼容占位
    """已废弃；新版不做信任域校验。保留是为了兼容外部 import。"""
    return True
