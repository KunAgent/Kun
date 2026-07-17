#!/usr/bin/env python3
"""创建会话 / 向会话发送消息（生图、生视频等）：POST /openapi/session"""

import argparse
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from _common import create_session, build_project_url


def main():
    parser = argparse.ArgumentParser(
        description="创建会话或向已有会话发送消息（用于生图、生视频）",
        epilog="""
环境变量:
  LIBTV_ACCESS_KEY  必填，Bearer 鉴权
  OPENAPI_IM_BASE 或 IM_BASE_URL  可选，默认 https://im.liblib.tv

示例:
  # 创建新会话并发送「生一个动漫视频」
  python3 create_session.py "生一个动漫视频"

  # 向已有会话发送消息
  python3 create_session.py "再生成一张风景图" --session-id 90f05e0c-5d08-4148-be40-e30fc7c7bedf

  # 只创建/绑定会话，不发消息
  python3 create_session.py
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "message",
        nargs="?",
        default="",
        help="要发送的消息内容（生图/生视频描述等），不传则不调用 SendMessage",
    )
    parser.add_argument(
        "--session-id",
        default="",
        help="已有会话 ID，不传则创建新会话或返回已有默认会话",
    )
    args = parser.parse_args()

    data = create_session(session_id=args.session_id or "", message=args.message or "")
    project_uuid = data.get("projectUuid", "")
    session_id = data.get("sessionId", "")

    if not session_id:
        print("错误：未返回 sessionId", file=sys.stderr)
        sys.exit(1)

    project_url = build_project_url(project_uuid)
    out = {
        "projectUuid": project_uuid,
        "sessionId": session_id,
        "projectUrl": project_url,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
