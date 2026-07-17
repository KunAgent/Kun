#!/usr/bin/env python3
"""
tencent-tab Skills 自动鉴权脚本。

支持两种鉴权模式（由 env_config.json 的 auth 字段决定）：

1. tabauth 模式：
   - Token 从 ~/.config/tof4-auth/tabauth-token 或环境变量 TAB_TOKEN 读取（tab_sk_xxx 格式）
   - MCP URL 从 tabauth.environments[env] 获取
   - 直接使用 Personal Key 鉴权，无需额外登录

2. oauth2 模式：
   - MCP URL 从 oauth2.environments[env] 获取
   - 通过 OAuth2 PAR 流程获取 Bearer Token
   - 首次使用自动打开浏览器授权，后续自动使用缓存 Token

用法:
    python3 auth_setup.py              # 自动获取/刷新 Token 并输出
    python3 auth_setup.py --check      # 仅检查 Token 是否有效，不发起授权
    python3 auth_setup.py --force      # 强制重新授权（忽略缓存）

配置来源:
    env_config.json    auth（鉴权模式）/ tabauth（tabauth 配置）/ oauth2（OAuth2 配置）
    ~/.config/tof4-auth/tabauth-token   tabauth 模式的 Personal Key Token
    环境变量           TAB_TOKEN（tabauth token）/ TOF4_OAUTH2_BASE（OAuth2 服务地址）/ TOF4_CLIENT_ID（client_id）
"""

import base64
import json
import os
import sys
import time
import hashlib
import secrets
import subprocess
import urllib.parse
from pathlib import Path

import requests
from requests.exceptions import SSLError

# ─────────────────────────────────────────────────────────────────────
# 常量与路径
# ─────────────────────────────────────────────────────────────────────

TOKEN_CACHE_PATH = Path.home() / ".config" / "tof4-auth" / "tokens.json"
TABAUTH_TOKEN_PATH = Path.home() / ".config" / "tof4-auth" / "tabauth-token"
POLL_INTERVAL_SEC = 3
POLL_MAX_ATTEMPTS = 100  # 5 分钟


def log(msg):
    print(f"[auth_setup] {msg}", file=sys.stderr)


def log_error(msg):
    print(f"[auth_setup] error: {msg}", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────
# 配置读取（从 env_config.json）
# ─────────────────────────────────────────────────────────────────────

SKILLS_DIR = Path(__file__).resolve().parent
ENV_CONFIG_PATH = SKILLS_DIR / "env_config.json"


def load_env_config() -> dict:
    """读取 env_config.json，返回配置字典。"""
    if ENV_CONFIG_PATH.exists():
        try:
            return json.loads(ENV_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def get_oauth2_config(config: dict = None) -> dict:
    """从 env_config.json 读取 OAuth2 相关配置。"""
    if config is None:
        config = load_env_config()
    oauth2 = config.get("oauth2", {})
    return {
        "oauth2_base": oauth2.get("base_url") or os.environ.get("TOF4_OAUTH2_BASE") or "",
        "client_id": oauth2.get("client_id") or os.environ.get("TOF4_CLIENT_ID") or "",
        "resource": oauth2.get("resource", ""),
    }


def load_tabauth_token() -> str:
    """读取 tabauth token（优先环境变量，其次 ~/.config/tof4-auth/tabauth-token 文件）。

    不从 env_config.json 读取 token，避免敏感凭证存入被 git 追踪的项目文件。
    """
    # 1. 环境变量优先
    token = os.environ.get("TAB_TOKEN", "").strip()
    if token:
        return token
    # 2. 文件读取
    if TABAUTH_TOKEN_PATH.exists():
        try:
            token = TABAUTH_TOKEN_PATH.read_text(encoding="utf-8").strip()
            if token:
                return token
        except Exception:
            pass
    return ""


def save_tabauth_token(token: str) -> None:
    """将 tabauth token 保存到 ~/.config/tof4-auth/tabauth-token。"""
    TABAUTH_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TABAUTH_TOKEN_PATH.write_text(token.strip() + "\n", encoding="utf-8")
    log(f"Token 已保存到 {TABAUTH_TOKEN_PATH}")


def get_mcp_url(config: dict = None, check_only: bool = False) -> str:
    """根据 auth 模式和 env 获取当前环境的 MCP URL。

    - auth=tabauth 时，从 tabauth.environments[env] 取 URL
    - auth=oauth2 时，从 oauth2.environments[env] 取 URL
    - check_only=True 时，env 未配置返回空串（不 exit，--check 为只读探测）
    - check_only=False 时，env 为空或无效则提示用户并退出
    """
    if config is None:
        config = load_env_config()
    env = config.get("env", "")
    auth_mode = config.get("auth", "oauth2")

    # 根据鉴权模式选择对应的 environments
    mode_config = config.get(auth_mode, {})
    environments = mode_config.get("environments", {})

    # env 为空或不在 environments 的 key 中
    if not env or env not in environments:
        if check_only:
            # --check 模式为只读探测，不强制退出，返回空串由调用方处理
            return ""
        valid_keys = list(environments.keys())
        log_error(
            f"[ACTION_REQUIRED] 未配置运行环境\n"
            f"当前鉴权模式: {auth_mode}\n"
            f"可选环境: {valid_keys}\n"
            f"请告知用户：需要选择一个环境才能继续，可选项为上方列表，"
            f"选择后将写入 env_config.json 的 env 字段。"
        )
        sys.exit(1)

    url = environments[env]
    return url


# ─────────────────────────────────────────────────────────────────────
# PKCE 生成
# ─────────────────────────────────────────────────────────────────────

def generate_pkce() -> tuple:
    """生成 PKCE code_verifier 和 code_challenge。"""
    verifier = secrets.token_urlsafe(32)
    challenge = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(challenge).rstrip(b"=").decode("ascii")
    return verifier, challenge


# ─────────────────────────────────────────────────────────────────────
# Token 缓存
# ─────────────────────────────────────────────────────────────────────

def _make_cache_key(client_id: str, resource: str) -> str:
    return f"{client_id}::{resource}"


def _read_cache() -> dict:
    try:
        if TOKEN_CACHE_PATH.exists():
            return json.loads(TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"entries": []}


def _write_cache(data: dict) -> None:
    TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_token(client_id: str, resource: str):
    """从磁盘加载 token，返回 entry 或 None。

    返回规则：
    - 未过期：直接返回 entry
    - 已过期且有 refresh_token：返回 entry（由调用方负责刷新）
    - 已过期且无 refresh_token：返回 None（需重新授权）
    - expires_at 缺失视为已过期
    """
    key = _make_cache_key(client_id, resource)
    cache = _read_cache()
    for entry in cache.get("entries", []):
        if _make_cache_key(entry.get("client_id", ""), entry.get("resource", "")) == key:
            expires_at = entry.get("expires_at")
            is_expired = (expires_at is None) or (expires_at - time.time() * 1000 <= 0)
            if is_expired and not entry.get("refresh_token"):
                return None
            return entry
    return None


def save_token(client_id: str, resource: str, token_data: dict) -> None:
    """保存 token 到磁盘缓存。"""
    key = _make_cache_key(client_id, resource)
    cache = _read_cache()
    entries = cache.get("entries", [])
    new_entry = {
        "client_id": client_id,
        "resource": resource,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": int(time.time() * 1000 + token_data.get("expires_in", 3600) * 1000),
    }
    updated = False
    for i, entry in enumerate(entries):
        if _make_cache_key(entry.get("client_id", ""), entry.get("resource", "")) == key:
            entries[i] = new_entry
            updated = True
            break
    if not updated:
        entries.append(new_entry)
    _write_cache({"entries": entries})


# ─────────────────────────────────────────────────────────────────────
# HTTP 请求工具
# ─────────────────────────────────────────────────────────────────────

def http_post(url: str, data: bytes = None, headers: dict = None) -> dict:
    """发送 POST 请求并返回 JSON 响应。没找到证书时自动禁用 SSL 验证重试。"""
    kwargs = dict(data=data, headers=headers or {}, timeout=30)
    try:
        resp = requests.post(url, **kwargs)
        resp.raise_for_status()
        return resp.json()
    except SSLError:
        log("SSL 证书验证失败，禁用 SSL 验证后重试...")
        resp = requests.post(url, verify=False, **kwargs)
        resp.raise_for_status()
        return resp.json()
    except requests.HTTPError as e:
        resp = e.response
        try:
            err = resp.json()
        except Exception:
            err = {}
        body = resp.text
        raise Exception(f"HTTP {resp.status_code}: {err.get('error_description', err.get('error', body))}")


def http_get_json(url: str) -> dict:
    """发送 GET 请求并返回 JSON 响应。没找到证书时自动禁用 SSL 验证重试。"""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except SSLError:
        log("SSL 证书验证失败，禁用 SSL 验证后重试...")
        resp = requests.get(url, timeout=30, verify=False)
        resp.raise_for_status()
        return resp.json()
    except requests.HTTPError as e:
        resp = e.response
        if resp.status_code == 404:
            raise Exception("授权请求已过期或无效（request_uri not found），请重新发起授权")
        raise Exception(f"HTTP {resp.status_code}: {resp.reason}")


# ─────────────────────────────────────────────────────────────────────
# OAuth2 PAR 流程
# ─────────────────────────────────────────────────────────────────────

def post_par(oauth2_base: str, client_id: str, resource: str, code_challenge: str, state: str) -> dict:
    """步骤 1: POST /oauth2/par，推送授权参数。"""
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "resource": resource,
    })
    return http_post(
        f"{oauth2_base}/oauth2/par",
        data=params.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def poll_for_code(oauth2_base: str, client_id: str, request_uri: str) -> dict:
    """步骤 3: 轮询 GET /oauth2/par/poll，等待用户完成授权。"""
    log(f"等待授权中... (超时: {POLL_INTERVAL_SEC * POLL_MAX_ATTEMPTS // 60} 分钟)")
    for attempt in range(POLL_MAX_ATTEMPTS):
        time.sleep(POLL_INTERVAL_SEC)
        poll_url = (
            f"{oauth2_base}/oauth2/par/poll"
            f"?request_uri={urllib.parse.quote(request_uri)}"
            f"&client_id={urllib.parse.quote(client_id)}"
        )
        try:
            data = http_get_json(poll_url)
        except Exception as e:
            if "过期" in str(e):
                raise
            continue

        status = data.get("status")
        if status == "completed":
            code = data.get("code")
            if not code:
                raise Exception("授权完成但未返回 code")
            return {"code": code, "redirect_uri": data.get("redirect_uri", "")}
        if status == "error":
            raise Exception(f"授权失败: {data.get('error_description', data.get('error', '未知错误'))}")

    raise Exception(f"授权超时（超过 {POLL_INTERVAL_SEC * POLL_MAX_ATTEMPTS // 60} 分钟）")


def exchange_code_for_token(oauth2_base: str, client_id: str, code: str,
                            redirect_uri: str, code_verifier: str) -> dict:
    """步骤 4: POST /oauth2/token，用 code 换取 access_token。"""
    params = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    })
    return http_post(
        f"{oauth2_base}/oauth2/token",
        data=params.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def refresh_access_token(oauth2_base: str, client_id: str, refresh_token: str) -> dict:
    """用 refresh_token 刷新 access_token。"""
    params = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    })
    return http_post(
        f"{oauth2_base}/oauth2/token",
        data=params.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


# ─────────────────────────────────────────────────────────────────────
# 浏览器打开
# ─────────────────────────────────────────────────────────────────────

def try_open_browser(url: str) -> None:
    """尝试自动打开浏览器。"""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif sys.platform == "win32":
            subprocess.Popen(["cmd", "/c", "start", "", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log("正在自动打开浏览器...")
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
# Personal Key 鉴权
# ─────────────────────────────────────────────────────────────────────

TABAUTH_GET_KEY_URL = "https://api-pre.tab.woa.com/trpc.tab.auth_center.AuthCenter/GetOrCreatePersonalKey"
SSO_LOGIN_DOMAIN = "std.passport.woa.com"
SSO_LOGIN_TIMEOUT_SEC = 300
SSO_ENTRY_URL = "https://tab.woa.com"


# ── SSO Playwright 登录 ──

def _sso_login_with_playwright() -> dict:
    """使用 Playwright 完成 SSO 登录后返回 cookies。

    流程：
      1. 访问 SSO_ENTRY_URL（tab.woa.com），确保经过完整的 SSO 重定向链
      2. 若未被重定向到 SSO 域，说明已登录，直接提取 cookies 返回
      3. 检测到 SSO 页：
         【第一阶段】尝试自动点击 [快速登录]（尽力而为，失败不中断）
         【第二阶段】统一等待 URL 跳出 SSO 域（自动或手动操作均可触发）
      4. 成功跳出后提取 cookies；超时返回 {ok: False}

    Returns:
        {"ok": True, "cookies": "cookie_string"} 或 {"ok": False}
    """
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        log("playwright 未安装，尝试安装: pip3 install playwright && python3 -m playwright install chromium")
        return {"ok": False}

    log("正在通过 Playwright 完成 SSO 登录...")

    with sync_playwright() as p:
        user_data_dir = str(Path.home() / ".config" / "tof4-auth" / "pw-profile")
        Path(user_data_dir).mkdir(parents=True, exist_ok=True)

        browser_context = None
        try:
            browser_context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
                ignore_https_errors=True,
            )

            page = browser_context.new_page()

            # 访问 tab.woa.com 触发 SSO 重定向链（而非直接访问 API 地址）
            log(f"正在访问: {SSO_ENTRY_URL}")
            page.goto(SSO_ENTRY_URL, wait_until="domcontentloaded", timeout=30000)

            current_url = page.url
            if SSO_LOGIN_DOMAIN not in current_url:
                # 未被重定向到 SSO 页，说明已登录
                log("无需 SSO 登录（未被重定向到 SSO 页面）")
                cookies = _extract_sso_cookies(browser_context)
                browser_context.close()
                return {"ok": True, "cookies": cookies}

            # ── 第一阶段：尝试自动点击 [快速登录]（尽力而为）──
            log("检测到 SSO 登录页，尝试自动点击 [快速登录]...")
            try:
                # 等待页面渲染稳定，超时后仍继续（不阻断后续流程）
                page.wait_for_load_state("domcontentloaded", timeout=5000)
                clicked = False
                for selector in [
                    "text=快速登录",
                    "button:has-text('快速登录')",
                    "a:has-text('快速登录')",
                ]:
                    try:
                        el = page.locator(selector).first
                        if el.is_visible(timeout=2000):
                            el.click(timeout=5000)
                            log("已点击 [快速登录]")
                            clicked = True
                            break
                    except Exception:
                        continue
                if not clicked:
                    log("未找到 [快速登录] 按钮，请在浏览器中手动完成登录")
            except Exception as e:
                log(f"自动点击出错: {e}，请在浏览器中手动完成登录")

            # ── 第二阶段：统一等待 URL 跳出 SSO 域（自动跳转或手动操作均可触发）──
            log(f"等待 SSO 认证完成... (超时: {SSO_LOGIN_TIMEOUT_SEC} 秒，可在浏览器中手动操作)")
            try:
                page.wait_for_url(
                    lambda url: SSO_LOGIN_DOMAIN not in url,
                    timeout=SSO_LOGIN_TIMEOUT_SEC * 1000,
                )
                log("SSO 认证完成")
                cookies = _extract_sso_cookies(browser_context)
                browser_context.close()
                return {"ok": True, "cookies": cookies}
            except PWTimeout:
                log_error(f"SSO 登录超时（{SSO_LOGIN_TIMEOUT_SEC} 秒）")
                browser_context.close()
                return {"ok": False}

        except Exception as e:
            log_error(f"Playwright SSO 登录失败: {e}")
            if browser_context:
                try:
                    browser_context.close()
                except Exception:
                    pass
            return {"ok": False}


def _extract_sso_cookies(browser_context) -> str:
    """从 Playwright context 提取 .woa.com 域下的 cookies，格式化为 Cookie header 字符串。"""
    all_cookies = browser_context.cookies()
    relevant = []
    for c in all_cookies:
        domain = c.get("domain", "").lstrip(".")
        # 提取所有 woa.com 及其子域名下的 cookies
        if domain and (domain == "woa.com" or domain.endswith(".woa.com")):
            relevant.append(f"{c['name']}={c['value']}")

    cookie_str = "; ".join(relevant)
    if cookie_str:
        log(f"已提取 {len(relevant)} 个 SSO cookies")
    return cookie_str


def _sso_login_fallback(target_url: str) -> dict:
    """回退方案：打开系统浏览器让用户手动完成 SSO 登录。

    注意：由于此方案无法从无状态 HTTP 探测中获取到 SSO session cookie，
    浏览器中完成的登录状态无法被本进程捕获。因此 fallback 只能打开浏览器
    引导用户完成登录，但无法自动提取 cookies，需用户手动配置 token。
    返回 {"ok": False} 以触发调用方给出手动配置指引。
    """
    log("正在打开浏览器，请在浏览器中完成 SSO 登录...")
    try_open_browser(target_url)

    # Playwright 不可用时本进程无法捕获浏览器的 session cookies，
    # 无需等待——直接给出手动配置指引后返回失败。
    log_error(
        "Playwright 不可用时无法自动获取 token，请手动配置：\n"
        f"  安装 Playwright: pip3 install playwright && python3 -m playwright install chromium\n"
        f"  或手动写入 token: echo '你的token' > {TABAUTH_TOKEN_PATH}"
    )
    return {"ok": False}


# ── GetOrCreatePersonalKey 接口调用 ──

_TABAUTH_API_HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "origin": "https://tab.woa.com",
    "referer": "https://tab.woa.com/",
    "x-tab-language": "zh",
    "x-tab-rpc-servicename": "trpc.TAB.auth_center.AuthCenterHTTP",
}


def _call_get_or_create_personal_key(headers: dict) -> dict:
    """实际调用 GetOrCreatePersonalKey 接口，返回解析后的 JSON dict。

    Raises:
        Exception: 接口调用失败、返回非 JSON、或 HTTP 错误
    """
    merged = dict(_TABAUTH_API_HEADERS)
    merged.update(headers)  # 调用方传入的 headers（如 Cookie）优先级更高

    def _do_post(verify=True):
        resp = requests.post(
            TABAUTH_GET_KEY_URL,
            json={},
            headers=merged,
            timeout=30,
            allow_redirects=False,
            verify=verify,
        )
        return resp

    try:
        resp = _do_post()
    except SSLError:
        log("SSL 证书验证失败，禁用 SSL 验证后重试...")
        resp = _do_post(verify=False)

    # 收到重定向 → SSO 仍未通过
    if resp.status_code in (301, 302, 303, 307, 308):
        location = resp.headers.get("location", "")
        raise Exception(f"接口返回重定向（{resp.status_code}），SSO 登录可能未生效，location: {location}")

    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        try:
            err = resp.json()
        except Exception:
            err = {}
        raise Exception(
            f"GetOrCreatePersonalKey 接口错误 HTTP {resp.status_code}: "
            f"{err.get('message', err.get('error', resp.text))}"
        )

    try:
        return resp.json()
    except Exception:
        raise Exception(
            f"GetOrCreatePersonalKey 接口返回非 JSON 内容 (status={resp.status_code}): {resp.text[:200]}"
        )


def fetch_tabauth_token_from_api(config: dict) -> str:
    """通过 GetOrCreatePersonalKey 接口自动获取 tabauth token。

    由于只有本地无 token 时才会调用此函数（后续均复用本地 token），
    直接通过 Playwright 完成 SSO 登录拿到 cookies，再携带 cookies 一次请求接口取 token，
    无需试探性请求。

    Returns:
        str: 获取到的 token（tab_sk_xxx 格式）

    Raises:
        Exception: 接口调用失败或响应中无 token
    """
    headers = {"Content-Type": "application/json"}

    log("本地未找到 tabauth token，正在通过 SSO 登录后获取...")

    # 先访问 tab.woa.com 建立 SSO session，再携带 cookies 调 API
    sso_result = _sso_login_with_playwright()
    if not sso_result.get("ok"):
        sso_result = _sso_login_fallback(SSO_ENTRY_URL)

    if not sso_result.get("ok"):
        raise Exception("SSO 登录失败，无法获取 tabauth token")

    sso_cookies = sso_result.get("cookies", "")
    if sso_cookies:
        headers["Cookie"] = sso_cookies

    data = _call_get_or_create_personal_key(headers)

    # token.secret_key 是明文，顶层 secret_key 可能被网关脱敏，优先取 token.secret_key
    token = data.get("token", {}).get("secret_key", "") or data.get("secret_key", "")
    if not token:
        raise Exception(
            f"GetOrCreatePersonalKey 接口返回数据中未找到 secret_key 字段，响应: {data}"
        )
    return token


def personal_key_auth(token: str, config: dict) -> str:
    """Personal Key 模式鉴权：校验 token，本地无 token 时自动通过接口获取并保存。

    Args:
        token:   已从本地读取的 tabauth token（可能为空字符串）
        config:  完整的 env_config，用于接口获取 token 时读取附加配置

    Returns:
        str: 有效的 tabauth token
    """
    if not token:
        # 本地无 token，尝试通过接口自动获取
        try:
            token = fetch_tabauth_token_from_api(config)
            save_tabauth_token(token)
            log("Personal Key 获取并保存成功")
        except Exception as e:
            log_error(
                f"[ACTION_REQUIRED] tabauth 模式未找到 token，且自动获取失败: {e}\n"
                f"请通过以下任一方式手动提供 token（tab_sk_xxx 格式）：\n"
                f"  1. 设置环境变量: export TAB_TOKEN='你的token'\n"
                f"  2. 写入文件: echo '你的token' > {TABAUTH_TOKEN_PATH}\n"
            )
            sys.exit(1)

    log("Personal Key 鉴权就绪")
    return token


# ─────────────────────────────────────────────────────────────────────
# OAuth2 核心流程
# ─────────────────────────────────────────────────────────────────────

def get_valid_token(oauth2_base: str, client_id: str, resource: str):
    """获取有效 token：优先缓存，必要时自动刷新。返回 access_token 或 None。"""
    cached = load_token(client_id, resource)
    if cached:
        remaining_sec = (cached.get("expires_at", 0) - time.time() * 1000) / 1000
        if remaining_sec > 60:
            return cached["access_token"]
        if cached.get("refresh_token"):
            try:
                log("Token 即将过期，正在刷新...")
                token_data = refresh_access_token(oauth2_base, client_id, cached["refresh_token"])
                save_token(client_id, resource, token_data)
                log("Token 刷新成功")
                return token_data["access_token"]
            except Exception as e:
                log(f"Token 刷新失败 ({e})，需要重新授权")
    return None


def initiate_par_flow(oauth2_base: str, client_id: str, resource: str) -> str:
    """完整的 PAR 授权流程 → 返回 access_token。"""
    verifier, challenge = generate_pkce()
    state = secrets.token_hex(8)

    # 1. PAR 请求
    par_result = post_par(oauth2_base, client_id, resource, challenge, state)
    request_uri = par_result["request_uri"]

    # 2. 构建授权 URL 并打开浏览器
    auth_url = (
        f"{oauth2_base}/oauth2/authorize"
        f"?client_id={urllib.parse.quote(client_id)}"
        f"&request_uri={urllib.parse.quote(request_uri)}"
    )
    print(f"[auth_setup] 请在浏览器中完成授权: {auth_url}", file=sys.stderr)
    try_open_browser(auth_url)

    # 3. 轮询等待授权
    result = poll_for_code(oauth2_base, client_id, request_uri)

    # 4. 换取 token
    token_data = exchange_code_for_token(
        oauth2_base, client_id, result["code"], result["redirect_uri"], verifier
    )

    # 5. 缓存
    save_token(client_id, resource, token_data)
    log(f"授权成功，Token 已缓存到 {TOKEN_CACHE_PATH}")
    return token_data["access_token"]


# ─────────────────────────────────────────────────────────────────────
# mcporter 配置同步
# ─────────────────────────────────────────────────────────────────────

MCPORTER_CONFIG_PATH = Path.home() / ".mcporter" / "mcporter.json"


def sync_mcporter_config(mcp_url: str, auth_mode: str, token: str) -> None:
    """将鉴权结果同步到 ~/.mcporter/mcporter.json，确保 mcporter CLI 使用正确配置。

    mcporter 默认从 ~/.mcporter/mcporter.json 读取 MCP server 配置，
    如果该文件中的地址/Token 与 auth_setup.py 计算出的不一致，会导致调用错误的 MCP 服务。
    此函数在每次鉴权成功后自动覆盖写入，保证两端配置始终一致。
    """
    if not mcp_url or not token:
        return

    # 构造鉴权 header
    if auth_mode == "tabauth":
        headers = {"X-Token": token}
    else:
        # oauth2 模式：Bearer token
        bearer = token if token.startswith("Bearer ") else f"Bearer {token}"
        headers = {"Authorization": bearer}

    mcporter_config = {
        "mcpServers": {
            "tab": {
                "baseUrl": mcp_url,
                "headers": headers,
            }
        },
        "imports": [],
    }

    try:
        MCPORTER_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MCPORTER_CONFIG_PATH.write_text(
            json.dumps(mcporter_config, indent=2) + "\n", encoding="utf-8"
        )
        log(f"mcporter 配置已同步到 {MCPORTER_CONFIG_PATH}")
    except Exception as e:
        log(f"同步 mcporter 配置失败: {e}（不影响鉴权结果，但 mcporter CLI 可能使用旧配置）")


# ─────────────────────────────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────────────────────────────

def main():
    args = set(sys.argv[1:])
    check_only = "--check" in args
    force_reauth = "--force" in args

    # 一次性加载配置，避免重复读取文件
    config = load_env_config()
    auth_mode = config.get("auth", "oauth2")

    if auth_mode == "tabauth":
        # ── TabAuth (Personal Key) 模式 ──
        header = "X-Token"

        if check_only:
            # --check 为只读探测：先检查 token，再获取 url（env 未配置时返回空串不 exit）
            token = load_tabauth_token()
            mcp_url = get_mcp_url(config, check_only=True)
            valid = bool(token)
            result = {"valid": valid, "mode": "tabauth"}
            if valid:
                result.update({
                    "token": token,
                    "header": header,
                    "mcp_url": mcp_url,
                })
            print(json.dumps(result))
            return

        # --force：清除本地缓存的 tabauth token，强制重新获取
        if force_reauth:
            if TABAUTH_TOKEN_PATH.exists():
                try:
                    TABAUTH_TOKEN_PATH.unlink()
                    log("已清除本地 tabauth token 缓存，将重新获取...")
                except Exception as e:
                    log(f"清除 token 缓存失败: {e}")

        mcp_url = get_mcp_url(config)
        # tabauth 模式下从 ~/.config/tof4-auth/tabauth-token 或环境变量读取 token
        token = load_tabauth_token()

        token = personal_key_auth(token, config)
        sync_mcporter_config(mcp_url, auth_mode, token)
        print(json.dumps({
            "mode": "tabauth",
            "token": token,
            "header": header,
            "mcp_url": mcp_url,
        }))

    else:
        # ── OAuth2 模式 ──
        oauth2_cfg = get_oauth2_config(config)
        oauth2_base = oauth2_cfg["oauth2_base"]
        client_id = oauth2_cfg["client_id"]
        mcp_url = get_mcp_url(config, check_only=check_only)
        resource = oauth2_cfg["resource"] or mcp_url

        if check_only:
            token = get_valid_token(oauth2_base, client_id, resource)
            if token:
                # valid 时附带完整鉴权信息，供子技能 setup.sh 直接复用
                print(json.dumps({
                    "valid": True,
                    "mode": "oauth2",
                    "token": token,
                    "header": "Authorization",
                    "mcp_url": mcp_url,
                }))
            else:
                print(json.dumps({"valid": False, "mode": "oauth2"}))
            return

        if force_reauth:
            token = None
        else:
            token = get_valid_token(oauth2_base, client_id, resource)

        if not token:
            token = initiate_par_flow(oauth2_base, client_id, resource)

        # 同步 mcporter 配置 & 输出 JSON 格式
        sync_mcporter_config(mcp_url, auth_mode, token)
        print(json.dumps({
            "mode": "oauth2",
            "token": token,
            "header": "Authorization",
            "mcp_url": mcp_url,
        }))


if __name__ == "__main__":
    main()
