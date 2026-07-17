#!/usr/bin/env python3
"""AI-Gallery / DataBrain HTTP 调用公共 helper（internal）。

被 gallery_*.py 直接 import；agent 禁止直接执行该模块（以下划线开头表示 private）。

设计意图：把所有 HTTP 细节（host / token 读取、Authorization 头、信封解析、
超时分级、错误归一化）下沉到本模块，让各业务脚本仅负责自己那条 endpoint
的参数白名单 + 字段过滤。避免重复实现，更避免 visibility / share_users
等危险字段在多脚本里被泄漏。

零外部依赖（纯 stdlib：urllib + ssl + json）。

环境变量（global 版本：单 host 单 token，无 MCP 网关分支）：
    DATABRAIN_HOST          可选，默认 https://databrain-global.intlgame.com
    DATABRAIN_TOKEN         必填，Bearer token
    DATABRAIN_DISPLAY_HOST  可选，默认 https://databrain-global.intlgame.com，
                            仅用于拼访问 URL（不发请求）

所有接口（Gallery /api/ai-gallery/* + 埋点 /api/v1/*）共享同一 host，
脚本中**无任何独立 host 旁路**。

退出码（脚本统一遵循）：
    0  成功
    1  后端业务错误（GalleryError，code != 0 或网络异常）
    2  入参错误 / 本地预检失败（缺 token、文件 > 50MB、MIME 不支持等）

SSL CA fallback（与 refresh-thumbnail skill 对齐）：
    SSL_CERT_FILE 指向内网 PEM 时，公网 host 校验会挂；首次握手失败后
    会自动用候选系统 cafile 重试一次。
"""

from __future__ import annotations

import json
import mimetypes
import os
import ssl
import sys
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_BIZ_ERROR = 1
EXIT_USAGE = 2

DEFAULT_HOST = "https://databrain-global.intlgame.com"
DEFAULT_DISPLAY_HOST = "https://databrain-global.intlgame.com"

# 超时分级（秒）
TIMEOUT_DEFAULT = 30
TIMEOUT_UPLOAD = 180

# SSL fallback 候选 cafile
_FALLBACK_CAFILE_CANDIDATES = (
    "/etc/ssl/cert.pem",                           # macOS
    "/opt/homebrew/etc/ca-certificates/cert.pem",  # Homebrew (Apple Silicon)
    "/usr/local/etc/ca-certificates/cert.pem",     # Homebrew (Intel)
    "/etc/ssl/certs/ca-certificates.crt",          # Debian / Ubuntu
    "/etc/pki/tls/certs/ca-bundle.crt",            # RHEL / CentOS / Fedora
)

_DEFAULT_SSL_CTX = ssl.create_default_context()
_FALLBACK_SSL_CTX: ssl.SSLContext | None = None
for _candidate in _FALLBACK_CAFILE_CANDIDATES:
    if Path(_candidate).is_file():
        try:
            _FALLBACK_SSL_CTX = ssl.create_default_context(cafile=_candidate)
        except Exception:
            _FALLBACK_SSL_CTX = None
        if _FALLBACK_SSL_CTX is not None:
            break

_SSL_FALLBACK_LOGGED = threading.Event()


class GalleryError(Exception):
    """后端业务错误 / 网络异常的统一封装。"""

    def __init__(
        self,
        code: int,
        msg: str,
        errors: Any = None,
        detail: Any = None,
    ) -> None:
        super().__init__(msg)
        self.code = code
        self.msg = msg
        self.errors = errors
        self.detail = detail

    def to_payload(self) -> dict:
        payload: dict = {"ok": False, "code": self.code, "msg": self.msg}
        if self.errors is not None:
            payload["errors"] = self.errors
        if self.detail is not None:
            payload["detail"] = self.detail
        return payload


def get_host() -> str:
    """决定本次调用使用的 API host。

    DATABRAIN_HOST 显式设置则用，否则使用 DEFAULT_HOST
    (https://databrain-global.intlgame.com)。

    所有接口（含 /api/v1/permission/operationLog）均使用本函数返回值，
    脚本中无独立 host 旁路。
    """
    return os.environ.get("DATABRAIN_HOST") or DEFAULT_HOST


def get_token() -> str:
    """读取 DATABRAIN_TOKEN，缺失则 exit 2。"""
    token = os.environ.get("DATABRAIN_TOKEN")
    if not token:
        print_failure(
            EXIT_USAGE,
            code=-2,
            msg="missing DATABRAIN_TOKEN",
        )
    return token


def get_display_host() -> str:
    return os.environ.get("DATABRAIN_DISPLAY_HOST") or DEFAULT_DISPLAY_HOST


def _build_url(host: str, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not path.startswith("/"):
        path = "/" + path
    return host.rstrip("/") + path


def _encode_multipart(
    fields: dict[str, str],
    file: tuple[str, bytes, str] | None,
) -> tuple[bytes, str]:
    """手工构造 multipart/form-data body（避免 requests 依赖）。

    fields: text-only 字段 {name: value}
    file:   (field_name, filename, bytes, content_type) 元组或 None

    返回 (body_bytes, content_type_header)。
    """
    boundary = f"----GalleryClient{uuid.uuid4().hex}"
    bnd = boundary.encode("ascii")
    crlf = b"\r\n"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(b"--" + bnd + crlf)
        disp = f'Content-Disposition: form-data; name="{name}"'
        parts.append(disp.encode("utf-8") + crlf)
        parts.append(b"Content-Type: text/plain; charset=utf-8" + crlf)
        parts.append(crlf)
        parts.append(str(value).encode("utf-8"))
        parts.append(crlf)
    if file is not None:
        field_name, filename, file_bytes, content_type = file
        parts.append(b"--" + bnd + crlf)
        disp = (
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{filename}"'
        )
        parts.append(disp.encode("utf-8") + crlf)
        parts.append(f"Content-Type: {content_type}".encode("utf-8") + crlf)
        parts.append(crlf)
        parts.append(file_bytes)
        parts.append(crlf)
    parts.append(b"--" + bnd + b"--" + crlf)
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def _decode_response(resp_bytes: bytes) -> dict:
    """解析后端响应；非 JSON → 包装成 GalleryError 抛出。

    支持两种信封：
    1. AI-Gallery / BizException 标准信封：{code, message, data, errors?, detail?}
       - code == 0 → 成功，返回 body.data（缺 data 时退回 body）
       - code != 0 → 抛 GalleryError(code, message, errors, detail)
    2. NestJS 默认 HttpException 信封（如 ValidationPipe 校验失败）：
       {statusCode, message, error}
       - 后端 main.ts 未挂全局 ExceptionFilter，class-validator 失败时走此格式
       - message 可能是 str 也可能是 list[str]（多个字段错误同时上报）
       - 转成 GalleryError(statusCode, "; ".join(message), detail=error)
    """
    if not resp_bytes:
        raise GalleryError(-1, "empty response body")
    try:
        body = json.loads(resp_bytes.decode("utf-8", errors="replace"))
    except (json.JSONDecodeError, ValueError) as exc:
        raise GalleryError(
            -1, f"invalid json response: {exc}"
        ) from exc
    if not isinstance(body, dict):
        raise GalleryError(-1, f"unexpected response shape: {type(body).__name__}")

    code = body.get("code")
    if code is None:
        # 非标准信封兜底：NestJS 默认 BadRequestException 等
        # 形如 {statusCode: 400, message: "...", error: "Bad Request"} 或
        #     {statusCode: 400, message: ["err1", "err2"], error: "Bad Request"}
        if "statusCode" in body and "message" in body:
            msg_raw = body["message"]
            if isinstance(msg_raw, list):
                msg_str = "; ".join(str(m) for m in msg_raw)
            else:
                msg_str = str(msg_raw)
            try:
                status_code = int(body["statusCode"])
            except (TypeError, ValueError):
                status_code = -1
            raise GalleryError(
                status_code,
                msg_str,
                detail=body.get("error"),
            )
        raise GalleryError(-1, "response missing code field")

    if code != 0:
        raise GalleryError(
            int(code) if isinstance(code, (int, str)) and str(code).lstrip("-").isdigit() else -1,
            str(body.get("message") or body.get("msg") or "biz error"),
            errors=body.get("errors"),
            detail=body.get("detail"),
        )
    return body.get("data") if "data" in body else body


def _open_request(req: urllib.request.Request, timeout: int) -> bytes:
    """发送请求；遇 SSL 校验失败用 fallback ctx 重试一次。"""
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_DEFAULT_SSL_CTX) as r:
            return r.read()
    except ssl.SSLCertVerificationError as exc:
        if _FALLBACK_SSL_CTX is None:
            raise GalleryError(-1, f"ssl verify failed (no fallback CA): {exc}") from exc
        if not _SSL_FALLBACK_LOGGED.is_set():
            _SSL_FALLBACK_LOGGED.set()
            print(
                f"[_gallery_client] ssl fallback engaged (cafile fallback for {req.full_url})",
                file=sys.stderr,
            )
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_FALLBACK_SSL_CTX) as r:
                return r.read()
        except Exception as exc2:
            raise GalleryError(-1, f"ssl fallback also failed: {exc2}") from exc2
    except urllib.error.HTTPError as exc:
        # 后端业务错误也走 HTTPError（如 401 / 403 / 500 等）；
        # 尝试读 body 走信封解析。
        try:
            raw = exc.read()
        except Exception:
            raw = b""
        if raw:
            return raw
        raise GalleryError(-1, f"http error {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise GalleryError(-1, f"network: {exc.reason}") from exc
    except TimeoutError as exc:
        raise GalleryError(-1, f"timeout after {timeout}s") from exc


def request_json(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    multipart_fields: dict[str, str] | None = None,
    multipart_file: tuple[str, str, bytes, str] | None = None,
    timeout: int = TIMEOUT_DEFAULT,
) -> Any:
    """统一发送请求并返回 body.data；错误抛 GalleryError。

    multipart_file: (field_name, filename, file_bytes, content_type)
    json_body 与 multipart_* 互斥。
    """
    token = get_token()
    host = get_host()
    url = _build_url(host, path)

    headers = {
        "Authorization": f"Bearer {token}",
        "Origin": host,
        "Accept": "application/json",
    }
    data: bytes | None = None
    if multipart_fields is not None or multipart_file is not None:
        fields = multipart_fields or {}
        body, ctype = _encode_multipart(fields, multipart_file)
        data = body
        headers["Content-Type"] = ctype
    elif json_body is not None:
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"

    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    resp_bytes = _open_request(req, timeout)
    return _decode_response(resp_bytes)


def guess_upload_mime(file_path: str) -> str:
    """按扩展名推断上传 MIME；不在 ZIP/HTML 白名单内 → 抛 GalleryError。"""
    lower = file_path.lower()
    if lower.endswith(".zip"):
        return "application/zip"
    if lower.endswith(".html") or lower.endswith(".htm"):
        return "text/html"
    raise GalleryError(
        -2, f"unsupported file extension: {Path(file_path).suffix or '(none)'}"
    )


def print_success(payload: dict) -> None:
    """成功输出（stdout 单行 JSON），exit 0。"""
    out = {"ok": True}
    out.update(payload)
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(EXIT_OK)


def print_failure(exit_code: int, *, code: int, msg: str, errors: Any = None, detail: Any = None) -> None:
    """失败输出（stdout 单行 JSON，与契约一致），按 exit_code 退出。"""
    payload: dict = {"ok": False, "code": code, "msg": msg}
    if errors is not None:
        payload["errors"] = errors
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(exit_code)


def handle_gallery_error(exc: GalleryError) -> None:
    """把 GalleryError 转成 print_failure（exit 1）。"""
    print_failure(EXIT_BIZ_ERROR, code=exc.code, msg=exc.msg, errors=exc.errors, detail=exc.detail)


def setup_stdio_utf8() -> None:
    """统一把 stdout / stderr 切到 UTF-8，避免中文乱码。"""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except AttributeError:
            pass


# 启动时自动 UTF-8 化；被 import 时也会执行，无副作用
setup_stdio_utf8()
