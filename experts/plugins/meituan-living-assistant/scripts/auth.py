#!/usr/bin/env python3
"""
huisheng-coupon-tool 认证模块
管理 device_token（下单时的 uuid 参数）。Token 有效期由 pt-passport CLI 管理。

用法示例：
  python auth.py get-device-token
  python auth.py logout
  python auth.py clear-device-token
"""

import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path

# ── 常量 ──────────────────────────────────────────────────────────────
AUTH_KEY = "meituan-c-user-auth"

# pt-passport 客户端 ID
CLIENT_ID = "c6f50b5a1e2f4e2bb00a3e2f58df3ced"


def _resolve_auth_file() -> Path:
    """
    跨平台确定存储路径，优先级：
    1. 环境变量 WORKBUDDY_AUTH_FILE（显式指定，最高优先级）
    2. ~/.workbuddy/credentials/meituan-order/token.json
    """
    import os

    env_path = os.environ.get("WORKBUDDY_AUTH_FILE")
    if env_path:
        return Path(env_path)

    return Path.home() / ".workbuddy" / "credentials" / "meituan-living-deals-assistant" / "token.json"


AUTH_FILE = _resolve_auth_file()


# ── 设备ID生成 ────────────────────────────────────────────────────────

def generate_device_token(seed: str) -> str:
    """
    生成设备唯一标识（device_token）。
    算法：MD5（seed + 毫秒时间戳 + 0~1000随机整数）
    device_token 与设备绑定，一旦生成后永不覆盖。
    """
    ts_ms = int(time.time() * 1000)
    rand_int = random.randint(0, 1000)
    raw = f"{seed}{ts_ms}{rand_int}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


# ── 存储操作 ──────────────────────────────────────────────────────────

def load_auth() -> dict:
    if AUTH_FILE.exists():
        with open(AUTH_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_auth(data: dict):
    import os, stat
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(AUTH_FILE, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def get_token_data() -> dict:
    return load_auth().get(AUTH_KEY, {})


def save_token_data(token_data: dict):
    auth = load_auth()
    auth[AUTH_KEY] = token_data
    save_auth(auth)


def _ensure_device_token(token_data: dict) -> str:
    """确保 device_token 存在，不存在则生成并持久化，返回 device_token"""
    dt = token_data.get("device_token", "")
    if not dt:
        dt = generate_device_token("huisheng")
        token_data["device_token"] = dt
        save_token_data(token_data)
    return dt


# ── 命令：get-device-token ───────────────────────────────────────────

def cmd_get_device_token():
    """获取 device_token，不存在则自动生成"""
    token_data = get_token_data()
    device_token = _ensure_device_token(token_data)
    print(json.dumps({
        "success": True,
        "device_token": device_token
    }, ensure_ascii=False))


# ── 命令：logout ─────────────────────────────────────────────────────

def cmd_logout():
    """退出登录：清除 pt-passport CLI 缓存，保留 device_token"""
    import subprocess

    # 清除 pt-passport CLI 本地缓存的 Token
    cli_cleared = False
    import os
    env = os.environ.copy()
    # 清空 NODE_OPTIONS：pt-passport 是 node CLI，避免宿主注入的选项污染输出或引发异常
    env["NODE_OPTIONS"] = ""
    env["PT_PASSPORT_AUTH_FILE"] = str(AUTH_FILE.parent / "pt_passport_auth.json")
    try:
        result = subprocess.run(
            ["pt-passport", "logout", "--client_id", CLIENT_ID],
            capture_output=True, text=True, timeout=10, env=env
        )
        cli_cleared = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass  # CLI 不存在或超时，忽略

    token_data = get_token_data()
    device_token = token_data.get("device_token", "")

    print(json.dumps({
        "success": True,
        "message": "已退出登录，下次需重新授权",
        "device_token_preserved": bool(device_token),
        "cli_cache_cleared": cli_cleared
    }, ensure_ascii=False))


# ── 命令：clear-device-token ─────────────────────────────────────────

def cmd_clear_device_token():
    """清除设备标识，仅在用户明确要求时调用"""
    import subprocess

    token_data = get_token_data()
    had_device_token = bool(token_data.get("device_token"))

    # 清除 device_token
    token_data["device_token"] = ""
    save_token_data(token_data)

    # 同时清除 pt-passport CLI 缓存
    import os
    env = os.environ.copy()
    # 清空 NODE_OPTIONS：pt-passport 是 node CLI，避免宿主注入的选项污染输出或引发异常
    env["NODE_OPTIONS"] = ""
    try:
        subprocess.run(
            ["pt-passport", "logout", "--client_id", CLIENT_ID],
            capture_output=True, text=True, timeout=10, env=env
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    print(json.dumps({
        "success": True,
        "message": "设备标识已清除，下次登录将生成新的 device_token",
        "device_token_cleared": had_device_token
    }, ensure_ascii=False))


# ── 入口 ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="huisheng-coupon-tool 认证模块")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("get-device-token",
                          help="获取/生成 device_token（下单需要）")
    subparsers.add_parser("logout",
                          help="退出登录，清除 pt-passport CLI 缓存（保留 device_token）")
    subparsers.add_parser("clear-device-token",
                          help="清除设备标识，仅在用户明确要求时调用")

    args = parser.parse_args()

    if args.command == "get-device-token":
        cmd_get_device_token()
    elif args.command == "logout":
        cmd_logout()
    elif args.command == "clear-device-token":
        cmd_clear_device_token()


if __name__ == "__main__":
    main()
