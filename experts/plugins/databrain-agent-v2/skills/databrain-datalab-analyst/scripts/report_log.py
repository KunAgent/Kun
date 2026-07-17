#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Databrain Skill 日志上报脚本

功能：
- 封装打点上报逻辑
- 自动处理中文编码
- 自动生成 session_id 和 msg_id

使用方式（命令行）：
    python report_log.py --message "用户问题" --skill "databrain-datalab-knowledge-analyst" [--game-code "xxx"]

使用方式（作为模块）：
    from report_log import report, generate_session_id, generate_msg_id
    
    report(
        message="用户问题",
        session_id=generate_session_id(),
        msg_id=generate_msg_id(),
        data_source_name="databrain-datalab-knowledge-analyst",
        game_code="optional_game_code"
    )
"""

import os
import sys
import json
import secrets
import argparse
import urllib.request
import urllib.error
from typing import Optional


def generate_session_id() -> str:
    """生成 session_id (格式: query_{16位hex})"""
    return f"query_{secrets.token_hex(8)}"


def generate_msg_id() -> str:
    """生成 msg_id (格式: msg_{16位hex})"""
    return f"msg_{secrets.token_hex(8)}"


def report(
    message: str,
    session_id: str,
    msg_id: str,
    data_source_name: str = "databrain-datalab-knowledge-analyst",
    game_code: str = "",
    game_name: str = "",
    deep_thinking: bool = False,
    mode: str = "auto",
    system_language: str = "zh",
    verbose: bool = False
) -> tuple:
    """
    上报日志到 Databrain
    
    Args:
        message: 用户原始问题
        session_id: 会话 ID (使用 generate_session_id() 生成)
        msg_id: 消息 ID (使用 generate_msg_id() 生成)
        data_source_name: Skill 完整名称
        game_code: 游戏代码 (可选)
        game_name: 游戏名称 (可选)
        deep_thinking: 是否深度思考 (默认 False)
        mode: 模式 (默认 auto)
        system_language: 系统语言 (默认 zh)
        verbose: 是否打印详细信息
    
    Returns:
        (success, message) 元组
    """
    # 获取环境变量
    token = os.environ.get('DATABRAIN_TOKEN', '')
    host = os.environ.get('DATABRAIN_HOST', 'https://databrain.intlgame.com')
    
    if not token:
        return False, "DATABRAIN_TOKEN 环境变量未设置"
    
    # 构建 extInfo
    ext_info = {
        "sessionId": session_id,
        "msgId": msg_id,
        "message": message,
        "deepThinking": deep_thinking,
        "from": "send",
        "dataSource": "skill",
        "dataSourceName": data_source_name,
        "mode": mode,
        "system_language": system_language
    }
    
    # 构建请求体
    payload = {
        "logType": "buttonLog",
        "buttonLog": {
            "source": 1,
            "buttonId": "700501052",
            "buttonName": "skills",
            "typeId": "aigc",
            "pageId": "700501",
            "uidType": "game_code",
            "uid": game_code,
            "gameName": game_name,
            "extInfo": json.dumps(ext_info, ensure_ascii=False, separators=(',', ':')),
            "extInfo2": "",
            "extInfo3": ""
        }
    }
    
    url = f"{host}/api/v1/permission/operationLog"
    headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': f'Bearer {token}' if not token.startswith('Bearer ') else token
    }
    
    if verbose:
        print(f"📤 上报地址: {url}")
        print(f"📦 请求体: {json.dumps(payload, ensure_ascii=False, indent=2)}")
    
    try:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            if result.get('code') == 200:
                return True, "上报成功"
            else:
                return False, f"上报失败: {result.get('msg', 'unknown')}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP 错误: {e.code}"
    except urllib.error.URLError as e:
        return False, f"网络错误: {e.reason}"
    except Exception as e:
        return False, f"上报异常: {str(e)}"


def main():
    parser = argparse.ArgumentParser(
        description='Databrain Knowledge Analyst 日志上报',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python report_log.py --message "DAU为什么下降" --skill "databrain-datalab-knowledge-analyst"
  python report_log.py -m "留存分析方法" -s "databrain-datalab-knowledge-analyst" -g "pubgm"
  python report_log.py -m "测试" -s "databrain-datalab-knowledge-analyst" --verbose

环境变量:
  DATABRAIN_TOKEN - 必需，鉴权 Token
  DATABRAIN_HOST  - 可选，默认 https://databrain.intlgame.com
        """
    )
    parser.add_argument('--message', '-m', required=True,
                        help='用户原始问题')
    parser.add_argument('--skill', '-s', default='databrain-datalab-knowledge-analyst',
                        help='Skill 完整名称 (默认 databrain-datalab-knowledge-analyst)')
    parser.add_argument('--game-code', '-g', default='',
                        help='游戏代码 (可选)')
    parser.add_argument('--game-name', default='',
                        help='游戏名称 (可选)')
    parser.add_argument('--session-id', default=None,
                        help='指定 session_id (不指定则自动生成)')
    parser.add_argument('--msg-id', default=None,
                        help='指定 msg_id (不指定则自动生成)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='显示详细信息')
    
    args = parser.parse_args()
    
    # 自动生成 ID
    session_id = args.session_id or generate_session_id()
    msg_id = args.msg_id or generate_msg_id()
    
    if args.verbose:
        print(f"🆔 session_id: {session_id}")
        print(f"🆔 msg_id: {msg_id}")
    
    success, msg = report(
        message=args.message,
        session_id=session_id,
        msg_id=msg_id,
        data_source_name=args.skill,
        game_code=args.game_code,
        game_name=args.game_name,
        verbose=args.verbose
    )
    
    if success:
        print(f"✅ {msg}")
        sys.exit(0)
    else:
        print(f"❌ {msg}")
        sys.exit(1)


if __name__ == '__main__':
    main()
