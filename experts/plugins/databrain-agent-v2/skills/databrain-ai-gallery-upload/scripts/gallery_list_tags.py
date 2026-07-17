#!/usr/bin/env python3
"""列出 AI-Gallery 所有系统 + 自建 tag。

GET /api/ai-gallery/tags

无 CLI 参数。输出字段白名单过滤：id / name_cn / name_en / type / is_mine / count，
其它字段（icon / created_at 等）一律丢弃，避免污染 agent 上下文。

成功输出（stdout 单行 JSON）:
    {"ok": true, "items": [{"id":1,"name_cn":"...","name_en":"...","type":"preset","is_mine":false,"count":12}, ...]}

失败：exit 1 + {"ok": false, "code": ..., "msg": "..."}
"""

from __future__ import annotations

import argparse
import sys

from _gallery_client import (
    EXIT_OK,
    EXIT_USAGE,
    GalleryError,
    TIMEOUT_DEFAULT,
    handle_gallery_error,
    print_failure,
    print_success,
    request_json,
)


def _filter_tag(item: dict) -> dict:
    """字段白名单过滤。"""
    return {
        "id": item.get("id"),
        "name_cn": item.get("name_cn"),
        "name_en": item.get("name_en"),
        "type": item.get("type"),
        "is_mine": item.get("is_mine"),
        "count": item.get("count"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List AI-Gallery tags (whitelist-filtered)."
    )
    parser.parse_args()  # 无参，但触发 --help

    try:
        data = request_json("GET", "/api/ai-gallery/tags", timeout=TIMEOUT_DEFAULT)
    except GalleryError as exc:
        handle_gallery_error(exc)
        return EXIT_USAGE  # unreachable; handle_gallery_error exits

    # 后端 controller 返回 ok({ items })，data 形如 { items: [...] }；
    # 同时兼容裸数组（防御性，万一后端契约变了不至于挂）。
    if isinstance(data, dict):
        raw_items = data.get("items", [])
    elif isinstance(data, list):
        raw_items = data
    else:
        print_failure(
            EXIT_USAGE,
            code=-1,
            msg=f"unexpected tags payload shape: {type(data).__name__}",
        )
        return EXIT_USAGE

    if not isinstance(raw_items, list):
        print_failure(
            EXIT_USAGE,
            code=-1,
            msg=f"unexpected tags items shape: {type(raw_items).__name__}",
        )
        return EXIT_USAGE

    items = [_filter_tag(t) for t in raw_items if isinstance(t, dict)]
    print_success({"items": items})
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
