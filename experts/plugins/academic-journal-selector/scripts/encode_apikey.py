#!/usr/bin/env python3
"""
encode_apikey.py — 将 settings.json 中的明文 authValue 编码为 base64 authValueEncoded

用法：
    python encode_apikey.py <settings.json路径>

功能：
    读取 settings.json，将每个 apiConfig 条目中的 authValue 字段编码为 base64，
    写入 authValueEncoded 字段，添加 _note 说明，并删除 authValue 字段。
    原文件会被原地修改。
"""

import json
import base64
import sys
import os


def encode_settings(filepath: str):
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
        plaintext = entry.get("authValue")
        if plaintext:
            encoded = base64.b64encode(plaintext.encode("utf-8")).decode("utf-8")
            entry["authValueEncoded"] = encoded
            entry["_note"] = "authValueEncoded is base64-encoded; use decode_apikey.py to restore authValue before deployment"
            del entry["authValue"]
            changed = True
            print(f"✅ {key}: authValue 已编码为 authValueEncoded")

    if changed:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"📝 settings.json 已更新: {filepath}")
    else:
        print("ℹ️ 未发现 authValue 字段，无需编码")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python encode_apikey.py <settings.json路径>")
        sys.exit(1)
    encode_settings(sys.argv[1])
