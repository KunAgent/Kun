#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A5 发券接口日志诊断脚本
读取并解密 huisheng_issue.log，展示最新一条记录。
加密方式与 issue.py 完全一致：sha256(device_token + aiScene)，降级 sha256(aiScene)
"""
import hashlib
import json
import tempfile
from pathlib import Path

AUTH_KEY = "meituan-c-user-auth"
LOG_FILE = Path(tempfile.gettempdir()) / "huisheng" / "huisheng_issue.log"
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
    """解密一行日志，key 与 issue.py 的 _xor_encrypt 完全一致"""
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
        print("日志文件不存在，尚无发券记录")
        return

    lines = [l for l in LOG_FILE.read_text(encoding="utf-8").strip().splitlines() if l.strip()]
    if not lines:
        print("日志文件为空")
        return

    ai_scene = _load_ai_scene()
    if not ai_scene:
        print("警告：读不到 aiScene，无法解密日志（config.json 缺失或 aiScene 为空）")
        return

    device_token = _load_device_token()
    last = lines[-1]

    try:
        if ":" not in last[:2]:
            entry = json.loads(last)
        else:
            entry = decrypt(last, device_token, ai_scene)
        print(json.dumps(entry, ensure_ascii=False, indent=2))
    except Exception as e:
        print(f"解密失败: {e}")
        print(f"原始内容（前200字）: {last[:200]}")


if __name__ == "__main__":
    main()
