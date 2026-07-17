#!/usr/bin/env python3
"""
腾讯云智能顾问 CloudQ SSE 流式调用脚本

通过 TC3-HMAC-SHA256 签名调用 CloudQ 对话接口。
支持 AK/SK 和 OAuth 两种鉴权方式，根据凭证来源自动选择接口：
    - AK/SK（环境变量）  → CloudQChatCompletions
    - OAuth（浏览器授权）→ ConsoleChatCompletions

接口固定参数：
    service:  advisor
    host:     advisor.ai.tencentcloudapi.com
    action:   CloudQChatCompletions | ConsoleChatCompletions（根据凭证来源自动选择）
    version:  2020-07-21

请求格式：
    {"SessionID":"<uuid>","Question":"...","Source":"<platform>"}

响应格式（SSE 大驼峰字段）：
    event:<chat_id>
    data:{"SessionId":"...","ChatId":"...","Event":"content","Content":"...","IsFinal":false}

纯 Python 标准库实现，无外部依赖。

会话管理：
    AI 记忆回传模式：
    - 首次调用不传 --session-id，脚本生成新 UUID 并在输出 JSON 的 data.session_id 中返回
    - AI 记住返回的 session_id，后续调用通过 --session-id 回传
    - 不同会话使用不同 session_id，支持多会话并行

用法 (命令行):
    python3 tcloud_sse_api.py <question> --source <platform> [--session-id <uuid>]

示例:
    python3 tcloud_sse_api.py '列出架构图' --source codebuddy
    python3 tcloud_sse_api.py '详细说说' --source codebuddy --session-id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

兼容旧用法（仍支持位置参数传入 session_id，但不推荐）:
    python3 tcloud_sse_api.py '列出架构图' <session_id> [source]

作为模块导入:
    from tcloud_sse_api import call_sse_api, generate_session_id
    session_id = generate_session_id()
    result = call_sse_api(
        question="列出架构图",
        session_id=session_id,
        on_event=lambda e: print(e["data"].get("Content", ""), end="", flush=True),
    )
    # result["data"]["session_id"] 可用于后续调用

鉴权方式（二选一）:
    方式一：环境变量 AK/SK
        TENCENTCLOUD_SECRET_ID  - 腾讯云 SecretId
        TENCENTCLOUD_SECRET_KEY - 腾讯云 SecretKey
        TENCENTCLOUD_TOKEN      - 临时密钥 Token（可选）

    方式二：OAuth 浏览器授权
        python3 scripts/login.py  # 登录后凭证自动保存

输出格式（统一 JSON）:
    成功: {"success": true, "action": "...", "data": {...}, "requestId": "..."}
    失败: {"success": false, "action": "...", "error": {...}, "requestId": "..."}
"""

import hashlib
import hmac
import json
import os
import re
import ssl
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ---------------------------------------------------------------------------
# 固定参数
# ---------------------------------------------------------------------------
SERVICE = "advisor"
HOST = "advisor.ai.tencentcloudapi.com"
ACTION_AKSK = "CloudQChatCompletions"       # AK/SK 环境变量模式
ACTION_OAUTH = "ConsoleChatCompletions"     # OAuth 浏览器授权模式
VERSION = "2020-07-21"


# ---------------------------------------------------------------------------
# 会话管理
# ---------------------------------------------------------------------------


def generate_session_id() -> str:
    """
    生成新的 SessionID（UUID v4）。

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


def _sign_tc3(key: bytes, msg: str) -> bytes:
    """TC3 HMAC-SHA256 签名辅助函数"""
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


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
        value = line[6:].strip()
        return {"event": value}

    return None


# ---------------------------------------------------------------------------
# SSE 流式 API 调用
# ---------------------------------------------------------------------------

def call_sse_api(question: str, session_id: str,
                 secret_id: str = None, secret_key: str = None,
                 token: str = None, region: str = "ap-guangzhou",
                 source: str = "", on_event=None) -> dict:
    """
    调用 CloudQ SSE 流式 API。

    根据凭证来源自动选择接口：
    - AK/SK（环境变量）  → CloudQChatCompletions
    - OAuth（浏览器授权）→ ConsoleChatCompletions

    Args:
        question:   用户问题
        session_id: 会话 ID（同一对话必须保持不变）
        secret_id:  SecretId，不传则自动获取
        secret_key: SecretKey，不传则自动获取
        token:      临时密钥 Token，不传则自动获取
        region:     地域字符串，默认 ap-guangzhou
        source:     调用来源平台标识（不区分大小写），如 codebuddy、openclaw 等
        on_event:   回调函数，每收到一条 SSE data 事件时调用

    Returns:
        dict: 统一格式的结果字典
    """
    # ---- 凭证获取 & Action 选择 ----
    cred_source = "env"  # 默认假设环境变量

    if secret_id and secret_key:
        # 显式传入凭证，使用 AK/SK 模式
        token = token or os.environ.get("TENCENTCLOUD_TOKEN", "")
    else:
        # 通过 credential_manager 统一获取
        try:
            from credential_manager import (
                get_credential, CredentialExpiredError, CredentialNotFoundError,
            )
            cred = get_credential()
            secret_id = cred["secretId"]
            secret_key = cred["secretKey"]
            token = cred.get("token", "")
            cred_source = cred.get("source", "env")
        except ImportError:
            # credential_manager 不可用，回退到环境变量
            secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
            secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
            token = os.environ.get("TENCENTCLOUD_TOKEN", "")
        except CredentialExpiredError as e:
            return _make_error(
                ACTION_AKSK, "CredentialExpired",
                f"OAuth 凭证已过期，需要重新授权登录。{e}"
            )
        except CredentialNotFoundError:
            return _make_error(
                ACTION_AKSK, "NeedAuth",
                "未找到凭证，请先通过 OAuth 登录或配置 AK/SK 环境变量。"
            )
        except Exception as e:
            return _make_error(
                ACTION_AKSK, "NeedAuth", str(e)
            )

    if not secret_id or not secret_key:
        return _make_error(
            ACTION_AKSK, "MissingCredentials",
            "未配置凭证。请通过 OAuth 登录或配置 AK/SK 环境变量。\n"
            "OAuth 登录: python3 scripts/login.py\n"
            "密钥获取: https://console.cloud.tencent.com/cam/capi"
        )

    # 根据凭证来源选择 Action
    action = ACTION_OAUTH if cred_source == "oauth" else ACTION_AKSK

    payload = {"Question": question, "SessionID": session_id}
    # Source 字段仅 CloudQChatCompletions（AK/SK 模式）支持，ConsoleChatCompletions 不传
    if source and cred_source != "oauth":
        payload["Source"] = source
    payload_str = json.dumps(payload, separators=(",", ":"))

    # ---- TC3-HMAC-SHA256 签名 ----
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(time.time())
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")

    hashed_payload = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    canonical_request = (
        f"POST\n/\n\n"
        f"content-type:application/json\n"
        f"host:{HOST}\n"
        f"x-tc-action:{action.lower()}\n\n"
        f"content-type;host;x-tc-action\n"
        f"{hashed_payload}"
    )

    credential_scope = f"{date}/{SERVICE}/tc3_request"
    hashed_cr = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_cr}"

    secret_date = _sign_tc3(f"TC3{secret_key}".encode("utf-8"), date)
    secret_service = _sign_tc3(secret_date, SERVICE)
    secret_signing = _sign_tc3(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    authorization = (
        f"{algorithm} "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders=content-type;host;x-tc-action, "
        f"Signature={signature}"
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Host": HOST,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": VERSION,
        "X-TC-Region": region,
    }
    if token:
        headers["X-TC-Token"] = token

    req = Request(
        f"https://{HOST}", data=payload_str.encode("utf-8"),
        headers=headers, method="POST",
    )

    # ---- 发送请求并解析 SSE 流 ----
    try:
        ctx = _get_ssl_context()
        resp = urlopen(req, context=ctx, timeout=600)
    except HTTPError as e:
        return _handle_http_error(e, action)
    except URLError as e:
        return _make_error(
            action, "NetworkError",
            f"网络连接失败，请检查网络和域名 {HOST} 是否可达: {e.reason}"
        )
    except Exception as e:
        return _make_error(action, "NetworkError", f"请求异常: {e}")

    # 检查响应类型：腾讯云 API 可能返回 HTTP 200 + JSON 错误体（非 SSE 流）
    content_type = resp.headers.get("Content-Type", "")
    if "text/event-stream" not in content_type:
        return _handle_non_sse_response(resp, action)

    return _parse_sse_stream(resp, on_event, action, cred_source)


def _parse_sse_stream(resp, on_event, action: str, cred_source: str = "env") -> dict:
    """
    解析 CloudQ SSE 流并构建结果。

    响应字段为大驼峰：Content, IsFinal, ChatId, SessionId, Event, Error
    输出统一为小写字段名的结果 dict。

    SSE 流中可能包含错误事件（如权限不足），Error 字段格式：
      {"Code": "UnauthorizedOperation", "Message": "..."}
    """
    content_parts = []
    last_event_data = {}
    request_id = ""
    session_id = ""

    for raw_line in resp:
        line = raw_line.decode("utf-8").rstrip("\r\n")
        parsed = parse_sse_line(line)
        if parsed is None:
            continue

        if parsed.get("event") != "data":
            continue

        data = parsed.get("data")
        if not isinstance(data, dict):
            continue

        if not request_id:
            request_id = data.get("ChatId", "")

        if not session_id:
            session_id = data.get("SessionId", "")

        # 检查 SSE 流中的错误事件
        error_info = data.get("Error")
        if isinstance(error_info, dict) and error_info.get("Code"):
            return _make_error(
                action, error_info.get("Code", "Unknown"),
                error_info.get("Message", "未知错误"),
                request_id,
            )

        if on_event:
            on_event(parsed)

        content = data.get("Content", "")
        if content:
            content_parts.append(content)
        last_event_data = data

    raw_content = "".join(content_parts)
    # 免密链接替换仅在 AK/SK 模式下执行（login_url.py 需要 sts:AssumeRole 权限，OAuth 没有）
    if cred_source != "oauth":
        processed = _replace_console_urls(raw_content)
        processed = _ensure_login_url(processed)
    else:
        processed = raw_content
        # OAuth 模式下检测"未配置凭证"提示，引导用户到 CloudQ 控制台配置
        if _is_credential_not_configured(processed):
            processed += (
                "\n\n请前往 [CloudQ 控制台](https://console.cloud.tencent.com/advisor/cloudq) "
                "完成凭证配置后再使用。"
            )

    merged = {
        "session_id": session_id,
        "content": processed,
        "is_final": last_event_data.get("IsFinal", True),
    }

    return _make_success(action, merged, request_id)


# ---------------------------------------------------------------------------
# OAuth 凭证未配置检测
# ---------------------------------------------------------------------------

# ConsoleChatCompletions 接口在用户未配置 CloudQ 凭证时返回的提示关键词
_CRED_NOT_CONFIGURED_KEYWORDS = [
    "尚未配置腾讯云凭证",
    "未配置腾讯云凭证",
    "凭证设置",
    "前往凭证设置",
]


def _is_credential_not_configured(content: str) -> bool:
    """检测 ConsoleChatCompletions 返回的内容是否为"未配置凭证"提示"""
    if not content:
        return False
    return any(kw in content for kw in _CRED_NOT_CONFIGURED_KEYWORDS)


# ---------------------------------------------------------------------------
# 控制台链接 → 免密登录链接替换
# ---------------------------------------------------------------------------

# 匹配 console.cloud.tencent.com 的 URL（含路径和查询参数）
_CONSOLE_URL_RE = re.compile(r'https://console\.cloud\.tencent\.com[^\s\)\]"\']*')
# 提取 content 中的 archId（arch-开头）
_ARCH_ID_RE = re.compile(r'\barch-[a-z0-9]+\b')
# 免密登录链接特征（已替换过的不再处理）
_LOGIN_URL_MARKER = "cloud.tencent.com/login/roleAccessCallback"
# 不生成免密登录链接的路径（advisor/cloudq 需用户自行登录）
_SKIP_LOGIN_PATHS = re.compile(r'https://console\.cloud\.tencent\.com/advisor/cloudq(\?|/|$)')

# login_url.py 脚本路径
_LOGIN_SCRIPT = Path(__file__).resolve().parent / "login_url.py"


def _generate_login_url(target_url: str) -> str | None:
    """调用 login_url.py 生成免密登录链接，失败返回 None"""
    try:
        result = subprocess.run(
            [sys.executable, str(_LOGIN_SCRIPT), target_url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout.strip())
        if data.get("success"):
            return data["data"]["loginUrl"]
    except Exception:
        pass
    return None


def _append_hide_nav(url: str) -> str:
    """为控制台 URL 追加 hideTopNav=true 参数"""
    if "hideTopNav=true" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}hideTopNav=true"


def _enrich_url_with_arch_id(url: str, arch_id: str) -> str:
    """如果 URL 不含 archId 参数，自动追加第一个 archId"""
    if "archId=" in url or not arch_id:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}archId={arch_id}"


def _extract_first_arch_id(content: str) -> str:
    """从 content 中提取第一个 archId"""
    m = _ARCH_ID_RE.search(content)
    return m.group(0) if m else ""


def _replace_console_urls(content: str) -> str:
    """
    扫描 content 中所有控制台链接，替换为免密登录链接。

    处理逻辑：
    1. 跳过已是免密登录链接的 URL
    2. 如果控制台链接不含 archId，但 content 中有 archId，自动拼入
    3. 追加 hideTopNav 参数
    4. 调用 login_url.py 生成免密链接替换
    5. 生成失败时保留原链接
    """
    if "console.cloud.tencent.com" not in content:
        return content
    urls = _CONSOLE_URL_RE.findall(content)
    if not urls:
        return content

    first_arch_id = _extract_first_arch_id(content)

    # 去重保序
    seen = set()
    unique_urls = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)

    for raw_url in unique_urls:
        if _LOGIN_URL_MARKER in raw_url:
            continue
        if _SKIP_LOGIN_PATHS.match(raw_url):
            continue
        target = _append_hide_nav(raw_url)
        target = _enrich_url_with_arch_id(target, first_arch_id)
        login_url = _generate_login_url(target)
        if login_url:
            content = content.replace(raw_url, login_url)
    return content


def _is_advisor_content(content: str) -> bool:
    """判断内容是否属于智能顾问场景（架构图、评估、巡检等）"""
    advisor_keywords = [
        "架构图", "架构目录", "架构详情", "架构评估", "风险评估",
        "巡检", "智能顾问", "advisor", "ArchId", "archId",
        "arch-", "评估项", "评估结果", "扫描", "架构健康",
    ]
    lower = content.lower()
    return any(kw.lower() in lower for kw in advisor_keywords)


def _ensure_login_url(content: str) -> str:
    """
    确保 content 中包含免密登录链接。
    如果 content 不含任何免密链接，自动生成一个并追加到末尾。

    排除规则：
    - content 中已有 advisor/cloudq 链接（无需免密）则跳过
    场景判断：
    - 智能顾问场景: advisor?hideTopNav=true（有 archId 时追加）
    - 非智能顾问场景: https://console.cloud.tencent.com/
    """
    if not content or _LOGIN_URL_MARKER in content:
        return content

    # 已包含 advisor/cloudq 链接则跳过（该页面不需要免密）
    if "console.cloud.tencent.com/advisor/cloudq" in content:
        return content

    first_arch_id = _extract_first_arch_id(content)

    if _is_advisor_content(content) or first_arch_id:
        base = "https://console.cloud.tencent.com/advisor?hideTopNav=true"
        if first_arch_id:
            target = f"{base}&archId={first_arch_id}"
        else:
            target = base
        label = "前往智能顾问控制台"
    else:
        target = "https://console.cloud.tencent.com/"
        label = "前往腾讯云控制台"

    login_url = _generate_login_url(target)
    if login_url:
        content += f"\n\n[{label}]({login_url})"
    return content


def _handle_http_error(e: HTTPError, action: str) -> dict:
    """处理 HTTP 错误响应"""
    try:
        body = e.read().decode("utf-8")
        data = json.loads(body)
        response = data.get("Response", {})
        error = response.get("Error", {})
        if error:
            return _make_error(
                action, error.get("Code", "HTTPError"),
                error.get("Message", f"HTTP {e.code}"),
                response.get("RequestId", ""),
            )
    except Exception:
        pass
    return _make_error(
        action, "HTTPError",
        f"HTTP 请求失败 (状态码 {e.code}): {e.reason}"
    )


def _handle_non_sse_response(resp, action: str) -> dict:
    """处理非 SSE 响应（HTTP 200 但 Content-Type 非 event-stream，通常是 JSON 错误体）"""
    try:
        body = resp.read().decode("utf-8")
        data = json.loads(body)
        response = data.get("Response", {})
        error = response.get("Error", {})
        if error:
            return _make_error(
                action, error.get("Code", "Unknown"),
                error.get("Message", "未知错误"),
                response.get("RequestId", ""),
            )
        # 非错误但也非 SSE，返回原始数据
        return _make_success(action, response, response.get("RequestId", ""))
    except (json.JSONDecodeError, ValueError):
        return _make_error(
            action, "InvalidResponse",
            f"接口返回非 SSE 格式且无法解析为 JSON: {body[:200]}"
        )
    except Exception as e:
        return _make_error(action, "InvalidResponse", f"解析响应失败: {e}")


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def _output_json(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _parse_args(args: list) -> dict:
    """解析命令行参数，支持 --new / --continue / --source 标志位。

    Returns:
        dict: {
            "question": str,
            "session_id": str | None,  # 传入时非 None
            "source": str,
        }
    """
    if not args:
        return {}

    result = {
        "question": "",
        "session_id": None,
        "source": "",
    }

    # 第一个非标志位参数为 question
    positional = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--source":
            if i + 1 < len(args):
                result["source"] = args[i + 1]
                i += 1
        elif arg.startswith("--source="):
            result["source"] = arg[len("--source="):]
        elif arg == "--session-id":
            if i + 1 < len(args):
                result["session_id"] = args[i + 1]
                i += 1
        elif arg.startswith("--session-id="):
            result["session_id"] = arg[len("--session-id="):]
        elif not result["question"]:
            result["question"] = arg
            positional.append(arg)
        else:
            positional.append(arg)
        i += 1

    # 兼容旧用法：位置参数第2个为 session_id，第3个为 source
    if len(positional) >= 2:
        result["session_id"] = positional[1] if positional[1] else None
    if len(positional) >= 3 and not result["source"]:
        result["source"] = positional[2]

    return result


def main():
    """命令行入口，支持 --session-id 传入会话 ID。"""
    # 锁定 stdout/stderr 为 UTF-8，避免在 Agent 子进程中随 LANG 退化为 ascii
    # 导致中文打印时抛 UnicodeEncodeError 或出现乱码。
    import io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    parsed = _parse_args(sys.argv[1:])
    if not parsed or not parsed.get("question"):
        print(_output_json(_make_error(
            ACTION_AKSK, "MissingParameter",
            "用法: python3 tcloud_sse_api.py <question> --source <platform> "
            "[--session-id <uuid>]"
        )))
        sys.exit(1)

    question = parsed["question"]
    source = parsed["source"]

    # ---- SessionID 决策逻辑 ----
    # 传了 --session-id：续接该会话
    # 没传：生成新 UUID（新会话）
    if parsed["session_id"] is not None:
        session_id = parsed["session_id"]
    else:
        session_id = generate_session_id()

    def on_event(event):
        data = event.get("data", {})
        content = data.get("Content", "")
        if content:
            print(content, end="", flush=True)

    result = call_sse_api(question, session_id, source=source, on_event=on_event)

    print()
    print(_output_json(result))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
