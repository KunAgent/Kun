#!/usr/bin/env python3
"""上报 DataBrain operationLog 埋点（非关键路径）。

POST ${DATABRAIN_HOST}/api/v1/permission/operationLog

CLI 入参（**仅这 3 个 flag**）：
    --rule-key <key>
    --flow-type {create|replace}         argparse choices 强约束
    --upload-paths <json>                JSON: ["https://...", "https://..."]

extInfo 字段（脚本内部拼）：
    key, type (=flow-type), uploadPath (逗号拼接), dataSource=skill,
    dataSourceName=databrain-ai-gallery-upload, version=<SKILL_VERSION>

**永远 exit 0**：失败仅在 stderr 打 warning，主流程不受影响。
"""

from __future__ import annotations

import argparse
import json
import sys

from _gallery_client import (
    EXIT_OK,
    GalleryError,
    TIMEOUT_DEFAULT,
    request_json,
)

# 与 SKILL.md frontmatter `version` 字段保持一致，升级 skill 时两处一起改。
SKILL_VERSION = "1.0.0"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Report operationLog (silent best-effort).",
        allow_abbrev=False,
    )
    parser.add_argument("--rule-key", required=True, dest="rule_key")
    parser.add_argument(
        "--flow-type",
        required=True,
        dest="flow_type",
        choices=["create", "replace"],
    )
    parser.add_argument(
        "--upload-paths",
        required=True,
        dest="upload_paths",
        help='JSON array: ["https://...", ...]',
    )
    args = parser.parse_args()

    try:
        upload_paths = json.loads(args.upload_paths)
        if not isinstance(upload_paths, list):
            raise ValueError("upload-paths must be JSON array")
        upload_paths_csv = ",".join(str(x) for x in upload_paths)
    except (json.JSONDecodeError, ValueError) as exc:
        print(
            json.dumps(
                {"ok": False, "msg": f"invalid --upload-paths: {exc}"},
                ensure_ascii=False,
            )
        )
        return EXIT_OK  # 静默失败

    ext_info = json.dumps(
        {
            "key": args.rule_key,
            "type": args.flow_type,
            "uploadPath": upload_paths_csv,
            "dataSource": "skill",
            "dataSourceName": "databrain-ai-gallery-upload",
            "version": SKILL_VERSION,
        },
        ensure_ascii=False,
    )
    body = {
        "logType": "buttonLog",
        "buttonLog": {
            "source": 1,
            "buttonId": "700501052",
            "buttonName": "skills",
            "typeId": "aigc",
            "pageId": "700501",
            "uidType": "",
            "uid": "",
            "gameName": "",
            "extInfo": ext_info,
            "extInfo2": "",
            "extInfo3": "",
        },
    }

    try:
        request_json(
            "POST",
            "/api/v1/permission/operationLog",
            json_body=body,
            timeout=TIMEOUT_DEFAULT,
        )
    except GalleryError as exc:
        print(f"[gallery_operation_log] warn: {exc.code} {exc.msg}", file=sys.stderr)
        print(
            json.dumps(
                {"ok": False, "msg": f"operationLog failed: {exc.msg}"},
                ensure_ascii=False,
            )
        )
        return EXIT_OK

    print(json.dumps({"ok": True}, ensure_ascii=False))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
