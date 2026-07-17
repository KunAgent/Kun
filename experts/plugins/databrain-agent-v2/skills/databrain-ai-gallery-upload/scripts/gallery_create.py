#!/usr/bin/env python3
"""创建 AI-Gallery 作品。

POST /api/ai-gallery/dashboards (multipart/form-data)

CLI 入参（**仅这 6 个 flag**；脚本物理上无法接收其它字段）：
    --file <path>           本地文件路径 (.zip / .html / .htm)
    --name-cn <str>         中文名（必填，1-40 字符）
    --name-en <str>         英文名（必填，1-60 字符，agent 侧 Title Case）
    --desc-cn <str>         中文描述（可选，≤200）
    --desc-en <str>         英文描述（可选，≤300）
    --tags <json>           JSON 字符串，[{"id":1},{"id":2}]，长度 1-5

下列后端 multipart 字段由脚本**内部写死**，CLI 不暴露、SKILL.md 也不展示：
    source=file
    visibility=self     (强制；本 skill 不提供修改入口)

本地预检：
    - 文件不存在 / 不是普通文件 → exit 2
    - 文件 > 50MB → exit 2
    - 扩展名不在 .zip/.html/.htm → exit 2 (`unsupported file extension`)

成功输出: {"ok": true, "rule_key": "g-xxx", "id": <int>}
失败输出: exit 1 + {"ok": false, "code": ..., "msg": "...", "errors": [...], "detail": ...}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _gallery_client import (
    EXIT_OK,
    EXIT_USAGE,
    GalleryError,
    TIMEOUT_UPLOAD,
    guess_upload_mime,
    handle_gallery_error,
    print_failure,
    print_success,
    request_json,
)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 与后端 MAX_FILE_SIZE 对齐


def _validate_tags(raw: str) -> str:
    """校验 tags JSON：必须是 [{id:int}, ...]，长度 1-5。

    校验通过返回原 JSON 字符串（透传给后端）；失败 exit 2。
    """
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        print_failure(EXIT_USAGE, code=-2, msg=f"--tags is not valid JSON: {exc}")
        return raw
    if not isinstance(parsed, list):
        print_failure(EXIT_USAGE, code=-2, msg="--tags must be a JSON array")
        return raw
    if not (1 <= len(parsed) <= 5):
        print_failure(
            EXIT_USAGE,
            code=-2,
            msg=f"--tags must have 1-5 items, got {len(parsed)}",
        )
        return raw
    for i, item in enumerate(parsed):
        if not isinstance(item, dict) or "id" not in item:
            print_failure(
                EXIT_USAGE,
                code=-2,
                msg=f'--tags[{i}] must be like {{"id":<int>}}',
            )
            return raw
        try:
            int(item["id"])
        except (TypeError, ValueError):
            print_failure(
                EXIT_USAGE,
                code=-2,
                msg=f"--tags[{i}].id must be int, got {item['id']!r}",
            )
            return raw
    # 透传时归一化为 [{"id":<int>}, ...]，剔除其它字段
    normalized = [{"id": int(item["id"])} for item in parsed]
    return json.dumps(normalized, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create an AI-Gallery dashboard (visibility hardcoded to self).",
        allow_abbrev=False,
    )
    parser.add_argument("--file", required=True, help="local file path")
    parser.add_argument("--name-cn", required=True, dest="name_cn")
    parser.add_argument("--name-en", required=True, dest="name_en")
    parser.add_argument("--desc-cn", dest="desc_cn", default=None)
    parser.add_argument("--desc-en", dest="desc_en", default=None)
    parser.add_argument("--tags", required=True, help='JSON: [{"id":1},...]')
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.is_file():
        print_failure(EXIT_USAGE, code=-2, msg=f"file not found: {args.file}")
        return EXIT_USAGE
    try:
        size = file_path.stat().st_size
    except OSError as exc:
        print_failure(EXIT_USAGE, code=-2, msg=f"stat failed: {exc}")
        return EXIT_USAGE
    if size > MAX_FILE_SIZE:
        print_failure(
            EXIT_USAGE,
            code=-2,
            msg=f"file too large: {size} bytes > {MAX_FILE_SIZE} ({MAX_FILE_SIZE // (1024*1024)}MB)",
        )
        return EXIT_USAGE
    if size == 0:
        print_failure(EXIT_USAGE, code=-2, msg="file is empty")
        return EXIT_USAGE

    try:
        content_type = guess_upload_mime(str(file_path))
    except GalleryError as exc:
        print_failure(EXIT_USAGE, code=exc.code, msg=exc.msg)
        return EXIT_USAGE

    tags_normalized = _validate_tags(args.tags)

    try:
        file_bytes = file_path.read_bytes()
    except OSError as exc:
        print_failure(EXIT_USAGE, code=-2, msg=f"read failed: {exc}")
        return EXIT_USAGE

    fields: dict[str, str] = {
        "name_cn": args.name_cn,
        "name_en": args.name_en,
        "source": "file",
        "visibility": "self",  # hardcoded; CLI 不暴露
        "tags": tags_normalized,
    }
    if args.desc_cn is not None:
        fields["desc_cn"] = args.desc_cn
    if args.desc_en is not None:
        fields["desc_en"] = args.desc_en

    try:
        data = request_json(
            "POST",
            "/api/ai-gallery/dashboards",
            multipart_fields=fields,
            multipart_file=("file", file_path.name, file_bytes, content_type),
            timeout=TIMEOUT_UPLOAD,
        )
    except GalleryError as exc:
        handle_gallery_error(exc)
        return EXIT_USAGE

    if not isinstance(data, dict):
        print_failure(
            EXIT_USAGE,
            code=-1,
            msg=f"unexpected create payload shape: {type(data).__name__}",
        )
        return EXIT_USAGE

    print_success({
        "rule_key": data.get("rule_key"),
        "id": data.get("id"),
    })
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
