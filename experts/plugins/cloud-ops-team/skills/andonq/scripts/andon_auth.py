#!/usr/bin/env python3
"""
AndonQ OAuth2 临时码本地存储与授权 URL 生成模块

职责：
    1) 提供统一的 OAuth2 授权 URL 构造（带随机 state，防 CSRF）
    2) 提供 ~/.andonq/auth.json 的读写接口（临时码落盘与加载）

存储格式（~/.andonq/auth.json，权限 0600）:
    {"token": "<临时码>", "obtained_at": <Unix 秒级时间戳>}
    兼容读取：旧版 ISO8601 字符串会自动解析为秒级整数

本模块无项目内依赖，可被 check_env.py / scripts/andon_sse_api.py 等同时 import。

作为模块导入:
    from andon_auth import (
        AUTH_HEADER, AUTH_FILE, CONFIG_DIR,
        build_authorize_url, load_auth_code, save_auth_code,
    )

作为 CLI 调用（供 AI Agent 直接保存用户粘贴的临时码）:
    python3 andon_auth.py --save '<用户粘贴的临时码>'   # 保存到 ~/.andonq/auth.json，输出单行 JSON
    python3 andon_auth.py --authorize-url                # 仅打印带随机 state 的授权 URL
"""

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

# 匹配授权页面直接复制的整行格式："X-<token>-TANDON-CODE"
# 仅提取中间那段纯 token
_TOKEN_INLINE_RE = re.compile(r"^X-(.+?)-TANDON-CODE$", re.IGNORECASE)

def _extract_token(raw: str) -> str:
    """从用户输入中提取纯 token。

    容错两种格式：
      1) 整行复制格式： "X-<token>-TANDON-CODE"    -> 返回 <token>
      2) 纯 token：          "<token>"                  -> 原样返回

    前后空白会被 trim；输入为空时返回空串。
    """
    if not raw:
        return ""
    s = raw.strip()
    m = _TOKEN_INLINE_RE.match(s)
    if m:
        return m.group(1).strip()
    return s

# ---------------------------------------------------------------------------
# 存储路径 & HTTP Header 名称
# ---------------------------------------------------------------------------
CONFIG_DIR = Path.home() / ".andonq"
AUTH_FILE = CONFIG_DIR / "auth.json"
AUTH_HEADER = "X-TANDON-CODE"

# ---------------------------------------------------------------------------
# OAuth2 授权端点（腾讯云开放平台）
# ---------------------------------------------------------------------------
AUTHORIZE_ENDPOINT = "https://cloud.tencent.com/open/authorize"
AUTHORIZE_APP_ID = "100048267608"
AUTHORIZE_REDIRECT_URL = "http://andon.qq.com/oauth/aq/callback"
AUTHORIZE_SCOPE = "login"


def build_authorize_url() -> str:
    """构造一个带随机 state 的 OAuth2 授权 URL（防 CSRF）。

    state 每次调用均使用新的 uuid4.hex。如需稳定 URL
    （如打印后多次复用），请先缓存返回值。
    """
    params = {
        "app_id": AUTHORIZE_APP_ID,
        "redirect_url": AUTHORIZE_REDIRECT_URL,
        "scope": AUTHORIZE_SCOPE,
        "state": uuid.uuid4().hex,
    }
    return f"{AUTHORIZE_ENDPOINT}?{urlencode(params)}"


def _coerce_obtained_at(raw) -> int:
    """将 auth.json 中的 obtained_at 字段归一化为秒级整数时间戳。

    兼容以下形式：
      - int / float：当作 Unix 时间戳（float 截断为秒）
      - ISO8601 字符串（旧版本写入）：解析为秒级时间戳
      - 其他无法识别：返回 0
    """
    if isinstance(raw, bool):
        return 0
    if isinstance(raw, (int, float)):
        try:
            return int(raw)
        except (ValueError, OverflowError):
            return 0
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return 0
        # 纯数字字符串（历史上可能有手工填写）
        if s.lstrip("-").isdigit():
            try:
                return int(s)
            except ValueError:
                return 0
        # ISO8601 旧格式兼容
        try:
            # Python 3.7+ 不支持带 Z 后缀，统一替换为 +00:00
            normalized = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except (ValueError, TypeError):
            return 0
    return 0

def load_auth_code() -> tuple:
    """
    从 ~/.andonq/auth.json 读取临时码及绑定时间。

    Returns:
        tuple[str, int]: (token, obtained_at)
            - token: 临时码；不存在或读取失败时为空串
            - obtained_at: Unix 秒级时间戳整数；不存在/读取失败/无法解析时为 0
    """
    if not AUTH_FILE.exists():
        return "", 0
    try:
        data = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
        # 已落盘数据上做一次兑底提取，兼容人工编辑或旧版本直接写入的原始复制格式
        token = _extract_token(data.get("token") or "")
        obtained_at = _coerce_obtained_at(data.get("obtained_at"))
        return token, obtained_at
    except (json.JSONDecodeError, OSError):
        return "", 0


def save_auth_code(token: str) -> None:
    """
    将临时码写入 ~/.andonq/auth.json（权限 0600）。

    Args:
        token: 从授权页面复制的临时码。可以是以下任一格式：
               - "<token>"                    （纯 token）
               - "X-<token>-TANDON-CODE"      （整行复制格式，自动提取中间 token）
    """
    token = _extract_token(token)
    if not token:
        raise ValueError("临时码不能为空")
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "token": token,
        "obtained_at": int(time.time()),  # Unix 秒级时间戳
    }
    AUTH_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    try:
        os.chmod(AUTH_FILE, 0o600)
    except OSError:
        # Windows 上 chmod 可能不生效，忽略即可
        pass


# ---------------------------------------------------------------------------
# CLI 入口：供 AI Agent 直接一行命令保存用户粘贴的临时码
#
# 用法:
#     python3 andon_auth.py --save '<用户粘贴的临时码>'
#     python3 andon_auth.py --authorize-url            # 打印带随机 state 的授权 URL
#
# 输出格式（stdout 单行 JSON）:
#     {"success": true,  "token_masked": "****xxxx", "obtained_at": <Unix 秒级时间戳>}
#     {"success": false, "error": "<reason>"}
# ---------------------------------------------------------------------------
def _mask(token: str, visible: int = 4) -> str:
    """脱敏：保留末尾 visible 位，其余用 * 填充"""
    if len(token) <= visible:
        return "*" * len(token)
    return "*" * (len(token) - visible) + token[-visible:]


def _cli_save(raw_token: str) -> int:
    try:
        save_auth_code(raw_token)
    except ValueError as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        return 2
    except OSError as e:
        print(json.dumps({"success": False, "error": f"写入失败: {e}"}, ensure_ascii=False))
        return 2

    token, obtained_at = load_auth_code()
    print(json.dumps({
        "success": True,
        "token_masked": _mask(token),
        "obtained_at": obtained_at,
        "auth_file": str(AUTH_FILE),
    }, ensure_ascii=False))
    return 0


def _cli_print_url() -> int:
    print(json.dumps({"success": True, "authorize_url": build_authorize_url()},
                     ensure_ascii=False))
    return 0


def _main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] == "--save":
        if len(argv) < 3:
            print(json.dumps({"success": False,
                              "error": "缺少参数：python3 andon_auth.py --save '<临时码>'"},
                             ensure_ascii=False))
            return 2
        return _cli_save(argv[2])
    if len(argv) >= 2 and argv[1] == "--authorize-url":
        return _cli_print_url()
    print(json.dumps({
        "success": False,
        "error": "用法: python3 andon_auth.py --save '<临时码>' | --authorize-url",
    }, ensure_ascii=False))
    return 2


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv))
