#!/usr/bin/env python3
"""
AndonQ ChatCompletionsAndonQ SSE 流式调用脚本

通过 OAuth2 临时码鉴权调用 ChatCompletionsAndonQ 接口。
该接口为 AndonQ 全局对话接口，核心能力由后端统一承载，
包括工单/需求单查询、云产品问答、云资源查询等。

接口固定参数：
    URL:    https://andon.cloud.tencent.com/api/v1/gateway/chat-completions-andonq
    method: POST
    header: X-TANDON-CODE: <临时码>
    action: ChatCompletionsAndonQ

请求格式：
    {"content":"...","session_id":"<uuid>"}

SSE 响应事件（对齐 OpenClaw gwproto.StreamEvent，小驼峰字段）：
    event: message.delta       → {"type":"message.delta","delta":"..."}
    event: message.completed   → {"type":"message.completed","reply":"..."}
    event: run.progress        → {"type":"run.progress","stage":"...","summary":"..."}
    event: run.completed       → {"type":"run.completed"}
    event: run.error           → {"type":"run.error","error":{"type":"...","message":"..."}}

纯 Python 标准库实现（certifi 仅用于 SSL 证书兼容）。

用法 (命令行):
    python3 andon_sse_api.py <question> [session_id] [--verbose]

示例:
    python3 andon_sse_api.py '查询我的工单'
    python3 andon_sse_api.py '详细说说' <首轮使用的 session_id>
    python3 andon_sse_api.py '查询我的工单' <session_id> --verbose  # 调试用

作为模块导入:
    from andon_sse_api import call_sse_api, generate_session_id
    from andon_auth import load_auth_code
    session_id = generate_session_id()
    result = call_sse_api(
        question="查询我的工单",
        session_id=session_id,
        on_event=lambda e: None,
    )
    # 库函数仍返回 dict，方便程序化调用；CLI 走 stdout/stderr + 退出码。

鉴权（临时码存储在本地）:
    路径:   ~/.andonq/auth.json
    字段:   {"token": "<临时码>", "obtained_at": <Unix 秒级时间戳>}
    获取:   访问授权 URL 登录后复制临时码，由 check_env.py 引导落盘
    授权 URL: https://cloud.tencent.com/open/authorize?app_id=100048267608
              &redirect_url=http%3A%2F%2Fandon.qq.com%2Foauth%2Faq%2Fcallback
              &scope=login&state=<随机 uuid>
    说明:   临时码在其授权有效期内可跨会话复用；过期后需重新授权并绑定

CLI 输出约定:
    stdout : SSE 正文（message.delta 全部收齐后一次性输出，原样 Markdown）
             —— 不做流式透传，避免 Agent 终端中 stdout/stderr 交错污染
    stderr : 首行固定为 `[session] <uuid>`（本次实际使用的 session_id，便于追问复用）；
             其后仅在调用失败时输出错误引导（人话，LLM 直读即可照做）。
             run.progress 阶段提示默认静默，仅 `--verbose` 时打到 stderr
    退出码 : 0 = 成功；1 = 失败（参数缺失 / 授权失效 / 网络错误 / 运行错误）
"""

import json
import ssl
import sys
import uuid
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from andon_auth import (
    AUTH_HEADER,
    build_authorize_url,
    load_auth_code,
)

# ---------------------------------------------------------------------------
# 固定参数
# ---------------------------------------------------------------------------
API_URL = "https://andon.cloud.tencent.com/api/v1/gateway/chat-completions-andonq"
ACTION = "ChatCompletionsAndonQ"

# ---------------------------------------------------------------------------
# SSE 事件类型（对齐 gwproto.StreamEventType）
# ---------------------------------------------------------------------------
EVT_MESSAGE_DELTA = "message.delta"
EVT_MESSAGE_COMPLETED = "message.completed"
EVT_RUN_PROGRESS = "run.progress"
EVT_RUN_COMPLETED = "run.completed"
EVT_RUN_ERROR = "run.error"
# OpenAI 风格哨兵（兼容）
SSE_DONE_SENTINEL = "[DONE]"

# ---------------------------------------------------------------------------
# 会话管理
# ---------------------------------------------------------------------------

def generate_session_id() -> str:
    """
    生成新的 SessionID（UUID v4）。

    SessionID 用于控制多轮对话上下文：
    - 同一对话的所有轮次必须使用同一个 SessionID
    - 用户开启新对话时必须调用本函数生成新的 SessionID

    Returns:
        str: UUID v4 格式的 SessionID
    """
    return str(uuid.uuid4())

# ---------------------------------------------------------------------------
# 内部工具函数
# ---------------------------------------------------------------------------

def _get_ssl_context():
    """获取 SSL 上下文，兼容各平台 CA 证书差异"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        raise ImportError(
            "certifi is required for secure SSL/TLS verification. "
            "Please install it with: pip install certifi"
        )

def _make_error(action: str, code: str, message: str, request_id: str = "") -> dict:
    """构造统一错误结果"""
    return {
        "success": False,
        "action": action,
        "error": {"code": code, "message": message},
        "requestId": request_id,
    }

def _make_success(action: str, data: dict, request_id: str) -> dict:
    """构造统一成功结果"""
    return {
        "success": True,
        "action": action,
        "data": data,
        "requestId": request_id,
    }

# ---------------------------------------------------------------------------
# SSE 行解析
# ---------------------------------------------------------------------------

def parse_sse_line(line: str):
    """
    解析单行 SSE 数据。

    Returns:
        dict | None:
            - id 行:                   {"type": "id", "value": "..."}
            - event 行:                {"sse_event": "<value>"}
            - data 行(JSON 有效):      {"sse_event": "data", "data": {...}}
            - data 行(DONE 哨兵):      {"sse_event": "data", "done": True}
            - data 行(JSON 无效):      {"sse_event": "data", "raw": "..."}
            - 空行/注释行:              None
    """
    if not line or line.startswith(":"):
        return None

    if line.startswith("id:"):
        return {"type": "id", "value": line[3:].strip()}

    if line.startswith("event:"):
        return {"sse_event": line[6:].strip()}

    if line.startswith("data:"):
        payload = line[5:].lstrip()
        if payload == SSE_DONE_SENTINEL:
            return {"sse_event": "data", "done": True}
        try:
            return {"sse_event": "data", "data": json.loads(payload)}
        except (json.JSONDecodeError, ValueError):
            return {"sse_event": "data", "raw": payload}

    return None

# ---------------------------------------------------------------------------
# SSE 流式 API 调用
# ---------------------------------------------------------------------------

def call_sse_api(question: str, session_id: str,
                 auth_code: str = None,
                 on_event=None, on_progress=None) -> dict:
    """
    调用 ChatCompletionsAndonQ SSE 流式 API。

    Args:
        question:    用户问题（对应请求体 Content 字段）
        session_id:  会话 ID（同一对话必须保持不变）
        auth_code:   OAuth2 临时码，不传则从 ~/.andonq/auth.json 读取
        on_event:    message.delta / message.completed 事件回调（收到文本片段或最终文本时触发）
        on_progress: run.progress 事件回调（高层运行阶段更新）

    Returns:
        dict: 统一格式的结果字典
    """
    if auth_code is None:
        auth_code, _ = load_auth_code()

    if not auth_code:
        return _make_error(
            ACTION, "MissingAuthCode",
            "未找到 OAuth2 临时码，需您先完成授权绑定。请按以下步骤操作：\n"
            "Step 1: 打开授权页面\n"
            f"authorize_url: {build_authorize_url()}\n"
            "Step 2: 登录成功后，复制页面上展示的临时码\n"
            "Step 3: 绑定临时码（二选一）\n"
            "  - 推荐：将临时码直接发送给我，我来帮您完成绑定\n"
            "  - 或：您在终端执行 `python3 scripts/andon_auth.py --save '<临时码>'`"
        )

    payload = {"content": question, "session_id": session_id}
    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "x-andonq-sse-from": "expert",
        AUTH_HEADER: auth_code,
    }

    req = Request(
        API_URL, data=payload_str.encode("utf-8"),
        headers=headers, method="POST",
    )

    # ---- 发送请求并解析 SSE 流 ----
    try:
        ctx = _get_ssl_context()
        resp = urlopen(req, context=ctx, timeout=600)
    except HTTPError as e:
        return _handle_http_error(e)
    except URLError as e:
        return _make_error(
            ACTION, "NetworkError",
            f"网络连接失败，请检查网络和 {API_URL} 是否可达: {e.reason}"
        )
    except Exception as e:
        return _make_error(ACTION, "NetworkError", f"请求异常: {e}")

    return _parse_sse_stream(resp, on_event=on_event, on_progress=on_progress)

def _parse_sse_stream(resp, on_event=None, on_progress=None) -> dict:
    """
    解析 ChatCompletionsAndonQ SSE 流并构建结果。

    事件契约（对齐 gwproto.StreamEvent）：
    - message.delta      -> 追加 delta 到 content 缓冲；触发 on_event
    - message.completed  -> 使用 reply 覆写 content（保证完整）；触发 on_event
    - run.progress       -> 触发 on_progress（不影响 content）
    - run.completed      -> 正常结束
    - run.error          -> 直接返回统一错误结果
    - 其他 type           -> 静默忽略

    说明：不做任何后处理（链接替换、URL 改写等），
    content 原样返回，由后端 ChatCompletionsAndonQ 统一承载业务逻辑。
    """
    delta_buffer = []
    final_reply = None
    request_id = ""
    terminal_error = None
    completed = False

    current_event = None  # 当前帧 event: 行读到的类型

    for raw_line in resp:
        line = raw_line.decode("utf-8").rstrip("\r\n")

        # 空行 = 帧结束，重置 current_event
        if line == "":
            current_event = None
            continue

        parsed = parse_sse_line(line)
        if parsed is None:
            continue

        # event: 行只缓存，真正处理发生在配套 data: 行上
        if "sse_event" in parsed and parsed["sse_event"] != "data":
            current_event = parsed["sse_event"]
            continue

        # data: 行
        if parsed.get("sse_event") != "data":
            continue

        # 1) [DONE] 哨兵：立即结束
        if parsed.get("done"):
            completed = True
            break

        data = parsed.get("data")
        if not isinstance(data, dict):
            continue

        # type 字段以 payload 为准，event: 行作为兜底
        evt_type = data.get("type") or current_event

        # 记录 request_id（任意事件都可能携带）
        # 注意：后端会返回自己的 session_id（如 im:clawith-gateway:...），
        # 但我们始终使用调用方传入的 session_id，不采纳后端版本。
        if not request_id:
            request_id = data.get("request_id", "") or request_id

        if evt_type == EVT_MESSAGE_DELTA:
            delta = data.get("delta", "")
            if delta:
                delta_buffer.append(delta)
            if on_event:
                on_event({"type": EVT_MESSAGE_DELTA, "data": data})

        elif evt_type == EVT_MESSAGE_COMPLETED:
            reply = data.get("reply", "")
            # 以 reply 作为最终完整文本（优先级高于拼接的 delta）
            if reply:
                final_reply = reply
            if on_event:
                on_event({"type": EVT_MESSAGE_COMPLETED, "data": data})

        elif evt_type == EVT_RUN_PROGRESS:
            if on_progress:
                on_progress({"type": EVT_RUN_PROGRESS, "data": data})

        elif evt_type == EVT_RUN_COMPLETED:
            completed = True
            break

        elif evt_type == EVT_RUN_ERROR:
            err = data.get("error") or {}
            terminal_error = {
                "code": err.get("type", "RunError") or "RunError",
                "message": err.get("message", "ChatCompletionsAndonQ 运行失败"),
            }
            break

        # 其他事件类型静默忽略

    if terminal_error:
        return _make_error(
            ACTION, terminal_error["code"], terminal_error["message"], request_id
        )

    content = final_reply if final_reply is not None else "".join(delta_buffer)
    merged = {
        "content": content,
        "is_final": completed or final_reply is not None,
    }
    return _make_success(ACTION, merged, request_id)

def _handle_http_error(e: HTTPError) -> dict:
    """处理 HTTP 错误响应"""
    # 401 / 403 → 临时码失效，明确提示用户重新授权
    if e.code in (401, 403):
        return _make_error(
            ACTION, "AuthCodeInvalid",
            "OAuth2 临时码已失效或无权限（可能已过授权有效期），需重新授权：\n"
            "Step 1: 打开授权页面\n"
            f"authorize_url: {build_authorize_url()}\n"
            "Step 2: 登录成功后，复制页面上展示的临时码\n"
            "Step 3: 绑定临时码（二选一）\n"
            "  - 推荐：将新临时码直接发送给我，我来帮您完成绑定\n"
            "  - 或：您在终端执行 `python3 scripts/andon_auth.py --save '<新临时码>'`"
        )
    try:
        body = e.read().decode("utf-8")
        data = json.loads(body)
        # 优先兼容腾讯云风格错误结构（Response.Error）
        response = data.get("Response", {}) if isinstance(data, dict) else {}
        error = response.get("Error", {}) if isinstance(response, dict) else {}
        if error:
            return _make_error(
                ACTION, error.get("Code", "HTTPError"),
                error.get("Message", f"HTTP {e.code}"),
                response.get("RequestId", ""),
            )
        # 兼容通用错误结构 {code, message}
        if isinstance(data, dict) and ("code" in data or "message" in data):
            return _make_error(
                ACTION, str(data.get("code", "HTTPError")),
                str(data.get("message", f"HTTP {e.code}")),
                str(data.get("request_id", "")),
            )
    except Exception:
        pass
    return _make_error(
        ACTION, "HTTPError",
        f"HTTP 请求失败 (状态码 {e.code}): {e.reason}"
    )

# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def _parse_cli_args(argv):
    """
    解析命令行参数。

    支持位置参数 + 可选 --verbose/-v 标志：
        python3 andon_sse_api.py <question> [session_id] [--verbose]

    Returns:
        (question, session_id_or_None, verbose_bool)
    """
    if not argv:
        return None, None, False

    verbose = False
    positional = []
    for arg in argv:
        if arg in ("--verbose", "-v"):
            verbose = True
        else:
            positional.append(arg)

    if not positional:
        return None, None, verbose

    question = positional[0]
    session_id = positional[1] if len(positional) > 1 else None
    return question, session_id, verbose

def main():
    """命令行入口：python3 andon_sse_api.py <question> [session_id] [--verbose]

    输出约定（为 Agent 调用优化）：
        stdout : SSE 正文，**收齐后一次性输出**（非流式），原样 Markdown + 末尾换行
        stderr : 首行 `[session] <uuid>`；失败时追加错误引导
                 `--verbose` 时额外打 run.progress 阶段提示（调试用）
        退出码 : 0 成功 / 1 失败

    设计说明：
        Agent 场景下不需要打字机效果，只需要最终完整 Markdown。
        流式 stdout 与 stderr progress 在 Agent 终端里会字节级交错污染，
        让模型误判为"乱码/编码异常"并尝试各种无效重试（改 LANG、2>/dev/null、
        重定向到文件等）。改为一次性输出后，stdout 永远是一整块干净 Markdown。
    """
    # 锁定 stdout/stderr 为 UTF-8，避免在 Agent 子进程中随 LANG 退化为 ascii
    # 导致中文打印时抛 UnicodeEncodeError 让 stdout 变空、反被模型误判为"编码问题"。
    # errors="replace" 兜底：极端情况下坏字符变 ? 也好过整脚本崩溃一字不出。
    import io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    question, session_id, verbose = _parse_cli_args(sys.argv[1:])
    if question is None:
        print(
            "用法: python3 andon_sse_api.py <question> [session_id] [--verbose]",
            file=sys.stderr, flush=True,
        )
        sys.exit(1)

    if session_id is None:
        session_id = generate_session_id()

    # 始终把本次使用的 session_id 回显到 stderr 首行，
    # 便于 Agent 在首轮调用后读取并在后续追问中显式复用。
    # 约定格式：`[session] <uuid>`，Agent 可用正则 `^\[session\] (\S+)` 提取。
    print(f"[session] {session_id}", file=sys.stderr, flush=True)

    # --- 回调：均不直接写 stdout，仅库侧累积 content，main 结束后一次性输出 ---

    def on_event(event):
        """message.delta / message.completed 由库函数内部累积，这里无需动作"""
        return

    def on_progress(event):
        """run.progress 阶段提示：默认静默，仅 --verbose 时打到 stderr"""
        if not verbose:
            return
        data = event.get("data", {})
        stage = data.get("stage", "") or "progress"
        summary = data.get("summary", "")
        msg = f"[{stage}] {summary}" if summary else f"[{stage}]"
        print(msg, file=sys.stderr, flush=True)

    result = call_sse_api(
        question, session_id,
        on_event=on_event, on_progress=on_progress,
    )

    if result.get("success"):
        # 一次性输出完整 Markdown 正文，末尾补一个换行
        content = result.get("data", {}).get("content", "") or ""
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")
        sys.stdout.flush()
        return

    # 失败：把人话错误信息（含授权引导 Step 1/2/3 + URL）打到 stderr
    err = result.get("error") or {}
    code = err.get("code", "Error")
    message = err.get("message", "调用失败")
    request_id = result.get("requestId", "")
    header = f"[{code}]"
    if request_id:
        header += f" (requestId={request_id})"
    print(header, file=sys.stderr, flush=True)
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)

if __name__ == "__main__":
    main()
