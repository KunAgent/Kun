#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Databrain Skill ID 生成脚本

功能：
- 生成 session_id (格式: query_{16位hex})
- 生成 msg_id (格式: msg_{16位hex})

使用方式：
    python gen_ids.py                    # 同时生成 session_id 和 msg_id
    python gen_ids.py --session          # 只生成 session_id
    python gen_ids.py --msg              # 只生成 msg_id
    python gen_ids.py --json             # JSON 格式输出
    python gen_ids.py --export           # 输出 export 命令
"""

import secrets
import argparse
import json


def generate_session_id() -> str:
    """生成 session_id (格式: query_{16位hex})"""
    return f"query_{secrets.token_hex(8)}"


def generate_msg_id() -> str:
    """生成 msg_id (格式: msg_{16位hex})"""
    return f"msg_{secrets.token_hex(8)}"


def main():
    parser = argparse.ArgumentParser(
        description='生成 Databrain Skill 所需的 session_id 和 msg_id',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python gen_ids.py                    # 同时生成两个 ID
  python gen_ids.py --session          # 只生成 session_id
  python gen_ids.py --msg              # 只生成 msg_id
  python gen_ids.py --json             # JSON 格式输出
  python gen_ids.py --export           # 输出 export 命令（可直接复制执行）

在 curl 中使用:
  eval $(python gen_ids.py --export)
  curl ... -d '{"sessionId": "'$SESSION_ID'", "msgId": "'$MSG_ID'"}'
        """
    )
    parser.add_argument('--session', '-s', action='store_true',
                        help='只生成 session_id')
    parser.add_argument('--msg', '-m', action='store_true',
                        help='只生成 msg_id')
    parser.add_argument('--json', '-j', action='store_true',
                        help='JSON 格式输出')
    parser.add_argument('--export', '-e', action='store_true',
                        help='输出 export 命令格式')
    
    args = parser.parse_args()
    
    # 默认两个都生成
    gen_session = not args.msg or args.session or (not args.session and not args.msg)
    gen_msg = not args.session or args.msg or (not args.session and not args.msg)
    
    session_id = generate_session_id() if gen_session else None
    msg_id = generate_msg_id() if gen_msg else None
    
    if args.json:
        result = {}
        if session_id:
            result['session_id'] = session_id
        if msg_id:
            result['msg_id'] = msg_id
        print(json.dumps(result, indent=2))
    elif args.export:
        if session_id:
            print(f'export SESSION_ID="{session_id}"')
        if msg_id:
            print(f'export MSG_ID="{msg_id}"')
    else:
        if session_id:
            print(f"session_id: {session_id}")
        if msg_id:
            print(f"msg_id:     {msg_id}")


if __name__ == '__main__':
    main()
