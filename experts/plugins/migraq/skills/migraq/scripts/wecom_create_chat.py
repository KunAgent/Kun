#!/usr/bin/env python3
"""
wecom_create_chat.py - 拉企微内网客服群并自动激活

流程：
  Step 1: 通过 tai-auth.sh 获取太湖 TOF token（与 migraq_chat.py 共享同一鉴权链路）
          POST https://migraq-chat-test.mcp.it.woa.com/proxy/internal/auth/tof/token

  Step 2: 通过 tai-auth.sh 调用拉群接口（自动携带 Bearer，额外传 X-Internal-Token）
          POST https://migraq-chat-test.mcp.it.woa.com/proxy/internal/wecom_app/create_chat
          Header: X-Internal-Token: <token>
          Body:   {"name": "<群名>"}

输出：
  统一 JSON（stdout），供 agent 取 data.chat_id 后续使用。

Usage:
  python3 wecom_create_chat.py --name "项目X 迁移支持群"
  python3 wecom_create_chat.py --name "项目X 迁移支持群" --use-token <token>

依赖：
  - tai-auth.sh（macOS/Linux）/ tai-auth.ps1（Windows），同目录
  - python3 标准库（subprocess / json / argparse）
"""

import argparse
import json
import os
import subprocess
import sys

# ===== 配置 =====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

IS_WINDOWS = sys.platform == "win32"
if IS_WINDOWS:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.ps1")
    TAI_AUTH_CMD = ["powershell", "-ExecutionPolicy", "Bypass", "-File", TAI_AUTH_SCRIPT]
else:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.sh")
    TAI_AUTH_CMD = [TAI_AUTH_SCRIPT]

# TOF token 网关地址（与 migraq_chat.py / cos_upload.py 一致）
TOF_TOKEN_URL = os.environ.get(
    "MIGRAQ_TOF_TOKEN_URL",
    "https://migraq-chat.mcp.it.woa.com/proxy/internal/auth/tof/token",
)

# 拉群接口地址
DEFAULT_CREATE_CHAT_URL = os.environ.get(
    "MIGRAQ_CREATE_CHAT_URL",
    "https://migraq-chat.mcp.it.woa.com/proxy/internal/wecom_app/create_chat",
)

# 群名长度上限（汉字按 1 计）
MAX_NAME_RUNES = 32


# ===== 日志（输出到 stderr，不干扰 stdout 的结构化输出）=====
def log(msg):
    print(f"[wecom-chat] {msg}", file=sys.stderr)


def log_error(msg):
    print(f"[wecom-chat] \u2717 {msg}", file=sys.stderr)


def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def _fail(code, message, request_id=""):
    _print_json({
        "success": False,
        "action": "WecomCreateChat",
        "error": {"code": code, "message": message},
        "requestId": request_id,
    })
    sys.exit(1)


def _ensure_tai_auth():
    """检查 tai-auth 脚本存在且可执行"""
    if not os.path.isfile(TAI_AUTH_SCRIPT):
        script_name = "tai-auth.ps1" if IS_WINDOWS else "tai-auth.sh"
        _fail("ConfigError", f"{script_name} not found: {TAI_AUTH_SCRIPT}")
    if not IS_WINDOWS and not os.access(TAI_AUTH_SCRIPT, os.X_OK):
        os.chmod(TAI_AUTH_SCRIPT, 0o755)


# ===== Step 1: 获取 TOF token =====
def get_tof_token():
    log("Step 1: 获取太湖登录态 token...")
    log(f"  URL: {TOF_TOKEN_URL}")

    result = subprocess.run(
        TAI_AUTH_CMD + ["-u", TOF_TOKEN_URL, "-m", "POST", "-b", "{}"],
        capture_output=True,
        text=True,
    )

    resp = result.stdout.strip()
    if not resp:
        msg = "获取 TOF token 返回为空"
        if result.stderr:
            msg += f"；{result.stderr.strip()[:200]}"
        _fail("AuthError", msg)

    try:
        data = json.loads(resp)
        token = data["Response"]["Token"]
    except (json.JSONDecodeError, KeyError):
        _fail("AuthError", f"TOF token 响应解析失败: {resp[:300]}")

    log("Step 1: token 获取成功")
    return token


# ===== Step 2: 调用拉群接口 =====
def create_chat(token, name, create_chat_url):
    log("Step 2: 调用拉群接口...")
    log(f"  URL: {create_chat_url}")
    log(f"  群名: {name}")

    # 通过 tai-auth.sh 发请求：自动携带 Authorization: Bearer（网关 SmartGate 鉴权）
    # 同时通过 -H 传 X-Internal-Token（应用层鉴权，识别触发者 RTX）
    body = json.dumps({"name": name}, ensure_ascii=False)

    result = subprocess.run(
        TAI_AUTH_CMD + [
            "-u", create_chat_url,
            "-m", "POST",
            "-b", body,
            "-H", f"X-Internal-Token: {token}",
        ],
        capture_output=True,
        text=True,
    )

    resp = result.stdout.strip()
    stderr_text = result.stderr.strip()

    if not resp:
        # tai-auth.sh 对 4xx 返回 exit code 1，stdout 可能为空
        # 从 stderr 日志提取 HTTP 状态码
        http_code = _extract_http_code(stderr_text)
        if http_code == "401":
            _fail("AuthError", "拉群鉴权失败: token 可能已过期或不含 login_name")
        elif http_code == "400":
            _fail("HTTPError", "拉群参数错误: 群名为空或超长")
        elif http_code == "404":
            _fail("HTTPError", f"拉群接口路由不存在 (404): {create_chat_url}")
        elif http_code == "502":
            _fail("HTTPError", "企微拉群上游错误 (502)")
        elif http_code == "503":
            _fail("HTTPError", "拉群服务未配置 (503)")
        elif http_code:
            _fail("HTTPError", f"拉群返回 HTTP {http_code}")
        else:
            msg = "拉群接口返回为空"
            if stderr_text:
                msg += f"；{stderr_text[:200]}"
            _fail("NetworkError", msg)

    try:
        data = json.loads(resp)
    except (json.JSONDecodeError, ValueError):
        _fail("HTTPError", f"拉群响应非 JSON: {resp[:300]}")

    # 检查错误响应（网关或后端返回的统一错误体）
    if data.get("error") is True or isinstance(data.get("error"), str):
        err_msg = data.get("message", data.get("error", ""))
        if isinstance(err_msg, str) and "bearer" in err_msg.lower():
            _fail("AuthError", f"网关鉴权失败: {err_msg}")
        _fail("HTTPError", f"拉群失败: {err_msg or resp[:300]}")

    log("Step 2: 拉群成功")
    return data


def _extract_http_code(stderr_text):
    """从 tai-auth.sh 的 stderr 日志提取 HTTP 状态码"""
    for line in stderr_text.split("\n"):
        if "Response:" in line:
            parts = line.split("Response:")
            if len(parts) > 1:
                code_part = parts[1].strip().split()[0]
                if code_part.isdigit():
                    return code_part
    return ""


# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(
        prog="wecom_create_chat.py",
        description="拉企微内网客服群并自动激活",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 wecom_create_chat.py --name "项目X 迁移支持群"
  python3 wecom_create_chat.py --name "项目X 迁移支持群" --use-token <token>
        """,
    )
    parser.add_argument("--name", required=True, help="群名（≤32 字符，汉字按 1 计）")
    parser.add_argument(
        "--use-token",
        default=None,
        metavar="TOKEN",
        help="跳过 Step 1，直接使用指定 token",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_CREATE_CHAT_URL,
        help="拉群接口地址（默认取环境变量或内置值）",
    )

    args = parser.parse_args()

    _ensure_tai_auth()

    # 校验群名长度
    name_runes = len(args.name)
    if name_runes == 0:
        _fail("ConfigError", "群名不能为空")
    if name_runes > MAX_NAME_RUNES:
        _fail("ConfigError", f"群名超长（{name_runes} > {MAX_NAME_RUNES} 字符）")

    # Step 1
    if args.use_token:
        log("跳过 Step 1，使用指定 token")
        internal_token = args.use_token
    else:
        internal_token = get_tof_token()

    # Step 2
    data = create_chat(internal_token, args.name, args.url)

    result = {
        "success": True,
        "action": "WecomCreateChat",
        "data": {
            "chat_id": data.get("ChatId", ""),
            "members": data.get("Members", []),
            "welcome_sent": data.get("WelcomeSent", False),
        },
        "requestId": "",
    }

    # 欢迎语发送失败告警
    if "WelcomeWarning" in data:
        result["data"]["welcome_warning"] = data["WelcomeWarning"]
        log_error(f"欢迎语发送失败: {data['WelcomeWarning']}")

    _print_json(result)
    sys.exit(0)


if __name__ == "__main__":
    main()
