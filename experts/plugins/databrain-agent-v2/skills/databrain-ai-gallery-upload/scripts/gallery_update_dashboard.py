#!/usr/bin/env python3
"""更新 AI-Gallery 作品的元数据（仅 name / desc / tags 5 个字段）。

PUT /api/ai-gallery/dashboards/:rule_key  (application/json)

CLI 入参（**仅这 6 个 flag，--rule-key 必填，其余 5 个全可选**；脚本物理上无法
接收 visibility / share_users 这类字段）：
    --rule-key <key>
    --name-cn <str>          可选
    --name-en <str>          可选
    --desc-cn <str>          可选
    --desc-en <str>          可选
    --tags <json>            可选；JSON: [{"id":1},...]，长度 1-5

至少要提供一个可选字段；全部省略 → exit 2 ("nothing to update")，不发请求。

成功输出: {"ok": true, "rule_key": "...", "updated": true}
失败输出: exit 1 + JSON 错误体
"""

from __future__ import annotations

import argparse
import json
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


def _validate_tags(raw: str) -> list[dict]:
    """与 gallery_create.py 同款校验；返回归一化的 list[{id:int}]。"""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        print_failure(EXIT_USAGE, code=-2, msg=f"--tags is not valid JSON: {exc}")
        return []
    if not isinstance(parsed, list):
        print_failure(EXIT_USAGE, code=-2, msg="--tags must be a JSON array")
        return []
    if not (1 <= len(parsed) <= 5):
        print_failure(
            EXIT_USAGE,
            code=-2,
            msg=f"--tags must have 1-5 items, got {len(parsed)}",
        )
        return []
    out: list[dict] = []
    for i, item in enumerate(parsed):
        if not isinstance(item, dict) or "id" not in item:
            print_failure(
                EXIT_USAGE,
                code=-2,
                msg=f'--tags[{i}] must be like {{"id":<int>}}',
            )
            return []
        try:
            tag_id = int(item["id"])
        except (TypeError, ValueError):
            print_failure(
                EXIT_USAGE,
                code=-2,
                msg=f"--tags[{i}].id must be int, got {item['id']!r}",
            )
            return []
        out.append({"id": tag_id})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update AI-Gallery dashboard metadata (name / desc / tags only).",
        allow_abbrev=False,
    )
    parser.add_argument("--rule-key", required=True, dest="rule_key")
    parser.add_argument("--name-cn", dest="name_cn", default=None)
    parser.add_argument("--name-en", dest="name_en", default=None)
    parser.add_argument("--desc-cn", dest="desc_cn", default=None)
    parser.add_argument("--desc-en", dest="desc_en", default=None)
    parser.add_argument("--tags", dest="tags", default=None, help='JSON: [{"id":1},...]')
    args = parser.parse_args()

    rule_key = args.rule_key.strip()
    if not rule_key:
        print_failure(EXIT_USAGE, code=-2, msg="rule-key cannot be empty")
        return EXIT_USAGE

    body: dict = {}
    if args.name_cn is not None:
        body["name_cn"] = args.name_cn
    if args.name_en is not None:
        body["name_en"] = args.name_en
    if args.desc_cn is not None:
        body["desc_cn"] = args.desc_cn
    if args.desc_en is not None:
        body["desc_en"] = args.desc_en
    if args.tags is not None:
        body["tags"] = _validate_tags(args.tags)

    if not body:
        print_failure(
            EXIT_USAGE,
            code=-2,
            msg="nothing to update (provide at least one of --name-cn / --name-en / --desc-cn / --desc-en / --tags)",
        )
        return EXIT_USAGE

    try:
        request_json(
            "PUT",
            f"/api/ai-gallery/dashboards/{rule_key}",
            json_body=body,
            timeout=TIMEOUT_DEFAULT,
        )
    except GalleryError as exc:
        handle_gallery_error(exc)
        return EXIT_USAGE

    print_success({"rule_key": rule_key, "updated": True})
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
