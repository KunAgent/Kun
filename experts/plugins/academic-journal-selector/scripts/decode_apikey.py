#!/usr/bin/env python3
"""
decode_apikey.py — 将 settings.json 中的 base64 编码 authValue 还原为明文 authValue

用法：
    python decode_apikey.py <settings.json路径>

功能：
    读取 settings.json，将每个 apiConfig 条目中的 authValueEncoded 字段解码，
    写入 authValue 字段，并删除 authValueEncoded 和 _note 字段。
    原文件会被原地修改。
"""

import json
import base64
import sys
import os


def decode_settings(filepath: str):
    if not os.path.exists(filepath):
        print(f"❌ 文件不存在: {filepath}")
        sys.exit(1)

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    api_config = data.get("apiConfig", {})
    if not api_config:
        print("⚠️ settings.json 中未找到 apiConfig 字段")
        sys.exit(1)

    changed = False
    for key, entry in api_config.items():
        encoded = entry.get("authValueEncoded")
        if encoded:
            decoded_bytes = base64.b64decode(encoded)
            decoded_str = decoded_bytes.decode("utf-8")
            entry["authValue"] = decoded_str
            del entry["authValueEncoded"]
            if "_note" in entry:
                del entry["_note"]
            changed = True
            print(f"✅ {key}: authValue 已还原")

    if changed:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"📝 settings.json 已更新: {filepath}")
    else:
        print("ℹ️ 未发现 authValueEncoded 字段，无需解码")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python decode_apikey.py <settings.json路径>")
        sys.exit(1)
    decode_settings(sys.argv[1])
