#!/usr/bin/env python3
"""替换 AI-Gallery 作品的源文件。

POST /api/ai-gallery/dashboards/:rule_key/replace-file (multipart/form-data)

CLI 入参（**仅这 2 个 flag**）：
    --rule-key <key>
    --file <path>

表单只发 file；不接受任何元数据修改字段。

本地预检：
    - 文件不存在 / 不是普通文件 → exit 2
    - 文件 > 50MB → exit 2
    - 扩展名不在 .zip/.html/.htm → exit 2

成功输出: 后端 replace-file 响应字段透传（仅本 skill 关心的几项）
失败输出: exit 1 + JSON 错误体（含 source_mode_mismatch / invalid_zip_entry / backup_partial_failure 等）
"""

from __future__ import annotations

import argparse
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

MAX_FILE_SIZE = 50 * 1024 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replace source file of an AI-Gallery dashboard.",
        allow_abbrev=False,
    )
    parser.add_argument("--rule-key", required=True, dest="rule_key")
    parser.add_argument("--file", required=True, help="local file path")
    args = parser.parse_args()

    rule_key = args.rule_key.strip()
    if not rule_key:
        print_failure(EXIT_USAGE, code=-2, msg="rule-key cannot be empty")
        return EXIT_USAGE

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
            msg=f"file too large: {size} bytes > {MAX_FILE_SIZE}",
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

    try:
        file_bytes = file_path.read_bytes()
    except OSError as exc:
        print_failure(EXIT_USAGE, code=-2, msg=f"read failed: {exc}")
        return EXIT_USAGE

    try:
        data = request_json(
            "POST",
            f"/api/ai-gallery/dashboards/{rule_key}/replace-file",
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
            msg=f"unexpected replace payload shape: {type(data).__name__}",
        )
        return EXIT_USAGE

    print_success({
        "rule_key": data.get("rule_key") or rule_key,
        "html_files": data.get("html_files"),
        "backup_path": data.get("backup_path"),
        "backed_up_count": data.get("backed_up_count"),
        "effective_filename": data.get("effective_filename"),
        "original_filename": data.get("original_filename"),
        "renamed": data.get("renamed"),
    })
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
