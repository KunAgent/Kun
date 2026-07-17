#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A4 鉴权操作日志诊断脚本
读取并解密 huisheng_auth.log，按接口分类展示最新一条记录。
加密方式与 auth.py 完全一致：sha256(device_token + aiScene)，降级 sha256(aiScene)
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

AUTH_KEY = "meituan-c-user-auth"
LOG_FILE = Path(tempfile.gettempdir()) / "huisheng" / "huisheng_auth.log"
TOKEN_FILE = Path.home() / ".workbuddy" / "credentials" / "meituan-living-deals-assistant" / "token.json"
CONFIG_FILE = Path(__file__).parent / "config.json"


def _load_ai_scene() -> str:
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f).get("aiScene", "")
    except Exception:
        return ""


def _load_device_token() -> str:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            return json.load(f).get(AUTH_KEY, {}).get("device_token", "")
    except Exception:
        return ""


def decrypt(line: str, device_token: str, ai_scene: str) -> dict:
    """解密一行日志，key 与 auth.py 的 _xor_encrypt 完全一致"""
    flag, hex_data = line.split(":", 1)
    if flag == "1" and device_token:
        seed = device_token + ai_scene
    else:
        seed = ai_scene
    key = hashlib.sha256(seed.encode()).digest()
    raw = bytes(int(hex_data[i:i+2], 16) ^ key[i // 2 % 32] for i in range(0, len(hex_data), 2))
    return json.loads(raw.decode("utf-8"))


def main():
    if not LOG_FILE.exists():
        print("鉴权日志不存在，尚无操作记录")
        return

    lines = [l for l in LOG_FILE.read_text(encoding="utf-8").strip().splitlines() if l.strip()]
    if not lines:
        print("鉴权日志为空")
        return

    ai_scene = _load_ai_scene()
    if not ai_scene:
        print("警告：读不到 aiScene，无法解密日志（config.json 缺失或 aiScene 为空）")
        return

    device_token = _load_device_token()

    actions = ["token-verify", "send-sms", "verify"]
    latest = {}
    for line in lines:
        try:
            # 明文行（ai_scene 为空时写入，兼容旧数据）
            if ":" not in line[:2]:
                entry = json.loads(line)
            else:
                entry = decrypt(line, device_token, ai_scene)
            a = entry.get("action", "")
            if a in actions:
                latest[a] = entry
        except Exception:
            pass

    for a in actions:
        if a in latest:
            e = latest[a]
            result = e.get("result", {})
            success = result.get("success", "-")
            code = result.get("code", "")
            error = result.get("error", "")
            req = e.get("request", {})
            resp = e.get("response", {})
            http_status = resp.get("http_status", "-") if isinstance(resp, dict) else "-"
            parts = [
                f"[{a}]",
                f"time={e.get('time', '-')}",
                f"phone={req.get('phone_masked', e.get('phone_masked', '-'))}",
                f"success={success}",
            ]
            if code != "":
                parts.append(f"code={code}")
            if error:
                parts.append(f"error={error}")
            if http_status != "-":
                parts.append(f"http_status={http_status}")
            print("  ".join(parts))
        else:
            print(f"[{a}] 暂无记录")


if __name__ == "__main__":
    main()
