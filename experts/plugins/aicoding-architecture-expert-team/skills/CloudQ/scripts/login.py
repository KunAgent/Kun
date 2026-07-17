#!/usr/bin/env python3
"""
CloudQ OAuth 登录脚本 (Authorization Code 模式)

提供三个非交互式子命令，供 AI Agent 分步调用：

    python3 login.py --authorize-url              # 步骤1：获取授权 URL（JSON 输出）
    python3 login.py --save '<授权码>'             # 步骤2：用授权码换取凭证并保存（JSON 输出）
    python3 login.py --status                      # 查看当前凭证状态（JSON 输出）

交互式登录（仅供用户终端手动使用，Skill 中禁止调用）：
    python3 login.py                               # 打开浏览器 + 交互式粘贴授权码
    python3 login.py --no-browser                  # 手动模式（仅输出链接）
    python3 login.py --site=intl                   # 国际站
"""

import base64
import json
import os
import sys
import time
import webbrowser
from pathlib import Path

# 将 scripts 目录加入搜索路径
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from credential_manager import (  # noqa: E402
    get_authorize_url, exchange_token, get_tmp_cred,
    save_credential, load_credential, OAUTH_ENDPOINT,
    CREDENTIAL_FILE,
)


# ============== JSON 输出工具 ==============

def _json_ok(data: dict) -> str:
    return json.dumps({"success": True, **data}, ensure_ascii=False)


def _json_err(code: str, message: str) -> str:
    return json.dumps({"success": False, "error": {"code": code, "message": message}},
                      ensure_ascii=False)


# ============== 解析用户输入的授权码 ==============

def _parse_code(user_input: str) -> str:
    """解析用户粘贴的内容，可能是纯 code、Base64 或 JSON"""
    code = user_input
    try:
        decoded = base64.b64decode(user_input).decode("utf-8")
        parsed = json.loads(decoded)
        code = parsed.get("code", user_input)
    except Exception:
        try:
            parsed = json.loads(user_input)
            code = parsed.get("code", user_input)
        except Exception:
            pass  # 当做纯 code 字符串
    return code


def _mask(s: str, visible: int = 4) -> str:
    if len(s) <= visible:
        return "*" * len(s)
    return "*" * (len(s) - visible) + s[-visible:]


# ============== 子命令：--authorize-url ==============

def cmd_authorize_url(site: str = "cn") -> int:
    """获取授权 URL（非交互式，JSON 输出）"""
    try:
        auth_info = get_authorize_url("", site)
        authorize_url = auth_info.get("authorize_url", "")
        if not authorize_url:
            print(_json_err("NoAuthorizeUrl", "服务端未返回有效的授权 URL"))
            return 1
        print(_json_ok({
            "authorize_url": authorize_url,
            "state": auth_info.get("state", ""),
        }))
        return 0
    except Exception as e:
        print(_json_err("AuthorizeUrlError", str(e)))
        return 1


# ============== 子命令：--save ==============

def cmd_save(raw_code: str, site: str = "cn") -> int:
    """用授权码换取凭证并保存（非交互式，JSON 输出）"""
    code = _parse_code(raw_code.strip())
    if not code:
        print(_json_err("EmptyCode", "授权码为空"))
        return 1

    try:
        # exchange_token
        token_info = exchange_token(code)
        access_token = token_info["user_access_token"]

        # get_tmp_cred
        cred = get_tmp_cred(access_token, site)

        # 保存凭证
        oauth_info = {
            "accessToken": token_info["user_access_token"],
            "refreshToken": token_info["refresh_token"],
            "userOpenId": token_info.get("user_open_id", ""),
            "expiresAt": token_info.get("expires_at", 0),
            "site": site,
        }
        save_credential(cred, oauth_info)

        print(_json_ok({
            "message": "登录成功",
            "credential_file": str(CREDENTIAL_FILE),
            "secret_id_masked": _mask(cred.get("secretId", "")),
            "expires_at": cred.get("expiresAt", 0),
        }))
        return 0

    except Exception as e:
        print(_json_err("LoginFailed", str(e)))
        return 1


# ============== 子命令：--status ==============

def cmd_status() -> int:
    """查看当前凭证状态（非交互式，JSON 输出）"""
    cred_data = load_credential()
    if cred_data is None:
        print(_json_ok({
            "logged_in": False,
            "message": "未找到 OAuth 凭证",
        }))
        return 0

    now = time.time()
    expires_at = cred_data.get("expiresAt", 0)
    remaining = max(0, int(expires_at - now))

    oauth = cred_data.get("oauth", {})
    access_expires = oauth.get("expiresAt", 0)
    access_remaining = max(0, int(access_expires - now))

    print(_json_ok({
        "logged_in": True,
        "credential_file": str(CREDENTIAL_FILE),
        "secret_id_masked": _mask(cred_data.get("secretId", "")),
        "tmp_key_expires_at": expires_at,
        "tmp_key_remaining_minutes": remaining // 60,
        "access_token_remaining_minutes": access_remaining // 60,
    }))
    return 0


# ============== 交互式登录（仅供终端手动使用） ==============

def _interactive_login(open_browser: bool = True, site: str = "cn"):
    """交互式登录流程（Skill 中禁止调用，仅供用户终端手动使用）"""
    print()
    print("  🦞 CloudQ OAuth 登录")
    print("  " + "─" * 36)
    print()

    # 检查是否已登录
    existing = load_credential()
    if existing:
        print("  ℹ️  检测到已有 OAuth 凭证。")
        try:
            answer = input("  是否重新登录？(y/N) > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if answer not in ("y", "yes"):
            print("  已取消。")
            return
        print()

    try:
        # 获取授权 URL
        print("  ◦ 获取授权链接...")
        auth_info = get_authorize_url("", site)
        authorize_url = auth_info["authorize_url"]
        if not authorize_url:
            raise RuntimeError("服务端未返回有效的授权 URL")

        # 打开浏览器或输出链接
        if open_browser:
            print("  ◦ 正在打开浏览器...")
            if not webbrowser.open(authorize_url):
                print("  ⚠️  无法自动打开浏览器，请手动访问以下链接：")
                print()
                print(f"  {authorize_url}")
        else:
            print()
            print("  请在浏览器中打开以下链接完成授权：")
            print()
            print(f"  {authorize_url}")

        # 等待用户输入授权码
        print()
        print("  完成授权后，页面会显示一段授权码。")
        print("  请复制并粘贴到下方：")
        print()
        user_input = input("  授权码 > ").strip()
        if not user_input:
            raise RuntimeError("未输入授权码")

        code = _parse_code(user_input)

        # exchange_token + get_tmp_cred + 保存
        print()
        print("  ◦ 用授权码换取 token...")
        token_info = exchange_token(code)

        print("  ◦ 获取临时密钥...")
        access_token = token_info["user_access_token"]
        cred = get_tmp_cred(access_token, site)

        oauth_info = {
            "accessToken": token_info["user_access_token"],
            "refreshToken": token_info["refresh_token"],
            "userOpenId": token_info.get("user_open_id", ""),
            "expiresAt": token_info.get("expires_at", 0),
            "site": site,
        }
        save_credential(cred, oauth_info)

        print()
        print("  ✅ 登录成功！")
        print()
        print("  凭证已保存到 ~/.tencent-cloudq/credential.json")
        print("  临时密钥将在过期前自动刷新，您无需重复登录。")
        print()

    except KeyboardInterrupt:
        print("\n  已取消登录。")
    except Exception as e:
        print()
        print(f"  ❌ 登录失败：{e}")
        print()
        sys.exit(1)


# ============== CLI 入口 ==============

def main():
    args = sys.argv[1:]
    site = "cn"

    # 解析 --site 参数
    for arg in args:
        if arg.startswith("--site="):
            site = arg.split("=", 1)[1]

    # 子命令路由（非交互式，供 Agent 调用）
    if "--authorize-url" in args:
        sys.exit(cmd_authorize_url(site))

    if "--save" in args:
        idx = args.index("--save")
        if idx + 1 >= len(args):
            print(_json_err("MissingCode", "缺少授权码参数: python3 login.py --save '<授权码>'"))
            sys.exit(1)
        sys.exit(cmd_save(args[idx + 1], site))

    if "--status" in args:
        sys.exit(cmd_status())

    if "--help" in args or "-h" in args:
        print("CloudQ OAuth 登录")
        print()
        print("非交互式子命令（供 Agent 调用）：")
        print("  python3 login.py --authorize-url              # 获取授权 URL")
        print("  python3 login.py --save '<授权码>'             # 用授权码换取凭证")
        print("  python3 login.py --status                      # 查看凭证状态")
        print()
        print("交互式登录（仅供终端手动使用）：")
        print("  python3 login.py                               # 打开浏览器授权")
        print("  python3 login.py --no-browser                  # 手动模式")
        print("  python3 login.py --site=intl                   # 国际站")
        print()
        return

    # 默认：交互式登录（终端手动使用）
    open_browser = "--no-browser" not in args and "--manual" not in args
    _interactive_login(open_browser=open_browser, site=site)


if __name__ == "__main__":
    main()
