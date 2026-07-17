#!/usr/bin/env python3
"""
腾讯云智能顾问环境检测脚本

功能：检测 Python 版本、Skill 版本更新（含 changelog）、密钥/OAuth 凭证、智能顾问开通状态、角色配置状态，输出检测结果
      支持 AK/SK 环境变量和 OAuth 浏览器授权两种鉴权方式
      支持 --enable-advisor 参数开通智能顾问（写入操作，需用户明确同意）

用法:
    python3 check_env.py           # 标准模式：输出详细检测结果
    python3 check_env.py --quiet   # 静默模式：仅输出错误信息（供其他脚本调用）
    python3 check_env.py --skip-update  # 跳过版本更新检查
    python3 check_env.py --enable-advisor  # 开通智能顾问（写入操作，需用户明确同意）
    python3 check_env.py --list-console-roles  # 列出支持控制台登录的角色（JSON）
    python3 check_env.py --check-role <name>   # 检查指定角色是否支持控制台登录（JSON）

返回码:
    0 - 环境就绪（凭证 + 智能顾问已开通 + 角色全部正常）/ 查询成功
    1 - Python 版本不满足 / 查询失败
    2 - 凭证未配置或无效（AK/SK 和 OAuth 均不可用）
    3 - 角色未配置（需要执行角色创建步骤，可选）
    4 - 智能顾问未开通（需要开通智能顾问后才能使用 CloudQ）

跨平台支持: Windows / Linux / macOS
"""

import json
import os
import platform
import stat
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# scripts 目录（当前脚本所在目录）
SCRIPT_DIR = Path(__file__).resolve().parent
# 项目根目录（SKILL.md / _meta.json 所在位置）
ROOT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from tcloud_api import call_api  # noqa: E402


# ============== 配置 ==============
CONFIG_DIR = Path.home() / ".tencent-cloudq"
CONFIG_FILE = CONFIG_DIR / "config.json"
VERSION_CACHE_FILE = CONFIG_DIR / "version_check_cache.json"
ADVISOR_ROLE_NAME = "advisor"

# 角色需要关联的策略列表（用于检测和自动补充）
REQUIRED_ROLE_POLICIES = [
    "QcloudTAGFullAccess",
    "QcloudAdvisorFullAccess",
]

# 版本检查配置（_meta.json 在项目根目录）
META_FILE = ROOT_DIR / "_meta.json"
VERSION_CHECK_TIMEOUT = 15  # 秒


# ============== 输出函数 ==============
QUIET_MODE = "--quiet" in sys.argv
SKIP_UPDATE = "--skip-update" in sys.argv
ENABLE_ADVISOR = "--enable-advisor" in sys.argv


def log_info(msg: str):
    if not QUIET_MODE:
        print(msg)


def log_ok(msg: str):
    if not QUIET_MODE:
        print(f"  [OK] {msg}")


def log_warn(msg: str):
    if not QUIET_MODE:
        print(f"  [WARN] {msg}")


def log_fail(msg: str):
    print(f"  [FAIL] {msg}")


def log_section(title: str):
    if not QUIET_MODE:
        print(f"\n=== {title} ===")


def save_config(account_uin: str, role_name: str, role_arn: str,
                auto_created: bool = False, role_id: str = ""):
    """保存配置文件（跨平台兼容）"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    # 设置目录权限（非 Windows）
    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_DIR), stat.S_IRWXU)  # 700
        except OSError:
            pass

    config = {
        "accountUin": account_uin,
        "roleName": role_name,
        "roleArn": role_arn,
        "configuredAt": datetime.now(timezone.utc).isoformat(),
        "autoCreated": auto_created,
        "version": "1.0",
    }
    if role_id:
        config["roleId"] = role_id

    CONFIG_FILE.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")

    # 设置文件权限（非 Windows）
    if platform.system() != "Windows":
        try:
            os.chmod(str(CONFIG_FILE), stat.S_IRUSR | stat.S_IWUSR)  # 600
        except OSError:
            pass


def ensure_role_policies(role_name: str) -> list:
    """为角色补充缺失的必需策略（幂等操作）。

    对 REQUIRED_ROLE_POLICIES 中的每个策略执行 AttachRolePolicy，
    已关联的策略会返回 PolicyAlreadyAttached 错误码，视为成功。

    Returns:
        list: 关联失败的警告信息列表（空列表表示全部成功）
    """
    warnings = []
    for policy_name in REQUIRED_ROLE_POLICIES:
        attach_result = call_api(
            "cam", "cam.tencentcloudapi.com",
            "AttachRolePolicy", "2019-01-16",
            {"AttachRoleName": role_name, "PolicyName": policy_name},
        )
        if not attach_result.get("success"):
            err_code = attach_result.get("error", {}).get("code", "")
            if "AlreadyAttached" not in err_code:
                err_msg = attach_result.get("error", {}).get("message", "未知错误")
                warnings.append(f"策略 {policy_name} 关联失败: {err_msg}")
    return warnings


def list_console_login_roles() -> dict:
    """查询账号下所有支持控制台登录的用户自定义角色（只读）。"""
    result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "DescribeRoleList", "2019-01-16",
        {"Page": 1, "Rp": 200},
    )
    if not result.get("success"):
        return {"success": False, "roles": [], "error": result.get("error", {})}
    role_list = result.get("data", {}).get("List", [])
    console_roles = [
        r for r in role_list
        if r.get("ConsoleLogin") == 1 and r.get("RoleType") == "user"
    ]
    return {"success": True, "roles": console_roles, "total": len(console_roles)}


def check_role_console_login(role_name: str) -> dict:
    """检查指定角色是否存在及是否支持控制台登录（只读）。"""
    result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "GetRole", "2019-01-16",
        {"RoleName": role_name},
    )
    if not result.get("success"):
        return {
            "success": False, "role_name": role_name,
            "exists": False, "console_login": False,
            "error": result.get("error", {}),
        }
    data = result.get("data", {})
    console_login = data.get("ConsoleLogin", 0) == 1
    return {
        "success": True, "role_name": role_name,
        "exists": True, "console_login": console_login, "data": data,
    }


def parse_version(version_str: str) -> tuple:
    """解析语义化版本号字符串为可比较的元组"""
    try:
        parts = version_str.strip().lstrip("v").split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0, 0)


def get_local_version() -> tuple:
    """获取本地版本信息，多源降级：_meta.json → SKILL.md front-matter。"""
    # L1: _meta.json
    if META_FILE.exists():
        try:
            meta = json.loads(META_FILE.read_text(encoding="utf-8"))
            slug, ver = meta.get("slug"), meta.get("version")
            if slug and ver:
                return slug, ver
        except (json.JSONDecodeError, IOError):
            pass

    # L2: SKILL.md YAML front-matter
    skill_md = ROOT_DIR / "SKILL.md"
    if skill_md.exists():
        try:
            text = skill_md.read_text(encoding="utf-8")
            if text.startswith("---"):
                end = text.index("---", 3)
                fm = text[3:end]
                props = {}
                for line in fm.strip().splitlines():
                    if ":" in line:
                        k, v = line.split(":", 1)
                        props[k.strip()] = v.strip().strip('"').strip("'")
                name = props.get("name", "")
                ver = props.get("version")
                if name and ver:
                    slug = name.lower().replace(" ", "-")
                    return slug, ver
        except (IOError, ValueError):
            pass

    return None, None


def _extract_version(data: dict) -> str | None:
    return data.get("latestVersion", {}).get("version")


def _get_info_via_requests(api_url: str) -> dict | None:
    import requests  # noqa: delay import
    resp = requests.get(api_url, headers={"Accept": "application/json"}, timeout=VERSION_CHECK_TIMEOUT)
    if resp.status_code != 200:
        return None
    return resp.json()


def _get_info_via_clawhub(slug: str) -> dict | None:
    import subprocess
    result = subprocess.run(
        ["clawhub", "inspect", slug, "--versions", "--json"],
        capture_output=True, text=True, timeout=VERSION_CHECK_TIMEOUT,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def get_remote_info(slug: str) -> dict | None:
    api_url = f"https://clawhub.ai/api/v1/skills/{urllib.parse.quote(slug, safe='')}"
    strategies = [
        lambda: _get_info_via_requests(api_url),
        lambda: _get_info_via_clawhub(slug),
    ]
    for strategy in strategies:
        try:
            data = strategy()
            if data and _extract_version(data):
                return data
        except Exception:
            continue
    return None


def _save_version_cache(result: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cache = {
        "checked_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status": result.get("status"),
        "local_version": result.get("local_version"),
        "remote_version": result.get("remote_version"),
        "changelog": result.get("changelog", []),
        "message": result.get("message"),
    }
    try:
        VERSION_CACHE_FILE.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except IOError:
        pass


def check_version_update() -> dict:
    slug, local_ver = get_local_version()
    local_error = None
    if not slug or not local_ver:
        local_error = "未找到 _meta.json 或版本信息缺失"
        log_warn(f"本地版本检查: {local_error}")

    remote_ver = None
    remote_data = None
    remote_error = None

    slugs_to_try = [slug] if slug else ["cloudq", "CloudQ", "advisor", "tencent-cloudq"]
    slugs_to_try = [s for s in slugs_to_try if s]

    for try_slug in slugs_to_try:
        try:
            remote_data = get_remote_info(try_slug)
            if remote_data and _extract_version(remote_data):
                remote_ver = _extract_version(remote_data)
                if not slug:
                    slug = try_slug
                break
        except Exception:
            continue

    if not remote_ver:
        remote_error = "无法获取远端版本信息"

    result = {"local_version": local_ver, "remote_version": remote_ver, "slug": slug}
    if local_error:
        result["local_error"] = local_error
    if remote_error:
        result["remote_error"] = remote_error

    has_local = bool(local_ver)
    has_remote = bool(remote_ver)

    if has_local and has_remote:
        local_parsed = parse_version(local_ver)
        remote_parsed = parse_version(remote_ver)
        if remote_parsed <= local_parsed:
            result.update({"status": "up_to_date", "message": f"当前已是最新版本: {local_ver}"})
        else:
            changelog = _collect_changelog(remote_data, local_parsed)
            result.update({"status": "update_available", "changelog": changelog,
                           "message": f"发现新版本: {local_ver} → {remote_ver}"})
    elif has_local and not has_remote:
        result.update({"status": "local_only", "message": f"本地版本: {local_ver}，但无法获取远端版本信息"})
    elif not has_local and has_remote:
        changelog = []
        latest_changelog = (remote_data or {}).get("latestVersion", {}).get("changelog", "")
        if latest_changelog:
            changelog.append(f"  {remote_ver}: {latest_changelog}")
        result.update({"status": "remote_only", "changelog": changelog,
                       "message": f"本地缺少版本元数据，检测到远端最新版本: {remote_ver}"})
    else:
        result.update({"status": "both_failed", "message": "本地和远端版本信息均无法获取"})

    _save_version_cache(result)
    return result


def _collect_changelog(remote_data: dict, local_parsed: tuple) -> list:
    changelog_lines = []
    versions = remote_data.get("versions", [])
    for v in versions:
        v_str = v.get("version", "")
        v_parsed = parse_version(v_str)
        if v_parsed > local_parsed:
            desc = v.get("changelog") or v.get("description") or ""
            if desc:
                changelog_lines.append(f"  {v_str}: {desc}")
            else:
                changelog_lines.append(f"  {v_str}")
    if not changelog_lines:
        latest_changelog = remote_data.get("latestVersion", {}).get("changelog", "")
        if latest_changelog:
            remote_ver = _extract_version(remote_data) or "未知"
            changelog_lines.append(f"  {remote_ver}: {latest_changelog}")
    return changelog_lines


def main():
    args = sys.argv[1:]

    if "--list-console-roles" in args:
        result = list_console_login_roles()
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(0 if result.get("success") else 1)

    if "--check-role" in args:
        idx = args.index("--check-role")
        if idx + 1 >= len(args) or args[idx + 1].startswith("--"):
            print(json.dumps({"success": False, "error": "缺少角色名参数"}, ensure_ascii=False))
            sys.exit(1)
        role_name = args[idx + 1]
        result = check_role_console_login(role_name)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(0 if result.get("success") else 1)

    # ============== 1. 检查 Python 版本 ==============
    log_section("1. 检查运行环境")

    py_ver = sys.version_info
    if py_ver < (3, 7):
        log_fail(f"Python 版本过低: {sys.version}，需要 Python 3.7+")
        sys.exit(1)

    log_ok(f"Python {py_ver.major}.{py_ver.minor}.{py_ver.micro} ({platform.system()} {platform.machine()})")

    # ============== 2. 检查 Skill 版本更新 ==============
    log_section("2. 检查 Skill 版本")

    if SKIP_UPDATE:
        log_ok("已跳过版本更新检查（--skip-update）")
    else:
        ver_result = check_version_update()
        status = ver_result["status"]
        local_ver = ver_result.get("local_version")
        remote_ver = ver_result.get("remote_version")

        if status == "up_to_date":
            log_ok(ver_result["message"])
            log_info(f"  本地版本: {local_ver} | 远端版本: {remote_ver}")
        elif status == "update_available":
            log_warn(ver_result["message"])
            log_info("")
            log_info(f"  当前版本: {local_ver}")
            log_info(f"  最新版本: {remote_ver}")
            changelog = ver_result.get("changelog", [])
            if changelog:
                log_info("")
                log_info("  === Changelog（变更日志）===")
                for line in changelog:
                    log_info(line)
            log_info("")
            log_info("  请前往 SkillHub 或 ClawHub 更新此 Skill")
            log_info("")
        elif status == "local_only":
            log_warn(ver_result["message"])
            log_info(f"  本地版本: {local_ver}")
            if ver_result.get("remote_error"):
                log_info(f"  远端检查: {ver_result['remote_error']}")
            log_info("  版本比较跳过，继续后续检测...")
        elif status == "remote_only":
            log_warn(ver_result["message"])
            log_info("")
            log_info(f"  远端最新版本: {remote_ver}")
            changelog = ver_result.get("changelog", [])
            if changelog:
                log_info("")
                log_info("  === Changelog（变更日志）===")
                for line in changelog:
                    log_info(line)
            log_info("")
            log_info("  建议前往 SkillHub 或 ClawHub 更新此 Skill")
            log_info("")
        elif status == "both_failed":
            log_warn(ver_result["message"])
            log_info("  版本检查跳过，继续后续检测...")
        else:
            log_warn(f"版本检查返回未知状态: {status}")

    # ============== 3. 检查凭证配置 ==============
    log_section("3. 检查凭证配置")

    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")

    using_oauth = False

    if not secret_id or not secret_key:
        missing = []
        if not secret_id:
            missing.append("TENCENTCLOUD_SECRET_ID")
        if not secret_key:
            missing.append("TENCENTCLOUD_SECRET_KEY")
        log_warn(f"未配置环境变量: {', '.join(missing)}")

        # ---- 3.1 检查 OAuth 凭证 ----
        log_info("")
        log_info("  检查 OAuth 凭证...")
        try:
            from credential_manager import (
                load_credential, maybe_refresh_credential,
                get_credential, CredentialNotFoundError, CredentialExpiredError
            )

            oauth_cred = load_credential()
            if oauth_cred:
                log_ok("OAuth 凭证文件已存在")

                import time as _time
                now = _time.time()
                expires_at = oauth_cred.get("expiresAt", 0)
                remaining = max(0, int(expires_at - now))

                if remaining > 300:
                    log_ok(f"临时密钥有效期剩余: {remaining // 60} 分钟")
                else:
                    log_warn("临时密钥即将过期，尝试自动刷新...")
                    try:
                        maybe_refresh_credential()
                        oauth_cred = load_credential()
                        if oauth_cred:
                            now_after = _time.time()
                            new_remaining = max(0, int(oauth_cred.get("expiresAt", 0) - now_after))
                            log_ok(f"刷新成功，有效期剩余: {new_remaining // 60} 分钟")
                        else:
                            log_fail("刷新后凭证文件丢失")
                            log_info(f"  请重新登录: python3 {SCRIPT_DIR}/login.py")
                            sys.exit(2)
                    except CredentialExpiredError:
                        log_fail("refreshToken 已过期，需要重新登录")
                        log_info(f"  请执行: python3 {SCRIPT_DIR}/login.py")
                        sys.exit(2)
                    except Exception as e:
                        log_warn(f"自动刷新失败: {e}，尝试继续使用当前凭证")

                try:
                    cred = get_credential()
                    secret_id = cred["secretId"]
                    secret_key = cred["secretKey"]
                    using_oauth = True
                    log_ok("将使用 OAuth 凭证继续")
                except Exception as e:
                    log_fail(f"获取 OAuth 凭证失败: {e}")
                    sys.exit(2)
            else:
                log_warn("未找到 OAuth 凭证")
                log_info("")
                log_info("  请选择以下方式之一配置凭证：")
                log_info("")
                log_info("  方式一：OAuth 浏览器授权（推荐，无需密钥）")
                log_info(f"    python3 {SCRIPT_DIR}/login.py")
                log_info("")
                log_info("  方式二：配置环境变量 AK/SK")
                log_info('    export TENCENTCLOUD_SECRET_ID="your-secret-id"')
                log_info('    export TENCENTCLOUD_SECRET_KEY="your-secret-key"')
                log_info("")
                log_info("  密钥获取地址: https://console.cloud.tencent.com/cam/capi")
                sys.exit(2)

        except ImportError:
            log_fail(f"未配置以下环境变量: {', '.join(missing)}")
            log_info("")
            log_info("  请将腾讯云 API 密钥写入 shell 配置文件：")
            log_info('    echo \'export TENCENTCLOUD_SECRET_ID="your-secret-id"\' >> ~/.bashrc')
            log_info("    source ~/.bashrc")
            log_info("")
            log_info("  密钥获取地址: https://console.cloud.tencent.com/cam/capi")
            sys.exit(2)
    else:
        masked_id = f"{secret_id[:4]}****{secret_id[-4:]}" if len(secret_id) > 8 else "****"
        log_ok(f"SecretId 已配置: {masked_id}")
        log_ok("SecretKey 已配置: ****")

    token = os.environ.get("TENCENTCLOUD_TOKEN", "")
    if token:
        log_ok("临时密钥 Token 已配置")

    # ============== 4. 验证凭证有效性 ==============
    log_section("4. 验证凭证有效性")

    verify_result = call_api(
        "advisor", "advisor.tencentcloudapi.com",
        "DescribeArchList", "2020-07-21",
        {"PageNumber": 1, "PageSize": 1},
        "ap-guangzhou",
    )

    if verify_result.get("success"):
        log_ok("凭证验证通过，接口调用成功")
    else:
        error_code = verify_result.get("error", {}).get("code", "Unknown")
        auth_failures = [
            "AuthFailure.SecretIdNotFound",
            "AuthFailure.SignatureFailure",
            "AuthFailure.InvalidSecretId",
        ]
        if error_code in auth_failures:
            log_fail(f"凭证无效: {error_code}")
            if using_oauth:
                log_info(f"  请重新登录: python3 {SCRIPT_DIR}/login.py")
            else:
                log_info("  请检查密钥是否正确: https://console.cloud.tencent.com/cam/capi")
            sys.exit(2)
        elif error_code in ("NetworkError", "HTTPError"):
            log_fail("接口调用失败，请检查网络连接")
            sys.exit(1)
        else:
            log_ok("凭证验证通过（鉴权成功）")
            if not QUIET_MODE:
                log_warn(f"接口返回业务错误: {error_code}（不影响鉴权）")

    # ============== 5. 检查智能顾问开通状态 ==============
    log_section("5. 检查智能顾问开通状态")

    advisor_auth_result = call_api(
        "advisor", "advisor.tencentcloudapi.com",
        "DescribeUserAuthorizationStatus", "2020-07-21",
        {}, "ap-guangzhou",
    )

    advisor_authorized = False
    if advisor_auth_result.get("success"):
        auth_data = advisor_auth_result.get("data", {})
        advisor_authorized = auth_data.get("AdvisorAuthorization", False)
        share_authorized = auth_data.get("ShareAuthorization", False)
        if advisor_authorized:
            log_ok("智能顾问已开通")
            if share_authorized:
                log_ok("架构图共享协作已开启")
            else:
                log_warn("架构图共享协作未开启（不影响 CloudQ 基本功能）")
        else:
            log_fail("智能顾问未开通")
            if ENABLE_ADVISOR:
                log_info("  正在开通智能顾问...")
                enable_result = call_api(
                    "advisor", "advisor.tencentcloudapi.com",
                    "CreateAdvisorAuthorization", "2020-07-21",
                    {}, "ap-guangzhou",
                )
                if enable_result.get("success"):
                    log_ok("智能顾问开通成功！")
                    advisor_authorized = True
                else:
                    err = enable_result.get("error", {})
                    log_fail(f"智能顾问开通失败: {err.get('code', 'Unknown')} - {err.get('message', '未知错误')}")
                    sys.exit(4)
            else:
                log_info("  CloudQ 所有功能均依赖智能顾问服务，必须先开通才能使用")
                log_info("  开通方式：请在对话中同意开通，或运行以下命令：")
                log_info(f"  python3 {SCRIPT_DIR}/check_env.py --enable-advisor")
                sys.exit(4)
    else:
        error_code = advisor_auth_result.get("error", {}).get("code", "Unknown")
        if error_code in ("NetworkError", "HTTPError"):
            log_fail("查询智能顾问开通状态失败，请检查网络连接")
            sys.exit(1)
        else:
            log_warn(f"查询智能顾问开通状态失败: {error_code}")
            log_info("  可能原因：当前凭证无智能顾问相关权限")

    # ============== 6. 检查角色配置状态（仅 AK/SK 模式） ==============
    role_configured = False

    if using_oauth:
        log_section("6. 免密登录角色")
        log_info("  OAuth 模式下跳过角色检测（OAuth 临时密钥无 cam/sts 权限）")
        log_info("  免密登录链接功能仅在 AK/SK 模式下可用")
    else:
        log_section("6. 检查免密登录角色配置")

        role_arn = os.environ.get("TENCENTCLOUD_ROLE_ARN", "")

        if role_arn:
            log_ok("ROLE_ARN 已通过环境变量配置")
            role_configured = True

        if not role_configured and CONFIG_FILE.exists():
            try:
                config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                saved_arn = config.get("roleArn", "")
                saved_role = config.get("roleName", "")
                if saved_arn:
                    log_ok(f"角色已配置（来自配置文件）: {saved_role}")
                    role_configured = True
            except (json.JSONDecodeError, IOError):
                pass

        if not role_configured:
            role_name_env = os.environ.get("TENCENTCLOUD_ROLE_NAME", "")
            if role_name_env:
                log_ok(f"ROLE_NAME 已配置: {role_name_env}")
                role_configured = True

        if not role_configured:
            log_warn("免密登录角色未配置")
            log_info("")

            uin_result = call_api(
                "sts", "sts.tencentcloudapi.com",
                "GetCallerIdentity", "2018-08-13", {},
            )
            account_uin = str(uin_result.get("data", {}).get("AccountId", ""))

            if not account_uin or account_uin == "None":
                log_fail("无法获取账号 UIN")
                sys.exit(3)

            log_info(f"  账号 UIN: {account_uin}")

            log_info(f"  检查 {ADVISOR_ROLE_NAME} 角色是否存在...")
            role_check = call_api(
                "cam", "cam.tencentcloudapi.com",
                "GetRole", "2019-01-16",
                {"RoleName": ADVISOR_ROLE_NAME},
            )

            if role_check.get("success"):
                console_login = role_check.get("data", {}).get("ConsoleLogin", 0)
                if console_login == 1:
                    log_ok(f"检测到已有角色 {ADVISOR_ROLE_NAME}（支持控制台登录），自动配置")
                    computed_arn = f"qcs::cam::uin/{account_uin}:roleName/{ADVISOR_ROLE_NAME}"
                    role_id = str(role_check.get("data", {}).get("RoleId", ""))
                    save_config(account_uin, ADVISOR_ROLE_NAME, computed_arn,
                                auto_created=False, role_id=role_id)
                    log_ok(f"配置已保存到 {CONFIG_FILE}")
                    role_configured = True
                else:
                    log_warn(f"角色 {ADVISOR_ROLE_NAME} 存在但不支持控制台登录")
                    log_info("  尝试查找其他支持控制台登录的角色...")
            else:
                log_warn(f"未检测到 {ADVISOR_ROLE_NAME} 角色")
                log_info("  尝试查找其他支持控制台登录的角色...")

            if not role_configured:
                list_result = list_console_login_roles()
                if list_result.get("success") and list_result.get("roles"):
                    found_role = list_result["roles"][0]
                    found_name = found_role.get("RoleName", "")
                    log_ok(f"检测到可用角色 {found_name}（支持控制台登录），自动配置")
                    computed_arn = f"qcs::cam::uin/{account_uin}:roleName/{found_name}"
                    role_id = str(found_role.get("RoleId", ""))
                    save_config(account_uin, found_name, computed_arn,
                                auto_created=False, role_id=role_id)
                    log_ok(f"配置已保存到 {CONFIG_FILE}")
                    role_configured = True
                else:
                    log_warn("未找到任何支持控制台登录的角色")
                    log_info("")
                    log_info("  免密登录功能需要一个支持控制台登录的 CAM 角色（可选，不影响基本功能）")
                    log_info(f"  如需启用免密登录，请执行: python3 {SCRIPT_DIR}/create_role.py")

        if role_configured:
            policy_warnings = ensure_role_policies(
                os.environ.get("TENCENTCLOUD_ROLE_NAME", ADVISOR_ROLE_NAME)
            )
            if policy_warnings:
                for w in policy_warnings:
                    log_warn(w)
            else:
                log_ok("角色策略检查通过")

        if role_configured:
            log_section("7. 验证角色扮演")
            try:
                login_url_path = SCRIPT_DIR / "login_url.py"
                import subprocess
                test_result = subprocess.run(
                    [sys.executable, str(login_url_path),
                     "https://console.cloud.tencent.com/advisor"],
                    capture_output=True, text=True, timeout=30,
                )
                try:
                    result_data = json.loads(test_result.stdout)
                    if result_data.get("success"):
                        log_ok("角色扮演验证通过，免密登录功能正常")
                    else:
                        err_msg = result_data.get("error", {}).get("message", "未知错误")
                        log_warn(f"角色扮演验证失败: {err_msg}")
                except json.JSONDecodeError:
                    log_warn("角色扮演验证返回格式异常")
            except Exception as e:
                log_warn(f"角色扮演验证异常: {e}")

    # ============== 检测完成 ==============
    log_info("")
    log_info("=== 检测完成 ===")
    cred_mode = "OAuth 凭证" if using_oauth else "AK/SK 密钥"
    if advisor_authorized and role_configured:
        log_ok("环境就绪，所有功能可用（智能顾问已开通 + API 查询 + 免密登录）")
        log_info("")
        log_info(f"  [OK] Python {py_ver.major}.{py_ver.minor} ({platform.system()})")
        log_info(f"  [OK] {cred_mode}验证通过")
        log_info("  [OK] 智能顾问已开通")
        log_info("  [OK] 免密登录角色已配置")
        sys.exit(0)
    elif advisor_authorized and not role_configured:
        log_ok("环境基本就绪（智能顾问已开通，API 查询可用）")
        log_warn("免密登录角色未配置（仅影响免密登录链接生成，不影响 CloudQ 基本功能）")
        log_info("")
        log_info(f"  [OK] Python {py_ver.major}.{py_ver.minor} ({platform.system()})")
        log_info(f"  [OK] {cred_mode}验证通过")
        log_info("  [OK] 智能顾问已开通")
        log_info("  [WARN] 免密登录角色未配置")
        log_info("")
        log_info("  可选：执行角色创建步骤以启用免密登录功能")
        log_info(f"  python3 {SCRIPT_DIR}/create_role.py")
        sys.exit(0)
    else:
        log_fail("环境检测未通过")
        log_info("")
        log_info("  请根据上方提示完成初始化")
        sys.exit(3)


if __name__ == "__main__":
    main()
