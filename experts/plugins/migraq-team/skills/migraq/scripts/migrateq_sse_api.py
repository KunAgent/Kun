#!/usr/bin/env python3
"""
MigraQ ChatCompletions SSE 流式调用脚本

支持两种调用模式：
    1. 免鉴权模式（售前流程）：直接调用免鉴权 endpoint，无需 AK/SK
    2. 鉴权模式（迁移执行等）：通过腾讯云 TC3-HMAC-SHA256 签名调用

接口固定参数：
    鉴权 host:    cmg.ai.tencentcloudapi.com
    免鉴权 host:  msp.cloud.tencent.com（可通过 CMG_NO_AUTH_HOST 覆盖）
    免鉴权 path:  /open/chat（可通过 CMG_NO_AUTH_PATH 覆盖）
    免鉴权 scheme: https（可通过 CMG_NO_AUTH_SCHEME 覆盖）
    action:       ChatCompletions
    version:      2024-10-15
    region:       ap-shanghai（可通过 CMG_REGION 环境变量覆盖）

    请求格式：
    {"Input": "...", "Stream": true}

响应格式（SSE，text/event-stream）：
    event: run.started
    data: {"type":"run.started","session_id":"..."}

    event: message.delta
    data: {"type":"message.delta","delta":"..."}

    event: message.completed
    data: {"type":"message.completed","reply":"...","usage":{...}}

纯 Python 标准库实现，无外部依赖，支持 Windows / Linux / macOS。

用法 (命令行):
    python3 migrateq_sse_api.py <question> [session_id]
    python3 migrateq_sse_api.py --no-auth <question> [session_id]
    python3 migrateq_sse_api.py --clear-session
    python3 migrateq_sse_api.py --dry-run <question> [session_id]

示例:
    # 免鉴权（售前流程：扫描、推荐、TCO等）
    python3 migrateq_sse_api.py --no-auth '阿里云50台ECS如何迁移到腾讯云？'
    # 鉴权（迁移执行、集群管理等）
    python3 migrateq_sse_api.py '帮我执行迁移任务'
    python3 migrateq_sse_api.py --dry-run '测试鉴权是否正确'

作为模块导入:
    from migrateq_sse_api import call_sse_api, call_sse_api_no_auth, generate_session_id
    session_id = generate_session_id()
    # 免鉴权
    result = call_sse_api_no_auth(question="阿里云ECS怎么迁？", session_id=session_id)
    # 鉴权
    result = call_sse_api(question="执行迁移任务", session_id=session_id)

环境变量:
    TENCENTCLOUD_SECRET_ID     - 腾讯云 SecretId（鉴权模式必填）
    TENCENTCLOUD_SECRET_KEY    - 腾讯云 SecretKey（鉴权模式必填）
    CMG_REGION                 - 地域（可选，默认 ap-shanghai）
    CMG_NO_AUTH_HOST           - 免鉴权 endpoint host（可选，默认 msp.cloud.tencent.com）
    CMG_NO_AUTH_PATH           - 免鉴权 endpoint path（可选，默认 /open/chat）
    CMG_NO_AUTH_SCHEME         - 免鉴权 endpoint scheme（可选，默认 https）

输出格式（统一 JSON）:
    成功: {"success": true, "action": "ChatCompletions", "data": {"content": "...", "is_final": true, "session_id": "..."}, "requestId": "..."}
    失败: {"success": false, "action": "ChatCompletions", "error": {"code": "...", "message": "..."}, "requestId": ""}
"""

import datetime
import hashlib
import hmac
import json
import os
import ssl
import sys
import threading
import time
import uuid
from http.client import HTTPConnection, HTTPSConnection
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# 强制 stdout/stderr 使用 UTF-8，避免非 UTF-8 locale 下中文输出异常
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# 固定参数
# ---------------------------------------------------------------------------
ACTION = "ChatCompletions"
_HOST = "cmg.ai.tencentcloudapi.com"
_VERSION = "2024-10-15"
_SERVICE = "cmg"
_DEFAULT_REGION = "ap-shanghai"
_NO_AUTH_HOST = "msp.cloud.tencent.com"
_NO_AUTH_PATH = "/open/chat"
_NO_AUTH_SCHEME = "https"  # http 或 https
_AUTH_FAIL_CODES = {
    "AuthFailure.SecretIdNotFound",
    "AuthFailure.SignatureFailure",
    "AuthFailure.SignatureExpire",
    "AuthFailure.InvalidSecretId",
    "AuthFailure.TokenFailure",
    "AuthFailure.InvalidAuthorization",
}


# ---------------------------------------------------------------------------
# 会话管理
# ---------------------------------------------------------------------------

def generate_session_id() -> str:
    """
    生成新的 SessionID（UUID v4）。

    SessionID 用于控制多轮对话上下文：
    - 同一对话的所有轮次必须使用同一个 SessionID
    - 用户开启新对话时调用本函数生成新的 SessionID

    Returns:
        str: UUID v4 格式的 SessionID
    """
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# 内部工具函数
# ---------------------------------------------------------------------------

def _get_ssl_context():
    """获取 SSL 上下文，始终启用证书验证"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _make_error(code: str, message: str, request_id: str = "") -> dict:
    """构造统一错误结果"""
    return {
        "success": False,
        "action": ACTION,
        "error": {"code": code, "message": message},
        "requestId": request_id,
    }


def _make_success(data: dict, request_id: str = "") -> dict:
    """构造统一成功结果"""
    return {
        "success": True,
        "action": ACTION,
        "data": data,
        "requestId": request_id,
    }


def _resolve_credentials(secret_id: str = None, secret_key: str = None):
    """读取 AK/SK 凭证（优先参数，其次环境变量）"""
    secret_id = secret_id or os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = secret_key or os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
    return secret_id, secret_key


def _check_credentials(secret_id: str, secret_key: str):
    """
    检查 AK/SK 是否已配置，未配置则返回错误结果。

    Returns:
        None 表示凭证完整；dict 表示缺失，包含引导信息。
    """
    missing = []
    if not secret_id:
        missing.append("TENCENTCLOUD_SECRET_ID")
    if not secret_key:
        missing.append("TENCENTCLOUD_SECRET_KEY")
    if not missing:
        return None

    guide = (
        "请先配置腾讯云 API 密钥后再使用 MigraQ。\n"
        f"  缺少环境变量: {', '.join(missing)}\n"
        "\n"
        "  Linux / macOS（写入 ~/.zshrc 或 ~/.bashrc）:\n"
        '    echo \'export TENCENTCLOUD_SECRET_ID="your-secret-id"\' >> ~/.zshrc\n'
        '    echo \'export TENCENTCLOUD_SECRET_KEY="your-secret-key"\' >> ~/.zshrc\n'
        "    source ~/.zshrc\n"
        "\n"
        "  Windows PowerShell（写入用户级环境变量）:\n"
        '    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_ID", "your-secret-id", "User")\n'
        '    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_KEY", "your-secret-key", "User")\n'
        "\n"
        "  密钥获取地址: https://console.cloud.tencent.com/cam/capi"
    )
    return _make_error("MissingCredentials", guide)


def _tc3_sign(secret_key: str, secret_id: str, host: str, payload_str: str,
              action: str, version: str, region: str, timestamp: int) -> dict:
    """
    生成腾讯云 TC3-HMAC-SHA256 签名，返回请求头字典。

    参考: https://cloud.tencent.com/document/api/213/30654
    """
    date = datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc).strftime("%Y-%m-%d")

    # Step 1: 构造规范请求（SignedHeaders 包含 x-tc-action，提升签名安全性）
    ct = "application/json"
    canonical_headers = f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    canonical_request = "\n".join([
        "POST", "/", "",
        canonical_headers, signed_headers, hashed_payload,
    ])

    # Step 2: 构造待签字符串
    algorithm = "TC3-HMAC-SHA256"
    credential_scope = f"{date}/{_SERVICE}/tc3_request"
    hashed_cr = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_cr}"

    # Step 3: 计算签名
    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, _SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    # Step 4: 构造 Authorization
    authorization = (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    return {
        "Host": host,
        "Content-Type": ct,
        "X-TC-Action": action,
        "X-TC-Version": version,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Region": region,
        "X-TC-Language": "zh-CN",
        "Authorization": authorization,
    }


# ---------------------------------------------------------------------------
# SSE 行解析
# ---------------------------------------------------------------------------

def parse_sse_line(line: str):
    """
    解析单行 SSE 数据。

    Returns:
        dict | None:
            - id 行:               {"type": "id", "value": "..."}
            - event 行:            {"event": "<value>"}
            - data 行(JSON 有效):  {"event": "data", "data": {...}}
            - data 行(JSON 无效):  {"event": "data", "raw": "..."}
            - 空行/注释行:          None
    """
    if not line or line.startswith(":"):
        return None

    if line.startswith("id:"):
        return {"type": "id", "value": line[3:].strip()}

    if line.startswith("data:"):
        payload = line[5:].lstrip()
        try:
            return {"event": "data", "data": json.loads(payload)}
        except (json.JSONDecodeError, ValueError):
            return {"event": "data", "raw": payload}

    if line.startswith("event:"):
        return {"event": line[6:].strip()}

    return None


# ---------------------------------------------------------------------------
# SSE 流式 API 调用
# ---------------------------------------------------------------------------

def call_sse_api(question: str, session_id: str = None,
                 region: str = None,
                 secret_id: str = None, secret_key: str = None,
                 on_delta=None, timeout: int = 600) -> dict:
    """
    调用 ChatCompletions SSE 流式 API。

    Args:
        question:    用户问题（必填）
        session_id:  会话 ID（必传，首次调用不传则自动生成 UUID v4）。
                     作为 SessionKey 传入服务端，服务端按此字段隔离对话上下文。
                     多轮对话时必须传入上次返回的 session_id 以保持上下文。
        region:      地域，不传则从 CMG_REGION 环境变量读取，默认 ap-shanghai
        secret_id:   腾讯云 SecretId，不传则从环境变量读取
        secret_key:  腾讯云 SecretKey，不传则从环境变量读取
        on_delta:    回调函数，每收到一段流式文本时调用，参数为 str
        timeout:     请求超时秒数，默认 600

    Returns:
        dict: 统一格式的结果字典
    """
    region = region or os.environ.get("CMG_REGION", _DEFAULT_REGION)
    secret_id, secret_key = _resolve_credentials(secret_id, secret_key)

    cred_err = _check_credentials(secret_id, secret_key)
    if cred_err:
        return cred_err

    # 首次调用未传入 session_id 时自动生成，多轮对话时沿用上次返回的值
    if not session_id:
        session_id = generate_session_id()

    payload = {"Input": question, "Stream": True, "SessionKey": session_id}
    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp = int(now.timestamp())

    headers = _tc3_sign(secret_key, secret_id, _HOST, payload_str,
                        ACTION, _VERSION, region, timestamp)
    headers["Accept"] = "text/event-stream"

    # 使用 HTTPSConnection 实现无缓冲实时 SSE 读取
    try:
        ctx = _get_ssl_context()
        conn = HTTPSConnection(_HOST, context=ctx, timeout=timeout)
        conn.request("POST", "/", body=payload_str.encode("utf-8"), headers=headers)
        resp = conn.getresponse()
    except Exception as e:
        return _make_error("NetworkError", f"无法连接 CMG API ({_HOST}): {e}")

    if resp.status != 200:
        try:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            err = data.get("Response", {}).get("Error", {})
            code = err.get("Code", "")
            msg = err.get("Message") or f"HTTP {resp.status}"
        except Exception:
            code = ""
            msg = f"HTTP {resp.status}"
        conn.close()
        # 鉴权失败（401/403 或 AuthFailure 错误码）单独返回，方便上层区分处理
        if resp.status in (401, 403) or code in _AUTH_FAIL_CODES:
            return _make_error("AuthError", f"鉴权失败，请检查 AK/SK 是否正确: {msg}")
        return _make_error("HTTPError", f"CMG API 返回错误: {msg}")

    # HTTP 200：检查 Content-Type
    # 鉴权失败时后端返回 text/plain + JSON 错误体，不是 SSE 流
    content_type = resp.getheader("Content-Type", "")
    if "text/plain" in content_type or "application/json" in content_type:
        try:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            err = data.get("Response", {}).get("Error", {})
            code = err.get("Code", "")
            msg = err.get("Message", body)
            request_id = data.get("Response", {}).get("RequestId", "")
            if code in _AUTH_FAIL_CODES or code.startswith("AuthFailure"):
                return _make_error("AuthError", f"鉴权失败，请检查 AK/SK 是否正确: {msg}", request_id)
            if code:
                return _make_error("HTTPError", f"CMG API 返回错误 [{code}]: {msg}", request_id)
            return _make_error("StreamError", "CMG API 返回非流式响应且无法解析")
        except Exception as e:
            return _make_error("StreamError", f"CMG API 返回非流式响应: {e}")
        finally:
            conn.close()

    try:
        return _parse_sse_stream(resp, session_id, on_delta)
    finally:
        conn.close()


def clear_session(region: str = None,
                  secret_id: str = None, secret_key: str = None) -> dict:
    """
    清除当前会话上下文（本接口无状态，调用方重新生成 session_id 即可）。

    为保持接口兼容性而保留，实际执行为空操作并返回成功。

    Returns:
        dict: 统一格式的结果字典
    """
    return _make_success({"message": "session cleared"})


def call_sse_api_no_auth(question: str, session_id: str = None,
                         host: str = None, path: str = None,
                         on_delta=None, timeout: int = 600) -> dict:
    """
    调用免鉴权 ChatCompletions SSE 流式 API（售前流程）。

    无需 AK/SK，直接发送请求到免鉴权 endpoint。
    适用于：资源扫描、选型推荐、账单导入、TCO 分析、评估、拓扑可视化等售前流程。

    Args:
        question:    用户问题（必填）
        session_id:  会话 ID（可选，不传自动生成 UUID v4）
        host:        免鉴权 endpoint host（可选，默认从 CMG_NO_AUTH_HOST 环境变量或内置默认值）
        path:        免鉴权 endpoint path（可选，默认从 CMG_NO_AUTH_PATH 环境变量或 /open/chat）
        on_delta:    回调函数，每收到一段流式文本时调用
        timeout:     请求超时秒数，默认 600

    Returns:
        dict: 统一格式的结果字典
    """
    host = host or os.environ.get("CMG_NO_AUTH_HOST", _NO_AUTH_HOST)
    path = path or os.environ.get("CMG_NO_AUTH_PATH", _NO_AUTH_PATH)

    if not session_id:
        session_id = generate_session_id()

    payload = {"Input": question, "Stream": True, "SessionKey": session_id}
    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    headers = {
        "Host": host,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    try:
        # 根据 scheme 判断使用 HTTP 或 HTTPS
        scheme = os.environ.get("CMG_NO_AUTH_SCHEME", _NO_AUTH_SCHEME)
        if scheme == "https":
            ctx = _get_ssl_context()
            conn = HTTPSConnection(host, context=ctx, timeout=timeout)
        else:
            conn = HTTPConnection(host, timeout=timeout)
        conn.request("POST", path, body=payload_str.encode("utf-8"), headers=headers)
        resp = conn.getresponse()
    except Exception as e:
        return _make_error("NetworkError", f"无法连接免鉴权 API ({host}{path}): {e}")

    if resp.status != 200:
        try:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            err = data.get("Response", {}).get("Error", {})
            msg = err.get("Message") or f"HTTP {resp.status}"
        except Exception:
            msg = f"HTTP {resp.status}"
        conn.close()
        return _make_error("HTTPError", f"免鉴权 API 返回错误: {msg}")

    # 检查 Content-Type
    content_type = resp.getheader("Content-Type", "")
    if "text/plain" in content_type or "application/json" in content_type:
        try:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            err = data.get("Response", {}).get("Error", {})
            code = err.get("Code", "")
            msg = err.get("Message", body)
            request_id = data.get("Response", {}).get("RequestId", "")
            if code:
                return _make_error("HTTPError", f"免鉴权 API 返回错误 [{code}]: {msg}", request_id)
            return _make_error("StreamError", "免鉴权 API 返回非流式响应且无法解析")
        except Exception as e:
            return _make_error("StreamError", f"免鉴权 API 返回非流式响应: {e}")
        finally:
            conn.close()

    try:
        return _parse_sse_stream(resp, session_id, on_delta)
    finally:
        conn.close()


def _parse_sse_stream(resp, session_id: str, on_delta) -> dict:
    """
    解析 ChatCompletions SSE 流并构建结果。

    实际响应格式：
        event: run.started
        data: {"type":"run.started","session_id":"..."}

        event: run.progress
        data: {"type":"run.progress","stage":"...","summary":"..."}

        event: message.delta
        data: {"type":"message.delta","delta":"..."}

        event: message.completed
        data: {"type":"message.completed","reply":"...","usage":{...}}
    """
    content_parts = []
    request_id = ""
    usage = {}
    first_delta_received = False
    stream_error = None  # 记录 SSE 流内的业务错误

    # 心跳线程：在收到第一个文本增量前，每 10 秒向 stderr 输出一次等待提示
    stop_heartbeat = threading.Event()

    def _heartbeat():
        elapsed = 0
        while not stop_heartbeat.wait(10):
            if first_delta_received:
                break
            elapsed += 10
            print(f"[MigraQ] 远端专家处理中，已等待 {elapsed} 秒，请勿中断……", file=sys.stderr, flush=True)

    heartbeat_thread = threading.Thread(target=_heartbeat, daemon=True)
    heartbeat_thread.start()

    try:
        # 使用 readline() 逐行读取，无缓冲，保证 SSE 实时性
        while True:
            raw = resp.readline()
            if not raw:
                break

            line = raw.decode("utf-8").rstrip("\r\n")

            if line == "" or line.startswith(":"):
                continue

            if line.startswith("event:"):
                continue  # event 类型已通过 data.type 区分，无需单独处理

            if not line.startswith("data:"):
                continue

            data_str = line[5:].lstrip()

            if data_str == "[DONE]":
                break

            try:
                data = json.loads(data_str)
            except (json.JSONDecodeError, ValueError):
                continue

            event_type = data.get("type", "")

            # 流式文本增量
            if event_type == "message.delta":
                delta = data.get("delta", "")
                if delta:
                    if not first_delta_received:
                        first_delta_received = True
                        stop_heartbeat.set()
                    content_parts.append(delta)
                    if on_delta:
                        on_delta(delta)

            # 完成事件：提取完整回复和 usage
            elif event_type == "message.completed":
                # 若流式 delta 已拼接内容则保留，否则用 reply 字段兜底
                if not content_parts:
                    reply = data.get("reply", "")
                    if reply:
                        content_parts.append(reply)
                        if on_delta:
                            on_delta(reply)
                usage = data.get("usage", {})
                break

            # 失败事件：后端通过 SSE 流返回的业务错误
            elif event_type in ("response.failed", "error"):
                err_obj = data.get("response", data)
                err_detail = err_obj.get("error", {})
                err_code = err_detail.get("code") or err_obj.get("code", "StreamError")
                err_msg = err_detail.get("message") or err_obj.get("message", str(data))
                stream_error = _make_error("StreamError", f"远端服务返回错误 [{err_code}]: {err_msg}", request_id)
                break

            # 兼容：data 中直接含 Response.Error 字段（部分腾讯云接口格式）
            elif "Response" in data:
                resp_err = data["Response"].get("Error")
                if resp_err:
                    err_code = resp_err.get("Code", "StreamError")
                    err_msg = resp_err.get("Message", str(resp_err))
                    request_id = data["Response"].get("RequestId", "")
                    stream_error = _make_error("StreamError", f"远端服务返回错误 [{err_code}]: {err_msg}", request_id)
                    break

    finally:
        stop_heartbeat.set()

    # 优先返回流内业务错误
    if stream_error:
        return stream_error

    # SSE 流结束但无任何内容且无错误事件，视为异常
    if not content_parts:
        return _make_error("StreamError", "远端服务未返回任何内容，请稍后重试或检查网络连接", request_id)

    return _make_success(
        {
            "content": "".join(content_parts),
            "is_final": True,
            "session_id": session_id,
            "usage": usage,
        },
        request_id,
    )


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def _output_json(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=True)


def main():
    """命令行入口：python3 migrateq_sse_api.py [--no-auth] <question> [session_id]"""
    args = sys.argv[1:]

    # --clear-session 模式
    if args and args[0] == "--clear-session":
        result = clear_session()
        print(_output_json(result))
        sys.exit(0 if result.get("success") else 1)

    # --dry-run 模式：仅打印签名请求头和 payload，不发送请求
    dry_run = False
    if args and args[0] == "--dry-run":
        dry_run = True
        args = args[1:]

    # --no-auth 模式：免鉴权调用
    no_auth = False
    if args and args[0] == "--no-auth":
        no_auth = True
        args = args[1:]

    if len(args) < 1:
        print(_output_json(_make_error(
            "MissingParameter",
            "用法: python3 migrateq_sse_api.py [--no-auth] <question> [session_id]\n"
            "     python3 migrateq_sse_api.py --dry-run <question> [session_id]\n"
            "     python3 migrateq_sse_api.py --clear-session"
        )))
        sys.exit(1)

    question = args[0]
    session_id = args[1] if len(args) > 1 else None  # 首次调用由内部生成

    if dry_run:
        region, secret_id, secret_key = (
            os.environ.get("CMG_REGION", _DEFAULT_REGION),
            *_resolve_credentials(),
        )
        cred_err = _check_credentials(secret_id, secret_key)
        if cred_err:
            print(_output_json(cred_err))
            sys.exit(1)
        if not session_id:
            session_id = generate_session_id()
        payload = {"Input": question, "Stream": True, "SessionKey": session_id}
        payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        timestamp = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        headers = _tc3_sign(secret_key, secret_id, _HOST, payload_str,
                            ACTION, _VERSION, region, timestamp)
        headers["Accept"] = "text/event-stream"
        dry_run_info = {
            "success": True,
            "action": "DryRun",
            "data": {
                "endpoint": f"https://{_HOST}",
                "session_id": session_id,
                "payload": payload,
                "headers": headers,
            },
        }
        print(_output_json(dry_run_info))
        sys.exit(0)

    def on_delta(delta: str):
        print(delta.encode("unicode_escape").decode("ascii"), end="", flush=True)

    if no_auth:
        result = call_sse_api_no_auth(question=question, session_id=session_id, on_delta=on_delta)
    else:
        result = call_sse_api(question=question, session_id=session_id, on_delta=on_delta)

    # 流式输出结束后换行，再打印统一 JSON 结果
    print()
    print(_output_json(result))

    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
