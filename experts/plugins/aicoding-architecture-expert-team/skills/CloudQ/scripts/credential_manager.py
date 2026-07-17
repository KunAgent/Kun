#!/usr/bin/env python3
"""
CloudQ 凭证统一管理模块 (Authorization Code 模式)

凭证获取优先级：
    1. 环境变量 AK/SK（TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY）
    2. OAuth 凭证文件（~/.tencent-cloudq/credential.json）
    3. 抛出 CredentialNotFoundError

核心功能：
    - get_credential()            获取当前可用凭证
    - maybe_refresh_credential()  自动刷新快过期的 OAuth 凭证
    - get_authorize_url()         从服务端获取授权 URL
    - exchange_token()            用 authorization_code 换 token
    - get_tmp_cred()              用 accessToken 换临时密钥
    - refresh_access_token()      用 refreshToken 刷新 accessToken
    - save_credential()           原子写入凭证文件
    - clear_credential()          清除 OAuth 凭证
"""

import json
import os
import platform
import ssl
import stat
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import quote

# ============== 配置 ==============

CONFIG_DIR = Path.home() / ".tencent-cloudq"
CREDENTIAL_FILE = CONFIG_DIR / "credential.json"

# OAuth 服务端地址
OAUTH_ENDPOINT = os.environ.get(
    "CLOUDQ_OAUTH_ENDPOINT", "https://cloudq.cloud.tencent.com"
)

# 刷新安全窗口
_CRED_REFRESH_SAFE_DUR = 60 * 5       # 临时密钥过期前 5 分钟触发刷新
_ACCESS_REFRESH_SAFE_DUR = 60 * 5     # accessToken 过期前 5 分钟触发刷新


# ============== 异常 ==============

class CredentialNotFoundError(Exception):
    """未找到任何可用凭证"""
    pass


class CredentialExpiredError(Exception):
    """OAuth 凭证已过期（refreshToken 失效），需要重新登录"""
    pass


# ============== SSL ==============

def _get_ssl_context():
    """获取 SSL 上下文，强制验证证书"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


# ============== 文件操作（安全） ==============

def _ensure_config_dir():
    """确保配置目录存在且权限正确"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_DIR), stat.S_IRWXU)  # 700
        except OSError:
            pass


def _set_file_permission(filepath: Path):
    """设置文件权限为 600（仅所有者可读写）"""
    if platform.system() != "Windows":
        try:
            os.chmod(str(filepath), stat.S_IRUSR | stat.S_IWUSR)  # 600
        except OSError:
            pass


def _atomic_write_json(filepath: Path, data: dict):
    """原子写入 JSON 文件（临时文件 + rename，防崩溃损坏）"""
    _ensure_config_dir()

    temp_file = filepath.parent / f".{filepath.name}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        temp_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        _set_file_permission(temp_file)
        temp_file.rename(filepath)
    except Exception:
        if temp_file.exists():
            temp_file.unlink()
        raise


# ============== HTTP 工具 ==============

class OAuthServerError(Exception):
    """OAuth 服务端返回错误（HTTP 非 200 或业务错误）"""
    pass


def _extract_error(resp_headers: dict, body: str) -> str:
    """从 tRPC 错误响应中提取错误信息。

    支持两种错误响应格式：
    1. 自定义 ErrHandler（推荐）：HTTP body 中包含 JSON {"error": {"code": ..., "message": ...}}
    2. 默认 tRPC 行为：错误信息在 Trpc-Error-Msg 响应头中，body 为空
    """
    # 优先从 body 中的 JSON 解析（自定义 ErrHandler 格式）
    if body:
        try:
            data = json.loads(body)
            if isinstance(data, dict):
                err = data.get("error")
                if isinstance(err, dict):
                    code = err.get("code", "")
                    msg = err.get("message", "")
                    if msg:
                        return f"[{code}] {msg}" if code else msg
                if isinstance(err, str):
                    return err
        except (json.JSONDecodeError, ValueError):
            pass
        # body 非 JSON，截断返回
        return body[:200]
    # 回退：从 Trpc-Error-Msg 头读取（默认 tRPC 行为）
    trpc_msg = resp_headers.get("Trpc-Error-Msg", "")
    if trpc_msg:
        return trpc_msg
    return "未知服务端错误"


def _http_post(url: str, body: dict, timeout: int = 30) -> dict:
    """发送 POST 请求到 OAuth 服务端"""
    data = json.dumps(body).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ctx = _get_ssl_context() if url.startswith("https://") else None
    try:
        with urlopen(req, context=ctx, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return _check_response(result)
    except HTTPError as e:
        resp_headers = {k: v for k, v in e.headers.items()}
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        msg = _extract_error(resp_headers, err_body)
        raise OAuthServerError(msg) from e
    except URLError as e:
        raise OAuthServerError(f"网络连接失败: {e.reason}") from e


def _http_get(url: str, timeout: int = 30) -> dict:
    """发送 GET 请求到 OAuth 服务端"""
    req = Request(url, headers={"Accept": "application/json"}, method="GET")
    ctx = _get_ssl_context() if url.startswith("https://") else None
    try:
        with urlopen(req, context=ctx, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return _check_response(result)
    except HTTPError as e:
        resp_headers = {k: v for k, v in e.headers.items()}
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        msg = _extract_error(resp_headers, err_body)
        raise OAuthServerError(msg) from e
    except URLError as e:
        raise OAuthServerError(f"网络连接失败: {e.reason}") from e


def _check_response(result: dict) -> dict:
    """检查 tRPC HTTP 响应是否包含错误（自定义 ErrHandler 返回的错误）。

    自定义 ErrHandler 会在 HTTP 200 body 中返回 {"error": {"code": ..., "message": ...}}，
    需要将其转换为 OAuthServerError 异常。
    """
    if isinstance(result, dict) and "error" in result:
        err = result["error"]
        if isinstance(err, dict) and err.get("message"):
            code = err.get("code", "")
            msg = err.get("message", "")
            raise OAuthServerError(f"[{code}] {msg}" if code else msg)
    return result


# ============== OAuth API 调用 ==============

def get_authorize_url(local_redirect_url: str, site: str = "cn") -> dict:
    """
    步骤 1：从服务端获取授权 URL 和 state

    服务端会：
    1. 用自己的白名单回调地址构造腾讯云授权 URL
    2. 记录 local_redirect_url，授权完成后 302 回转到本地

    Args:
        local_redirect_url: 本地回调地址（如 http://localhost:9201/callback）
        site: 站点标识

    Returns:
        {"authorize_url": "https://cloud.tencent.com/open/authorize?...", "state": "..."}
    """
    url = (
        f"{OAUTH_ENDPOINT}/oauth/cq/authorize"
        f"?local_redirect_url={quote(local_redirect_url, safe='')}&site={quote(site, safe='')}"
    )
    try:
        resp = _http_get(url)
    except OAuthServerError as e:
        raise RuntimeError(f"获取授权 URL 失败: {e}") from e
    # tRPC 使用 proto snake_case 字段名序列化
    return {
        "authorize_url": resp.get("authorize_url", ""),
        "state": resp.get("state", ""),
    }


def exchange_token(code: str) -> dict:
    """
    步骤 3：用 authorization_code 换取 token

    Args:
        code: 授权回调返回的 authorization_code

    Returns:
        {
            "user_access_token": "...",
            "refresh_token": "...",
            "user_open_id": "...",
            "expires_at": 1712345678
        }
    """
    url = f"{OAUTH_ENDPOINT}/oauth/cq/exchange_token"
    body = {"code": code}
    try:
        resp = _http_post(url, body)
    except OAuthServerError as e:
        raise RuntimeError(f"exchange_token 失败: {e}") from e
    # tRPC 使用 proto snake_case 字段名；int64 可能序列化为字符串
    return {
        "user_access_token": resp.get("user_access_token", ""),
        "refresh_token": resp.get("refresh_token", ""),
        "user_open_id": resp.get("user_open_id", ""),
        "expires_at": int(resp.get("expires_at", 0)),
    }


def get_tmp_cred(access_token: str, site: str = "cn") -> dict:
    """
    步骤 4：用 accessToken 换取腾讯云临时密钥

    Returns:
        {"secretId": "...", "secretKey": "...", "token": "...", "expiresAt": 1712345678}
    """
    url = f"{OAUTH_ENDPOINT}/oauth/cq/get_tmp_cred"
    body = {"access_token": access_token}
    try:
        resp = _http_post(url, body)
    except OAuthServerError as e:
        raise RuntimeError(f"获取临时密钥失败: {e}") from e
    # tRPC 使用 proto snake_case 字段名；uint64 可能序列化为字符串
    return {
        "secretId": resp.get("tmp_secret_id", ""),
        "secretKey": resp.get("tmp_secret_key", ""),
        "token": resp.get("token", ""),
        "expiresAt": int(resp.get("expired_time", 0)),
    }


def refresh_access_token(refresh_token: str, user_open_id: str, site: str = "cn") -> dict:
    """
    步骤 5：用 refreshToken + userOpenId 刷新 accessToken

    Returns:
        {"user_access_token": "...", "expires_at": 1712345678}
    """
    url = f"{OAUTH_ENDPOINT}/oauth/cq/refresh_token"
    body = {
        "refresh_token": refresh_token,
        "user_open_id": user_open_id,
    }
    try:
        resp = _http_post(url, body)
    except OAuthServerError as e:
        raise CredentialExpiredError(
            f"refreshToken 已过期或无效: {e}。"
            f"请重新授权登录。"
        ) from e
    # tRPC 使用 proto snake_case 字段名；int64 可能序列化为字符串
    return {
        "user_access_token": resp.get("user_access_token", ""),
        "expires_at": int(resp.get("expires_at", 0)),
    }


# ============== 凭证存储 ==============

def _save_oauth_info_only(cred_data: dict, oauth_info: dict):
    """仅更新凭证文件中的 oauth 部分（accessToken/expiresAt），保留原有临时密钥。

    用于 accessToken 刷新成功但 get_tmp_cred 尚未执行时的中间持久化，
    防止 get_tmp_cred 失败导致新 accessToken 丢失。
    """
    data = {
        "type": "oauth",
        "secretId": cred_data.get("secretId", ""),
        "secretKey": cred_data.get("secretKey", ""),
        "token": cred_data.get("token", ""),
        "expiresAt": cred_data.get("expiresAt", 0),
        "oauth": {
            "accessToken": oauth_info.get("accessToken", ""),
            "refreshToken": oauth_info.get("refreshToken", ""),
            "userOpenId": oauth_info.get("userOpenId", ""),
            "expiresAt": oauth_info.get("expiresAt", 0),
            "site": oauth_info.get("site", "cn"),
        },
        "createdAt": cred_data.get("createdAt", datetime.now(timezone.utc).isoformat()),
    }
    _atomic_write_json(CREDENTIAL_FILE, data)


def save_credential(cred: dict, oauth_info: dict):
    """
    保存 OAuth 凭证到本地文件（原子写入 + 权限保护）

    Args:
        cred: {"secretId", "secretKey", "token", "expiresAt"}
        oauth_info: {"accessToken", "refreshToken", "userOpenId", "expiresAt", "site"}
    """
    data = {
        "type": "oauth",
        "secretId": cred["secretId"],
        "secretKey": cred["secretKey"],
        "token": cred["token"],
        "expiresAt": cred["expiresAt"],
        "oauth": {
            "accessToken": oauth_info["accessToken"],
            "refreshToken": oauth_info["refreshToken"],
            "userOpenId": oauth_info.get("userOpenId", ""),
            "expiresAt": oauth_info["expiresAt"],
            "site": oauth_info.get("site", "cn"),
        },
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    _atomic_write_json(CREDENTIAL_FILE, data)


def load_credential() -> dict | None:
    """读取本地 OAuth 凭证文件，不存在或格式错误返回 None"""
    if not CREDENTIAL_FILE.exists():
        return None
    try:
        data = json.loads(CREDENTIAL_FILE.read_text(encoding="utf-8"))
        if data.get("type") != "oauth":
            return None
        return data
    except (json.JSONDecodeError, IOError):
        return None


def clear_credential():
    """清除 OAuth 凭证文件"""
    if CREDENTIAL_FILE.exists():
        CREDENTIAL_FILE.unlink()


# ============== 核心：自动刷新 ==============

def maybe_refresh_credential():
    """
    检查 OAuth 凭证是否快过期，自动刷新。

    刷新逻辑：
    1. 临时密钥剩余 > 5 分钟 → 不刷新
    2. accessToken 剩余 < 5 分钟 → 用 refreshToken + userOpenId 刷新
    3. 用 accessToken 换取新的临时密钥
    4. 写回文件
    """
    cred_data = load_credential()
    if cred_data is None:
        return

    now = time.time()
    expires_at = cred_data.get("expiresAt", 0)

    # 临时密钥还有效，不刷新
    if expires_at - now > _CRED_REFRESH_SAFE_DUR:
        return

    oauth_info = cred_data.get("oauth", {})
    access_token = oauth_info.get("accessToken", "")
    refresh_token = oauth_info.get("refreshToken", "")
    user_open_id = oauth_info.get("userOpenId", "")
    access_expires = oauth_info.get("expiresAt", 0)
    site = oauth_info.get("site", "cn")

    if not access_token or not refresh_token:
        return

    # accessToken 快过期 → 用 refreshToken + userOpenId 刷新
    if access_expires - now < _ACCESS_REFRESH_SAFE_DUR:
        new_token_info = refresh_access_token(refresh_token, user_open_id, site)
        oauth_info["accessToken"] = new_token_info["user_access_token"]
        oauth_info["expiresAt"] = new_token_info["expires_at"]
        access_token = new_token_info["user_access_token"]
        # 先持久化新的 oauth_info，防止下一步 get_tmp_cred 失败导致新 accessToken 丢失
        _save_oauth_info_only(cred_data, oauth_info)

    # 用 accessToken 换取新的临时密钥
    new_cred = get_tmp_cred(access_token, site)
    save_credential(new_cred, oauth_info)


# ============== 核心：获取凭证 ==============

def get_credential() -> dict:
    """
    获取可用凭证，支持 AK/SK 环境变量和 OAuth 双模式。

    优先级：
    1. 环境变量 AK/SK
    2. OAuth 凭证文件

    Returns:
        {
            "secretId": "...",
            "secretKey": "...",
            "token": "...",
            "source": "env" | "oauth"
        }

    Raises:
        CredentialNotFoundError: 无任何可用凭证
        CredentialExpiredError: OAuth 凭证已过期
    """
    # 1. 环境变量 AK/SK
    env_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    env_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
    if env_id and env_key:
        return {
            "secretId": env_id,
            "secretKey": env_key,
            "token": os.environ.get("TENCENTCLOUD_TOKEN", ""),
            "source": "env",
        }

    # 2. OAuth 凭证文件
    cred_data = load_credential()
    if cred_data is not None:
        # 尝试自动刷新
        try:
            maybe_refresh_credential()
            cred_data = load_credential()
        except CredentialExpiredError:
            raise
        except Exception:
            pass  # 刷新失败，下面会检查凭证是否仍然有效

        if cred_data:
            # 检查临时密钥是否已过期（刷新失败时可能返回过期凭证）
            now = time.time()
            if cred_data.get("expiresAt", 0) < now:
                raise CredentialExpiredError(
                    "OAuth 临时密钥已过期且自动刷新失败，请重新授权登录。"
                )
            return {
                "secretId": cred_data["secretId"],
                "secretKey": cred_data["secretKey"],
                "token": cred_data.get("token", ""),
                "source": "oauth",
            }

    # 无凭证
    raise CredentialNotFoundError(
        "NEED_AUTH"
    )
