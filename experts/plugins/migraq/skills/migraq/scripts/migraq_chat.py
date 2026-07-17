#!/usr/bin/env python3
"""
migraq_chat.py - 太湖登录态两步 chat 调用脚本

流程：
  Step 1: 通过 tai-auth.sh / tai-auth.ps1 携带太湖 OAuth2 Bearer Token，调用
          POST /proxy/internal/auth/tof/token
          网关解密太湖注入的 x-tai-identity，签发内部 token

  Step 2: 用上一步拿到的 token，直连内网
          POST http://chat.migraq.woa.com:8080/proxy/internal/chat
          Header: X-Internal-Token: <token>
          Body:   { "input": "...", "SessionKey": "..." }

输出格式：
  - SSE delta 实时打印到 stdout（供 agent 感知进度）
  - 流结束后换行，输出统一 JSON（含 session_id，供多轮对话串联）

Usage:
  python3 migraq_chat.py "你的问题"
  python3 migraq_chat.py "你的问题" --session-id <session_id>
  python3 migraq_chat.py --token-only
  python3 migraq_chat.py --use-token <token> "你的问题"

依赖：
  - tai-auth.sh（macOS/Linux）或 tai-auth.ps1（Windows），同目录
  - python3 标准库（subprocess / json / uuid / http.client / argparse）
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from http.client import HTTPConnection

# ===== 配置 =====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 平台自动选择认证脚本：Windows 用 PowerShell 脚本，其余用 bash 脚本
IS_WINDOWS = sys.platform == "win32"
if IS_WINDOWS:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.ps1")
    TAI_AUTH_CMD = ["powershell", "-ExecutionPolicy", "Bypass", "-File", TAI_AUTH_SCRIPT]
else:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.sh")
    TAI_AUTH_CMD = [TAI_AUTH_SCRIPT]

TOF_TOKEN_URL = "https://migraq-chat.mcp.it.woa.com/proxy/internal/auth/tof/token"
CHAT_HOST = "chat.migraq.woa.com"
CHAT_PATH = "/proxy/internal/chat"


# ===== 日志（输出到 stderr，不干扰 stdout 的结构化输出）=====
def log(msg):
    print(f"[migraq-chat] {msg}", file=sys.stderr)


def log_error(msg):
    print(f"[migraq-chat] ✗ {msg}", file=sys.stderr)


def _start_heartbeat(interval=15):
    """启动心跳线程：距上次收到任何 SSE 事件超过 interval 秒后打印等待提示。
    返回 (stop_fn, touch_fn)：
      - touch_fn()  每次收到 SSE 事件时调用，重置静默计时器
      - stop_fn()   流结束时调用，终止线程
    """
    stop_event = threading.Event()
    last_activity = [time.time()]   # 用列表包装，允许内部函数修改
    wait_start = [time.time()]      # 记录本次静默开始时间

    def touch():
        last_activity[0] = time.time()
        wait_start[0] = time.time()

    def _beat():
        while not stop_event.wait(1):           # 每秒检查一次
            silent = time.time() - last_activity[0]
            if silent >= interval:
                elapsed = int(time.time() - wait_start[0])
                log(f"远端分析中，已静默 {elapsed} 秒，请耐心等候...")
                last_activity[0] = time.time() # 打印后重置，避免连续刷屏

    t = threading.Thread(target=_beat, daemon=True)
    t.start()

    def stop():
        stop_event.set()

    return stop, touch


# ===== Step 1: 获取 TOF token =====
def get_tof_token():
    log("Step 1: 获取太湖登录态 token...")
    log(f"  URL: {TOF_TOKEN_URL}")

    if not os.path.isfile(TAI_AUTH_SCRIPT):
        script_name = "tai-auth.ps1" if IS_WINDOWS else "tai-auth.sh"
        log_error(f"{script_name} not found: {TAI_AUTH_SCRIPT}")
        sys.exit(1)
    if not IS_WINDOWS and not os.access(TAI_AUTH_SCRIPT, os.X_OK):
        os.chmod(TAI_AUTH_SCRIPT, 0o755)

    result = subprocess.run(
        TAI_AUTH_CMD + ["-u", TOF_TOKEN_URL, "-m", "POST", "-b", "{}"],
        capture_output=True,
        text=True,
        )

    resp = result.stdout.strip()
    if not resp:
        log_error("Step 1 failed: empty response from tai-auth.sh")
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(resp)
        token = data["Response"]["Token"]
    except (json.JSONDecodeError, KeyError):
        log_error("Step 1 failed: could not extract Token from response:")
        print(resp, file=sys.stderr)
        sys.exit(1)

    log("Step 1: token 获取成功")
    return token


# ===== Step 2: 调用 chat =====
def do_chat(token, input_text, session_id):
    log("Step 2: 发起 chat 请求...")
    log(f"  URL: http://{CHAT_HOST}{CHAT_PATH}")
    log(f"  session_id: {session_id}")

    body = json.dumps(
        {"input": input_text, "SessionKey": session_id},
        ensure_ascii=False,
    ).encode("utf-8")

    headers = {
        "Host": CHAT_HOST,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "X-Internal-Token": token,
    }

    try:
        conn = HTTPConnection(CHAT_HOST, timeout=1800)
        conn.request("POST", CHAT_PATH, body=body, headers=headers)
        resp = conn.getresponse()
    except Exception as e:
        _print_json({"success": False, "action": "ChatCompletions",
                     "error": {"code": "NetworkError", "message": str(e)}, "requestId": ""})
        return False

    if resp.status != 200:
        msg = resp.read()[:200].decode("utf-8", errors="replace")
        conn.close()
        _print_json({"success": False, "action": "ChatCompletions",
                     "error": {"code": "HTTPError", "message": f"HTTP {resp.status}: {msg}"}, "requestId": ""})
        return False

    stop_heartbeat, touch_heartbeat = _start_heartbeat(interval=15)
    try:
        return _parse_sse(resp, session_id, touch_heartbeat)
    finally:
        stop_heartbeat()
        conn.close()


def _parse_sse(resp, session_id, touch_heartbeat=None):
    """
    解析 SSE 流：
    - message.delta 实时打印到 stdout（unicode_escape 编码，与 migrateq_sse_api.py 一致）
    - 流结束后换行，输出统一 JSON（含 session_id 供多轮串联）
    - touch_heartbeat: 每次收到任意 SSE 事件时调用，用于重置心跳静默计时器
    """
    content_parts = []
    usage = {}
    request_id = ""
    stream_error = None

    try:
        while True:
            raw = resp.readline()
            if not raw:
                break
            line = raw.decode("utf-8").rstrip("\r\n")

            if line == "" or line.startswith(":"):
                continue
            if line.startswith("event:"):
                continue
            if not line.startswith("data:"):
                continue

            # 收到任意 data 行，重置心跳计时器
            if touch_heartbeat:
                touch_heartbeat()

            data_str = line[5:].lstrip()
            if data_str == "[DONE]":
                break

            try:
                data = json.loads(data_str)
            except (json.JSONDecodeError, ValueError):
                continue

            event_type = data.get("type", "")

            if event_type == "message.delta":
                delta = data.get("delta", "")
                if delta:
                    content_parts.append(delta)
                    print(delta.encode("unicode_escape").decode("ascii"), end="", flush=True)

            elif event_type == "message.completed":
                if not content_parts:
                    reply = data.get("reply", "")
                    if reply:
                        content_parts.append(reply)
                        print(reply.encode("unicode_escape").decode("ascii"), end="", flush=True)
                usage = data.get("usage", {})
                request_id = data.get("request_id", "")
                break

            # 后端通过 SSE 流返回的业务错误
            elif event_type in ("response.failed", "error"):
                err_obj = data.get("response", data)
                err_detail = err_obj.get("error", {})
                err_code = err_detail.get("code") or err_obj.get("code", "StreamError")
                err_msg = err_detail.get("message") or err_obj.get("message", str(data))
                stream_error = {"code": "StreamError", "message": f"远端服务返回错误 [{err_code}]: {err_msg}"}
                break

            # 兼容腾讯云 API 3.0 格式的 SSE 错误
            elif "Response" in data:
                resp_err = data["Response"].get("Error")
                if resp_err:
                    err_code = resp_err.get("Code", "StreamError")
                    err_msg = resp_err.get("Message", str(resp_err))
                    request_id = data["Response"].get("RequestId", "")
                    stream_error = {"code": "StreamError", "message": f"远端服务返回错误 [{err_code}]: {err_msg}"}
                    break

    except KeyboardInterrupt:
        pass

    # 流式输出结束后换行
    print()

    # 优先返回流内业务错误
    if stream_error:
        _print_json({"success": False, "action": "ChatCompletions",
                     "error": stream_error, "requestId": request_id})
        return False

    if not content_parts:
        _print_json({"success": False, "action": "ChatCompletions",
                     "error": {"code": "StreamError", "message": "远端服务未返回任何内容，请稍后重试或检查网络连接"},
                     "requestId": request_id})
        return False

    _print_json({
        "success": True,
        "action": "ChatCompletions",
        "data": {
            "content": "".join(content_parts),
            "is_final": True,
            "session_id": session_id,
            "usage": usage,
        },
        "requestId": request_id,
    })
    return True


def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(
        prog="migraq_chat.py",
        description="太湖登录态两步 chat 调用脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 migraq_chat.py "帮我分析一下这段代码的性能问题"
  python3 migraq_chat.py "你好" --session-id my-project-session
  python3 migraq_chat.py --token-only
  python3 migraq_chat.py --use-token eyJ... "继续上次的对话"
        """,
    )
    parser.add_argument("input", nargs="?", default=None, help="问题/输入内容")
    parser.add_argument("--session-id", default=None, help="聊天会话 ID（默认：随机生成 UUID）")
    parser.add_argument("--token-only", action="store_true", help="只打印 Step 1 签发的 token")
    parser.add_argument("--use-token", default=None, metavar="TOKEN", help="跳过 Step 1，直接使用指定 token")

    args = parser.parse_args()

    if not args.token_only and not args.use_token and not args.input:
        parser.error("缺少必要参数: input（问题内容）")

    session_id = args.session_id or str(uuid.uuid4())

    # Step 1
    if args.use_token:
        log("跳过 Step 1，使用指定 token")
        internal_token = args.use_token
    else:
        internal_token = get_tof_token()

    if args.token_only:
        print(internal_token)
        sys.exit(0)

    # Step 2
    ok = do_chat(internal_token, args.input, session_id)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
