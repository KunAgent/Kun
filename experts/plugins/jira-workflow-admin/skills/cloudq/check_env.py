#!/usr/bin/env python3
"""
腾讯云智能顾问环境检测脚本（只读，不修改任何配置）

功能：检测 Python 版本、Skill 版本更新（含 changelog）、密钥、角色配置状态，输出检测结果
注意：本脚本仅做检测，不会创建角色或修改任何配置（发现已有角色时保存配置除外）

用法:
    python3 check_env.py           # 标准模式：输出详细检测结果
    python3 check_env.py --quiet   # 静默模式：仅输出错误信息（供其他脚本调用）
    python3 check_env.py --skip-update  # 跳过版本更新检查
    python3 check_env.py --list-console-roles  # 列出支持控制台登录的角色（JSON）
    python3 check_env.py --check-role <name>   # 检查指定角色是否支持控制台登录（JSON）

返回码:
    0 - 环境就绪（密钥 + 角色全部正常）/ 查询成功
    1 - Python 版本不满足 / 查询失败
    2 - AK/SK 未配置或无效
    3 - 角色未配置（需要执行角色创建步骤）

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

# 将 scripts 目录加入搜索路径
SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = SCRIPT_DIR / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from tcloud_api import call_api  # noqa: E402


# ============== 配置 ==============
CONFIG_DIR = Path.home() / ".tencent-cloudq"
CONFIG_FILE = CONFIG_DIR / "config.json"
VERSION_CACHE_FILE = CONFIG_DIR / "version_check_cache.json"
ADVISOR_ROLE_NAME = "advisor"

# 版本检查配置
META_FILE = SCRIPT_DIR / "_meta.json"
VERSION_CHECK_TIMEOUT = 15  # 秒


# ============== 输出函数 ==============
QUIET_MODE = "--quiet" in sys.argv
SKIP_UPDATE = "--skip-update" in sys.argv


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


def list_console_login_roles() -> dict:
    """查询账号下所有支持控制台登录的用户自定义角色（只读）。

    Returns:
        dict: {
            "success": bool,
            "roles": [{"RoleName": ..., "ConsoleLogin": 1, ...}, ...],
            "total": int,  # 筛选后数量
            "error": {...}  # 仅失败时
        }
    """
    result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "DescribeRoleList", "2019-01-16",
        {"Page": 1, "Rp": 200},
    )
    if not result.get("success"):
        return {
            "success": False,
            "roles": [],
            "error": result.get("error", {}),
        }
    role_list = result.get("data", {}).get("List", [])
    console_roles = [
        r for r in role_list
        if r.get("ConsoleLogin") == 1 and r.get("RoleType") == "user"
    ]
    return {"success": True, "roles": console_roles, "total": len(console_roles)}


def check_role_console_login(role_name: str) -> dict:
    """检查指定角色是否存在及是否支持控制台登录（只读）。

    Args:
        role_name: 角色名称

    Returns:
        dict: {
            "success": bool,   # API 调用是否成功
            "role_name": str,
            "exists": bool,    # 角色是否存在
            "console_login": bool,  # 是否支持控制台登录
            "data": {...}      # 角色完整数据（仅存在时）
        }
    """
    result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "GetRole", "2019-01-16",
        {"RoleName": role_name},
    )
    if not result.get("success"):
        return {
            "success": False,
            "role_name": role_name,
            "exists": False,
            "console_login": False,
            "error": result.get("error", {}),
        }
    data = result.get("data", {})
    console_login = data.get("ConsoleLogin", 0) == 1
    return {
        "success": True,
        "role_name": role_name,
        "exists": True,
        "console_login": console_login,
        "data": data,
    }


def parse_version(version_str: str) -> tuple:
    """解析语义化版本号字符串为可比较的元组，如 '1.3.0' -> (1, 3, 0)"""
    try:
        parts = version_str.strip().lstrip("v").split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0, 0)


def get_local_version() -> tuple:
    """读取本地 _meta.json 中的版本号，返回 (slug, version_str) 或 (None, None)"""
    if not META_FILE.exists():
        return None, None
    try:
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
        return meta.get("slug"), meta.get("version")
    except (json.JSONDecodeError, IOError):
        return None, None


def _extract_version(data: dict) -> str | None:
    """从 ClawHub API / inspect JSON 中提取 latestVersion.version"""
    return data.get("latestVersion", {}).get("version")


def _get_info_via_requests(api_url: str) -> dict | None:
    """L1: 通过 requests 库直接请求 ClawHub API（自带 certifi，SSL 兼容性最好）"""
    import requests  # noqa: delay import
    resp = requests.get(api_url, headers={"Accept": "application/json"}, timeout=VERSION_CHECK_TIMEOUT)
    if resp.status_code != 200:
        return None
    return resp.json()


def _get_info_via_clawhub(slug: str) -> dict | None:
    """L2: 通过本地已安装的 clawhub CLI 获取版本"""
    import subprocess
    result = subprocess.run(
        ["clawhub", "inspect", slug, "--versions", "--json"],
        capture_output=True, text=True, timeout=VERSION_CHECK_TIMEOUT,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def get_remote_info(slug: str) -> dict | None:
    """
    从 ClawHub registry 查询指定 slug 的最新版本信息（含 changelog），返回完整 JSON 或 None。

    两级降级策略（不执行 npx 等远程代码下载）：
      L1: requests 直接请求 API（最快，自带 SSL 证书）
      L2: clawhub inspect --versions（仅使用本地已安装的 CLI）
    """
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


def _load_version_cache() -> dict | None:
    """读取版本检查缓存，返回缓存内容或 None"""
    if not VERSION_CACHE_FILE.exists():
        return None
    try:
        return json.loads(VERSION_CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, IOError):
        return None


def _save_version_cache(result: dict):
    """保存版本检查结果到缓存文件"""
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
    """
    检查本地版本与远端版本是否一致，并提取 changelog。

    每次新对话的首次运行都会请求远端 API 拉取最新版本信息，
    结果保存到 ~/.tencent-cloudq/version_check_cache.json 供参考。
    若发现新版本，向用户展示 changelog 并建议更新。

    返回 dict:
      - status: "up_to_date" | "update_available" | "check_failed" | "no_meta"
      - local_version: 本地版本号（str）
      - remote_version: 远端版本号（str 或 None）
      - slug: skill 标识符
      - changelog: 新版本的变更日志列表（仅 update_available 时）
      - message: 可读的状态说明
    """
    slug, local_ver = get_local_version()
    if not slug or not local_ver:
        return {
            "status": "no_meta",
            "local_version": None,
            "remote_version": None,
            "slug": slug,
            "message": "未找到 _meta.json 或版本信息缺失",
        }

    # 每次都请求远端拉取最新版本
    result = _fetch_remote_version(slug, local_ver)
    _save_version_cache(result)
    return result


def _fetch_remote_version(slug: str, local_ver: str) -> dict:
    """请求远端获取最新版本信息（内部函数）"""

    remote_data = get_remote_info(slug)
    if remote_data is None:
        return {
            "status": "check_failed",
            "local_version": local_ver,
            "remote_version": None,
            "slug": slug,
            "message": "无法获取远端版本信息（网络问题或接口不可用）",
        }

    remote_ver = _extract_version(remote_data)
    if not remote_ver:
        return {
            "status": "check_failed",
            "local_version": local_ver,
            "remote_version": None,
            "slug": slug,
            "message": "远端版本信息格式异常",
        }

    local_parsed = parse_version(local_ver)
    remote_parsed = parse_version(remote_ver)

    if remote_parsed <= local_parsed:
        return {
            "status": "up_to_date",
            "local_version": local_ver,
            "remote_version": remote_ver,
            "slug": slug,
            "message": f"当前已是最新版本: {local_ver}",
        }

    # 收集 changelog：优先从 versions 列表提取，兜底从 latestVersion.changelog 提取
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

    # 兜底：versions 列表为空时，从 latestVersion.changelog 提取
    if not changelog_lines:
        latest_changelog = remote_data.get("latestVersion", {}).get("changelog", "")
        if latest_changelog:
            changelog_lines.append(f"  {remote_ver}: {latest_changelog}")

    return {
        "status": "update_available",
        "local_version": local_ver,
        "remote_version": remote_ver,
        "slug": slug,
        "changelog": changelog_lines,
        "message": f"发现新版本: {local_ver} → {remote_ver}",
    }


def main():
    # ============== 独立命令行参数（直接输出 JSON 并退出） ==============
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

        if status == "up_to_date":
            log_ok(ver_result["message"])
        elif status == "update_available":
            log_warn(ver_result["message"])
            log_info("")
            log_info(f"  当前版本: {ver_result['local_version']}")
            log_info(f"  最新版本: {ver_result['remote_version']}")
            changelog = ver_result.get("changelog", [])
            if changelog:
                log_info("")
                log_info("  === Changelog（变更日志）===")
                for line in changelog:
                    log_info(line)
            log_info("")
            log_info("  请前往 SkillHub 或 ClawHub 更新此 Skill")
            log_info("  当前版本仍可正常使用。")
            log_info("")
            # 不阻断，继续后续检测
        elif status in ("check_failed", "no_meta"):
            log_warn(ver_result["message"])
            log_info("  版本检查跳过，继续后续检测...")

    # ============== 3. 检查 AK/SK 配置 ==============
    log_section("3. 检查 AK/SK 配置")

    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")

    if not secret_id or not secret_key:
        missing = []
        if not secret_id:
            missing.append("TENCENTCLOUD_SECRET_ID")
        if not secret_key:
            missing.append("TENCENTCLOUD_SECRET_KEY")
        log_fail(f"未配置以下环境变量: {', '.join(missing)}")
        log_info("")
        log_info("  请将腾讯云 API 密钥永久写入 shell 配置文件：")
        log_info("")
        log_info("  Linux / macOS（写入 ~/.bashrc 或 ~/.zshrc）:")
        log_info('    echo \'export TENCENTCLOUD_SECRET_ID="your-secret-id"\' >> ~/.bashrc')
        log_info('    echo \'export TENCENTCLOUD_SECRET_KEY="your-secret-key"\' >> ~/.bashrc')
        log_info("    source ~/.bashrc")
        log_info("")
        log_info("  Windows PowerShell（写入用户级环境变量）:")
        log_info('    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_ID", "your-secret-id", "User")')
        log_info('    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_KEY", "your-secret-key", "User")')
        log_info("")
        log_info("  密钥获取地址: https://console.cloud.tencent.com/cam/capi")
        sys.exit(2)

    masked_id = f"{secret_id[:4]}****{secret_id[-4:]}" if len(secret_id) > 8 else "****"
    log_ok(f"SecretId 已配置: {masked_id}")
    log_ok("SecretKey 已配置: ****")

    token = os.environ.get("TENCENTCLOUD_TOKEN", "")
    if token:
        log_ok("临时密钥 Token 已配置")

    # ============== 4. 验证 AK/SK 有效性 ==============
    log_section("4. 验证 AK/SK 有效性")

    verify_result = call_api(
        "advisor", "advisor.tencentcloudapi.com",
        "DescribeArchList", "2020-07-21",
        {"PageNumber": 1, "PageSize": 1},
        "ap-guangzhou",
    )

    if verify_result.get("success"):
        log_ok("AK/SK 验证通过，接口调用成功")
    else:
        error_code = verify_result.get("error", {}).get("code", "Unknown")
        auth_failures = [
            "AuthFailure.SecretIdNotFound",
            "AuthFailure.SignatureFailure",
            "AuthFailure.InvalidSecretId",
        ]
        if error_code in auth_failures:
            log_fail(f"AK/SK 无效: {error_code}")
            log_info("  请检查密钥是否正确: https://console.cloud.tencent.com/cam/capi")
            sys.exit(2)
        elif error_code in ("NetworkError", "HTTPError"):
            log_fail("接口调用失败，请检查网络连接")
            sys.exit(1)
        else:
            log_ok("AK/SK 验证通过（鉴权成功）")
            if not QUIET_MODE:
                log_warn(f"接口返回业务错误: {error_code}（不影响鉴权）")

    # ============== 5. 检查角色配置状态（仅检测，不创建） ==============
    log_section("5. 检查免密登录角色配置")

    role_arn = os.environ.get("TENCENTCLOUD_ROLE_ARN", "")
    role_configured = False

    # 5.1 优先检查环境变量
    if role_arn:
        log_ok("ROLE_ARN 已通过环境变量配置")
        role_configured = True

    # 5.2 检查配置文件
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

    # 5.3 检查 ROLE_NAME 环境变量
    if not role_configured:
        role_name_env = os.environ.get("TENCENTCLOUD_ROLE_NAME", "")
        if role_name_env:
            log_ok(f"ROLE_NAME 已配置: {role_name_env}")
            role_configured = True

    # 5.4 角色未配置 → 检测账号下是否存在可用角色
    if not role_configured:
        log_warn("免密登录角色未配置")
        log_info("")

        # 获取账号 UIN
        uin_result = call_api(
            "sts", "sts.tencentcloudapi.com",
            "GetCallerIdentity", "2018-08-13", {},
        )
        account_uin = str(uin_result.get("data", {}).get("AccountId", ""))

        if not account_uin or account_uin == "None":
            log_fail("无法获取账号 UIN")
            log_info("  需要创建角色用于免密登录，请先检查网络和 AK/SK 权限")
            sys.exit(3)

        log_info(f"  账号 UIN: {account_uin}")

        # 检查 advisor 角色是否已存在
        log_info(f"  检查 {ADVISOR_ROLE_NAME} 角色是否存在...")
        role_check = call_api(
            "cam", "cam.tencentcloudapi.com",
            "GetRole", "2019-01-16",
            {"RoleName": ADVISOR_ROLE_NAME},
        )

        if role_check.get("success"):
            console_login = role_check.get("data", {}).get("ConsoleLogin", 0)
            if console_login == 1:
                # 角色存在且支持控制台登录 → 保存配置
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

        # 5.5 advisor 不可用 → 查询角色列表寻找可用角色
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
                log_info("  免密登录功能需要一个支持控制台登录的 CAM 角色，请执行角色创建步骤：")
                log_info(f"  python3 {SCRIPT_DIR}/scripts/create_role.py")
                sys.exit(3)

    # ============== 6. 验证角色扮演（仅角色已配置时） ==============
    if role_configured:
        log_section("6. 验证角色扮演")

        # 调用 login_url.py 中的逻辑验证
        try:
            scripts_dir = SCRIPT_DIR / "scripts"
            login_url_path = scripts_dir / "login_url.py"
            if not login_url_path.exists():
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
                    log_info("  免密登录功能可能需要等待角色生效（通常几秒内）")
            except json.JSONDecodeError:
                log_warn("角色扮演验证返回格式异常")
        except Exception as e:
            log_warn(f"角色扮演验证异常: {e}")

    # ============== 检测完成 ==============
    log_info("")
    log_info("=== 检测完成 ===")
    if role_configured:
        log_ok("环境就绪，所有功能可用（API 查询 + 免密登录）")
        log_info("")
        log_info(f"  [OK] Python {py_ver.major}.{py_ver.minor} ({platform.system()})")
        log_info("  [OK] AK/SK 密钥验证通过")
        log_info("  [OK] 免密登录角色已配置")
        sys.exit(0)
    else:
        log_fail("环境检测未通过：免密登录角色未配置")
        log_info("")
        log_info("  请执行角色创建步骤完成初始化")
        sys.exit(3)


if __name__ == "__main__":
    main()
