#!/usr/bin/env python3
"""
CloudQ 异步任务管理脚本

用于管理 CloudQ 异步对话任务（Async=true 模式）：
- DescribeCloudQAsyncTask：查询异步任务执行状态和结果
- CancelCloudQAsyncTask：取消异步后台编排任务

通过 tcloud_api.call_api() 调用标准腾讯云 API（非 SSE）。

用法 (命令行):
    # 查询任务状态
    python3 tcloud_async_task.py query <chat_id> <session_id>

    # 取消任务
    python3 tcloud_async_task.py cancel <chat_id> [session_id]

    # Poll 轮询直到完成（自动循环 query，内部自适应间隔）
    python3 tcloud_async_task.py poll <chat_id> <session_id> [timeout=1200]

示例:
    python3 tcloud_async_task.py query chat-7f3a9b2e1d4c sess-e5b8c1a0f6d2
    python3 tcloud_async_task.py cancel chat-7f3a9b2e1d4c sess-e5b8c1a0f6d2
    python3 tcloud_async_task.py poll chat-7f3a9b2e1d4c sess-e5b8c1a0f6d2

作为模块导入:
    from tcloud_async_task import query_async_task, cancel_async_task, poll_until_complete

    result = query_async_task("chat-xxx", "sess-xxx")
    if result["success"]:
        status = result["data"]["Status"]
        content = result["data"]["Content"]

    result = cancel_async_task("chat-xxx", "sess-xxx")
    if result["success"]:
        print("任务已取消")

输出格式（统一 JSON）:
    成功: {"success": true, "action": "...", "data": {...}, "requestId": "..."}
    失败: {"success": false, "action": "...", "error": {...}, "requestId": "..."}
"""

import json
import sys
import time

# ---------------------------------------------------------------------------
# 固定参数
# ---------------------------------------------------------------------------
SERVICE = "advisor"
HOST = "advisor.ai.tencentcloudapi.com"
VERSION = "2020-07-21"
ACTION_QUERY = "DescribeCloudQAsyncTask"
ACTION_CANCEL = "CancelCloudQAsyncTask"

# 轮询参数
DEFAULT_POLL_INTERVAL = 5   # 秒（固定 5s 间隔）
DEFAULT_POLL_TIMEOUT = 1200 # 秒（CloudQ 长任务最长可达 20 分钟）
FIXED_POLL_INTERVAL = 5     # 秒（固定，不允许用户自定义）


# ---------------------------------------------------------------------------
# 公共函数
# ---------------------------------------------------------------------------

def _output_json(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False)


# ---------------------------------------------------------------------------
# DescribeCloudQAsyncTask - 查询异步任务状态
# ---------------------------------------------------------------------------

def query_async_task(chat_id: str, session_id: str,
                     secret_id: str = None, secret_key: str = None,
                     token: str = None) -> dict:
    """
    查询异步任务状态。

    Args:
        chat_id:    异步任务 ID（由 accepted 帧 ChatId 返回）
        session_id: 会话 ID（由 accepted 帧 SessionId 返回）
        secret_id:  SecretId，不传则自动获取
        secret_key: SecretKey，不传则自动获取
        token:      临时密钥 Token

    Returns:
        dict: {
            "success": true/false,
            "action": "DescribeCloudQAsyncTask",
            "data": {
                "Status": "running|completed|failed|cancelled|timeout|not_found",
                "FinishReason": "stop|user_stopped|timeout|error" (running/not_found时为空),
                "Content": "分析结果...",
                "SessionID": "sess-xxx",
                "ChatID": "chat-xxx"
            },
            "requestId": "..."
        }
    """
    if not chat_id:
        return {
            "success": False,
            "action": ACTION_QUERY,
            "error": {"code": "MissingParameter", "message": "ChatID 为必填参数"},
            "requestId": "",
        }
    if not session_id:
        return {
            "success": False,
            "action": ACTION_QUERY,
            "error": {"code": "MissingParameter", "message": "SessionID 为必填参数"},
            "requestId": "",
        }

    try:
        from tcloud_api import call_api
    except ImportError:
        return {
            "success": False,
            "action": ACTION_QUERY,
            "error": {
                "code": "ImportError",
                "message": "无法导入 tcloud_api 模块，请确保 scripts 目录在 Python 路径中"
            },
            "requestId": "",
        }

    payload = {"ChatID": chat_id, "SessionID": session_id}

    result = call_api(
        service=SERVICE, host=HOST, action=ACTION_QUERY,
        version=VERSION, payload=payload,
        secret_id=secret_id, secret_key=secret_key, token=token,
    )
    return result


# ---------------------------------------------------------------------------
# CancelCloudQAsyncTask - 取消异步任务
# ---------------------------------------------------------------------------

def cancel_async_task(chat_id: str, session_id: str = "",
                      secret_id: str = None, secret_key: str = None,
                      token: str = None) -> dict:
    """
    取消异步后台编排任务。

    Args:
        chat_id:    异步任务 ID（由 accepted 帧 ChatId 返回）
        session_id: 会话 ID（可选，仅用于日志关联）
        secret_id:  SecretId，不传则自动获取
        secret_key: SecretKey，不传则自动获取
        token:      临时密钥 Token

    Returns:
        dict: {
            "success": true/false,
            "action": "CancelCloudQAsyncTask",
            "data": {"Success": true/false},
            "requestId": "..."
        }
    """
    if not chat_id:
        return {
            "success": False,
            "action": ACTION_CANCEL,
            "error": {"code": "MissingParameter", "message": "ChatID 为必填参数"},
            "requestId": "",
        }

    try:
        from tcloud_api import call_api
    except ImportError:
        return {
            "success": False,
            "action": ACTION_CANCEL,
            "error": {
                "code": "ImportError",
                "message": "无法导入 tcloud_api 模块，请确保 scripts 目录在 Python 路径中"
            },
            "requestId": "",
        }

    payload = {"ChatID": chat_id}
    if session_id:
        payload["SessionID"] = session_id

    result = call_api(
        service=SERVICE, host=HOST, action=ACTION_CANCEL,
        version=VERSION, payload=payload,
        secret_id=secret_id, secret_key=secret_key, token=token,
    )
    return result


# ---------------------------------------------------------------------------
# 便捷轮询函数
# ---------------------------------------------------------------------------

def poll_until_complete(chat_id: str, session_id: str,
                        timeout: int = DEFAULT_POLL_TIMEOUT,
                        on_status=None) -> dict:
    """
    轮询异步任务直到完成、失败或超时。

    Args:
        chat_id:    异步任务 ID
        session_id: 会话 ID
        interval:   轮询间隔（秒），范围 [2, 5]
        timeout:    总超时（秒），默认 120
        on_status:  可选回调，status 变更时调用 on_status(status, result)

    Returns:
        dict: 最后一次 query_async_task 的返回结果
    """
    interval = FIXED_POLL_INTERVAL
    elapsed = 0
    last_status = None
    terminal_statuses = {"completed", "failed", "cancelled", "timeout", "not_found"}
    retried = False

    while elapsed < timeout:
        result = query_async_task(chat_id, session_id)

        if not result.get("success"):
            if not retried:
                retried = True
                time.sleep(1)
                continue  # 重试一次
            # 重试后仍失败，返回错误
            return result

        status = result.get("data", {}).get("Status", "unknown")

        # 状态变更回调
        if on_status and status != last_status:
            on_status(status, result)

        # 到达终态
        if status in terminal_statuses:
            return result

        # 等待后继续轮询
        time.sleep(interval)
        elapsed += interval
        last_status = status

    # 超时
    return {
        "success": False,
        "action": "PollTimeout",
        "error": {
            "code": "PollTimeout",
            "message": f"轮询超时（{timeout}秒），任务可能仍在执行中"
        },
        "requestId": "",
    }


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def _print_usage():
    print(_output_json({
        "success": False,
        "action": ACTION_QUERY,
        "error": {
            "code": "MissingParameter",
            "message": (
                "用法:\n"
                "  python3 tcloud_async_task.py query <chat_id> <session_id>\n"
                "  python3 tcloud_async_task.py cancel <chat_id> [session_id]\n"
                "  python3 tcloud_async_task.py poll <chat_id> <session_id> [timeout]"
            )
        },
        "requestId": "",
    }))


def main():
    """命令行入口"""
    import io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    args = sys.argv[1:]
    if len(args) < 2:
        _print_usage()
        sys.exit(1)

    command = args[0].lower()
    chat_id = args[1] if len(args) > 1 else ""

    if command == "query":
        session_id = args[2] if len(args) > 2 else ""
        result = query_async_task(chat_id, session_id)
        print(_output_json(result))
        if not result.get("success"):
            sys.exit(1)

    elif command == "cancel":
        session_id = args[2] if len(args) > 2 else ""
        result = cancel_async_task(chat_id, session_id)
        print(_output_json(result))
        if not result.get("success"):
            sys.exit(1)

    elif command == "poll":
        session_id = args[2] if len(args) > 2 else ""
        try:
            timeout = int(args[3]) if len(args) > 3 else DEFAULT_POLL_TIMEOUT
        except (ValueError, TypeError):
            print(_output_json({
                "success": False, "action": ACTION_QUERY,
                "error": {"code": "InvalidParameter",
                          "message": "timeout 必须是整数"},
                "requestId": "",
            }))
            sys.exit(1)

        def on_status(status, result):
            print(f"[poll] Status: {status}", file=sys.stderr, flush=True)

        result = poll_until_complete(
            chat_id, session_id,
            timeout=timeout,
            on_status=on_status,
        )
        print(_output_json(result))
        if not result.get("success"):
            sys.exit(1)

    else:
        _print_usage()
        sys.exit(1)


if __name__ == "__main__":
    main()
