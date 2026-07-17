#!/usr/bin/env python3
"""
resolve_social_rid.py - 社招候选人 RID（GUID）反查工具

背景：
    社招的"我的待办"接口（recruit.social-todo-center.get_api_trace_get_list）
    返回的简历标识只有 employeeId / extId（数字），但 post_order_add / 简历详情接口
    等核心写接口都要求 GUID 格式的 rid。

    本脚本通过社招简历搜索接口 (recruit.social-resume.post_api_resume_query_query)
    用 email / mobile / extId 反查 rid。

用法：
    # 用邮箱查
    python3 resolve_social_rid.py --email candidate@example.com

    # 用手机号查
    python3 resolve_social_rid.py --mobile 13800001234

    # 用 extId / employeeId 反查（搜索接口没有直接的 extId 过滤，
    # 退化为搜索后比对——精度差，仅用于辅助）
    python3 resolve_social_rid.py --ext-id <EXT_ID> --hint-name <候选人姓名>

输出（stdout JSON）：
    {
      "rid": "<RID-GUID>",
      "ext_id": "<EXT_ID>",
      "name": "<候选人姓名>",
      "email": "c****te@example.com",
      "status_text": "面试中",
      "matched_by": "email"
    }

退出码：
    0 - 找到唯一匹配
    1 - 0 个匹配
    2 - 参数错误
    3 - mcporter 失败
    4 - 多个匹配（需用户进一步澄清）

v1.0 - 2026-05-27
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

SEARCH_API = "recruit.social-resume.post_api_resume_query_query"


def call_search(payload: dict) -> list[dict]:
    cmd = ["mcporter", "call", "recruit-mcp", "CallAPI",
           f"apiId={SEARCH_API}",
           "params=" + json.dumps(payload, ensure_ascii=False)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(f"mcporter call failed (exit {proc.returncode}):\n{proc.stderr}\n")
        sys.exit(3)
    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"failed to parse JSON: {e}\n")
        sys.exit(3)
    # 实测路径：data.data.resumes[]
    cur = raw
    for k in ("data", "data", "resumes"):
        if not isinstance(cur, dict):
            cur = None
            break
        cur = cur.get(k)
    return cur if isinstance(cur, list) else []


def normalize(item: dict, matched_by: str) -> dict:
    return {
        "rid":         item.get("rid"),
        "ext_id":      item.get("extId"),
        "resume_id":   item.get("resumeId"),
        "name":        item.get("name"),
        "email":       item.get("email"),
        "mobile":      item.get("mobile"),
        "status":      item.get("status"),
        "status_text": item.get("statusText"),
        "locked":      item.get("locked"),
        "matched_by":  matched_by,
    }


def main():
    parser = argparse.ArgumentParser(description="社招 RID 反查")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--email", help="按邮箱反查（最准）")
    src.add_argument("--mobile", help="按手机号反查")
    src.add_argument("--ext-id", help="按 extId/employeeId 反查（需配合 --hint-name 比对）")
    parser.add_argument("--hint-name", help="候选人姓名提示（配合 --ext-id 使用，用于在多个结果里比对）")
    parser.add_argument("--locked", type=int, default=1,
                        help="0=只看未锁定 / 1=只看锁定 / -1=两个都看（默认 1，已锁定才进面试流程）")
    args = parser.parse_args()

    payload: dict = {"from": 0, "size": 10, "diggerSearchId": "mcp-recruit-rid-resolve"}
    if args.locked in (0, 1):
        payload["locked"] = args.locked

    matched_by = ""
    if args.email:
        payload["email"] = args.email
        matched_by = "email"
    elif args.mobile:
        payload["mobile"] = args.mobile
        matched_by = "mobile"
    else:
        # extId 没有直接搜参，退化方案：用 hint-name 搜，然后比对 extId
        if not args.hint_name:
            sys.stderr.write("--ext-id 模式必须同时提供 --hint-name\n")
            sys.exit(2)
        payload["name"] = args.hint_name
        matched_by = "ext_id"

    results = call_search(payload)

    if args.ext_id is not None:
        results = [r for r in results if str(r.get("extId")) == str(args.ext_id)]

    if not results:
        sys.stderr.write("no match found\n")
        sys.exit(1)
    if len(results) > 1:
        sys.stderr.write(f"multiple matches ({len(results)}); please narrow down\n")
        for r in results[:5]:
            sys.stderr.write(f"  - name={r.get('name')} rid={r.get('rid')} extId={r.get('extId')}\n")
        sys.exit(4)

    out = normalize(results[0], matched_by)
    if not out["rid"]:
        sys.stderr.write("matched but rid is empty\n")
        sys.exit(4)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
