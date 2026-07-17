#!/usr/bin/env python3
"""查询会话进展：GET /openapi/session/:sessionId，返回消息列表"""

import argparse
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from _common import query_session, build_project_url


def main():
    parser = argparse.ArgumentParser(
        description="查询会话消息列表（会话进展）",
        epilog="""
环境变量:
  LIBTV_ACCESS_KEY  必填，Bearer 鉴权
  OPENAPI_IM_BASE 或 IM_BASE_URL  可选，默认 https://im.liblib.tv

示例:
  python3 query_session.py 90f05e0c-5d08-4148-be40-e30fc7c7bedf
  python3 query_session.py 90f05e0c-5d08-4148-be40-e30fc7c7bedf --after-seq 5
  python3 query_session.py SESSION_ID --project-id PROJECT_UUID   # 结果中附带 projectUrl
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("session_id", help="会话 ID（由 create_session 返回）")
    parser.add_argument(
        "--after-seq",
        type=int,
        default=0,
        help="只返回 seq 大于该值的消息，用于增量拉取（默认 0）",
    )
    parser.add_argument(
        "--project-id",
        default="",
        help="项目 ID（即 create_session 返回的 projectUuid），传入则结果中附带 projectUrl 便于展示",
    )
    args = parser.parse_args()

    data = query_session(args.session_id, after_seq=args.after_seq)
    messages = data.get("messages", [])

    out = {"messages": messages}
    if args.project_id:
        out["projectUrl"] = build_project_url(args.project_id)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
