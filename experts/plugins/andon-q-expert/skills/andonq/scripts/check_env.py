#!/usr/bin/env python3
"""
AndonQ Skill 环境检测脚本（只读，不修改任何配置）

功能：检测 Python 版本、Skill 版本更新（含 changelog）、OAuth2 临时码配置
注意：仅在用户主动执行临时码绑定子命令时才会写入 ~/.andonq/auth.json，其他情况只读

用法（从项目根目录执行）:
    python3 scripts/check_env.py               # 标准模式：输出详细检测结果
    python3 scripts/check_env.py --quiet       # 静默模式：仅输出错误信息
    python3 scripts/check_env.py --skip-update # 跳过版本更新检查
    python3 scripts/check_env.py --bind-code   # 交互式绑定 OAuth2 临时码（写入 ~/.andonq/auth.json）

返回码:
    0 - 环境就绪
    1 - Python 版本不满足
    2 - OAuth2 临时码未配置

说明：发现新版本时不阻断，仅输出提示；由 Skill 侧在首次回答末尾提醒一次。
"""

import json
import platform
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 强制 stdout/stderr 使用 UTF-8 编码（避免 Bash 工具捕获时乱码）
# ---------------------------------------------------------------------------
def _force_utf8_output():
    """强制 stdout/stderr 使用 UTF-8 编码，避免在某些环境中出现乱码"""
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        else:
            import io
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass  # 静默失败，不影响主要功能

_force_utf8_output()

# scripts/ 目录（当前脚本所在目录）
SCRIPT_DIR = Path(__file__).resolve().parent
# 项目根目录（_meta.json 所在位置）
ROOT_DIR = SCRIPT_DIR.parent

# check_env.py 与 andon_auth.py 平级放在 scripts/ 下，直接 import 即可
from andon_auth import (  # type: ignore  # noqa: E402
    AUTH_FILE,
    CONFIG_DIR,
    build_authorize_url,
    load_auth_code,
    save_auth_code,
)

# ============== 配置 ==============
VERSION_CACHE_FILE = CONFIG_DIR / "version_check_cache.json"
META_FILE = ROOT_DIR / "_meta.json"
VERSION_CHECK_TIMEOUT = 15  # 秒

# ============== 命令行参数 ==============
QUIET_MODE = "--quiet" in sys.argv
SKIP_UPDATE = "--skip-update" in sys.argv
BIND_CODE = "--bind-code" in sys.argv


# ============== 输出函数 ==============
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


# ============== 版本检查函数 ==============
def parse_version(version_str):
    """解析语义化版本号字符串为可比较的元组，如 '1.3.0' -> (1, 3, 0)"""
    try:
        parts = version_str.strip().lstrip("v").split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0, 0)


def get_local_version():
    """读取本地 _meta.json 中的版本号，返回 (slug, version_str) 或 (None, None)"""
    if not META_FILE.exists():
        return None, None
    try:
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
        return meta.get("slug"), meta.get("version")
    except (json.JSONDecodeError, IOError):
        return None, None


def _extract_version(data):
    """从 ClawHub API / inspect JSON 中提取 latestVersion.version"""
    return data.get("latestVersion", {}).get("version")


def _get_info_via_requests(api_url):
    """L1: 通过 requests 库直接请求 ClawHub API（自带 certifi，SSL 兼容性最好）"""
    import requests  # noqa: delay import
    resp = requests.get(
        api_url,
        headers={"Accept": "application/json"},
        timeout=VERSION_CHECK_TIMEOUT,
    )
    if resp.status_code != 200:
        return None
    return resp.json()


def _get_info_via_clawhub(slug):
    """L2: 通过本地已安装的 clawhub CLI 获取版本"""
    import subprocess
    result = subprocess.run(
        ["clawhub", "inspect", slug, "--versions", "--json"],
        capture_output=True, text=True, timeout=VERSION_CHECK_TIMEOUT,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def get_remote_info(slug):
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


def _save_version_cache(result):
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


def check_version_update():
    """
    检查本地版本与远端版本是否一致，并提取 changelog。

    返回 dict:
      - status: "up_to_date" | "update_available" | "check_failed" | "no_meta"
      - local_version: 本地版本号（str 或 None）
      - remote_version: 远端版本号（str 或 None）
      - slug: skill 标识符
      - changelog: 新版本变更日志列表（仅 update_available 时）
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

    result = _fetch_remote_version(slug, local_ver)
    _save_version_cache(result)
    return result


def _fetch_remote_version(slug, local_ver):
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


# ============== 原有检查函数 ==============
def check_python_version(version_info=None):
    """
    Check if Python version is >= 3.7.

    Args:
        version_info: tuple like (major, minor, micro). If None, uses sys.version_info.

    Returns:
        (bool, str): (is_ok, message)
    """
    if version_info is None:
        version_info = sys.version_info[:3]

    major, minor, micro = version_info

    if (major, minor) >= (3, 7):
        return (True, "")
    else:
        return (False, f"Python 3.7+ required, got {major}.{minor}.{micro}")


# ============== OAuth2 临时码展示工具 ==============
def mask_credential(value, visible_suffix=4):
    """
    Mask a credential value, showing only the last N characters.
    """
    if len(value) <= visible_suffix:
        return "*" * len(value)
    return "*" * (len(value) - visible_suffix) + value[-visible_suffix:]


def format_obtained_at(ts) -> str:
    """
    将 obtained_at 时间戳格式化为展示文本："<时间戳> (<本地时间>)"。

    兼容输入：整数/浮点数时间戳、纯数字字符串、或旧版 ISO8601 字符串。
    解析失败时直接返回原始值的 str 表示，避免阻断展示。
    """
    if ts in (None, "", 0):
        return ""
    # 整数/浮点数：直接当时间戳用
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        epoch = int(ts)
    elif isinstance(ts, str) and ts.strip().lstrip("-").isdigit():
        epoch = int(ts.strip())
    else:
        # 兑底：当作 ISO8601 字符串解析（兼容旧版 auth.json）
        try:
            normalized = str(ts).replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            epoch = int(dt.timestamp())
        except (ValueError, TypeError):
            return str(ts)

    try:
        local_str = datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M:%S")
        return f"{epoch} ({local_str})"
    except (ValueError, OSError, OverflowError):
        return str(epoch)


def _print_authorize_guide():
    """输出授权引导文案（用于首次绑定 / 临时码缺失 / 临时码失效时提示用户）"""
    log_info("")
    log_info("  === OAuth2 授权引导 ===")
    log_info("  1) 在浏览器打开以下授权页面并完成登录（支持 Cmd/Ctrl 点击打开）：")
    log_info("")
    log_info(f"     {build_authorize_url()}")
    log_info("")
    log_info("  2) 登录成功后，复制页面上展示的【临时码】")
    log_info("")
    log_info("  3) 运行以下命令绑定临时码（交互式粘贴）：")
    log_info("     python3 scripts/check_env.py --bind-code")
    log_info("")


def bind_code_interactive():
    """
    交互式绑定临时码：打印授权 URL，读取用户粘贴的临时码后写入 ~/.andonq/auth.json。

    Returns:
        int: 退出码，0 表示成功
    """
    print("=== AndonQ OAuth2 临时码绑定 ===")
    print("")
    print("请按以下步骤操作：")
    print("")
    print("1) 在浏览器打开以下授权页面并完成登录（支持 Cmd/Ctrl 点击打开）：")
    print("")
    print(f"   {build_authorize_url()}")
    print("")
    print("2) 登录成功后，复制页面上展示的【临时码】，原样粘贴即可")
    print("   （脚本会自动识别并提取有效部分，无需手动处理）")
    print("")
    try:
        token = input("3) 请粘贴临时码并回车： ").strip()
    except (EOFError, KeyboardInterrupt):
        print("")
        print("  [FAIL] 已取消绑定")
        return 2

    if not token:
        print("  [FAIL] 临时码为空，未写入")
        return 2

    try:
        save_auth_code(token)
    except Exception as e:
        print(f"  [FAIL] 写入失败: {e}")
        return 2

    # save_auth_code 已对原始输入做提取，展示时重新从 auth.json 读出实际落盘的纯 token
    saved_token, _ = load_auth_code()
    print("")
    print(f"  [OK] 临时码已保存到 {AUTH_FILE}（权限 0600）")
    print(f"  [OK] 当前临时码: {mask_credential(saved_token)}")
    print("")
    print("绑定完成，可以正常使用 AndonQ 功能。")
    return 0


def main():
    """
    Main CLI entry point. Validates environment and exits with semantic code.

    Exit codes:
    - 0: ready
    - 1: python version too low
    - 2: OAuth2 临时码未配置

    发现新版本时不阻断（仅 warn），由 Skill 侧在首次回答末尾提醒用户更新。
    """
    # === --bind-code：交互式绑定临时码（独立子命令） ===
    if BIND_CODE:
        sys.exit(bind_code_interactive())

    # === 1. 检查 Python 版本 ===
    log_section("1. 检查运行环境")
    py_ok, py_msg = check_python_version()
    if py_ok:
        log_ok(
            f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} "
            f"({platform.system()} {platform.machine()})"
        )
    else:
        log_fail(py_msg)
        sys.exit(1)

    # === 2. 检查 Skill 版本更新 ===
    log_section("2. 检查 Skill 版本")
    if SKIP_UPDATE:
        log_ok("已跳过版本更新检查（--skip-update）")
    else:
        ver_result = check_version_update()
        status = ver_result["status"]

        if status == "up_to_date":
            log_ok(ver_result["message"])
        elif status == "update_available":
            # 发现新版本不阻断，由 Skill 侧在首次回答末尾提醒
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
        elif status in ("check_failed", "no_meta"):
            log_warn(ver_result["message"])
            log_info("  版本检查跳过，继续后续检测...")

    # === 3. 检查 OAuth2 临时码配置 ===
    log_section("3. 检查 OAuth2 临时码")
    token, obtained_at = load_auth_code()
    if not token:
        log_fail(f"未找到 OAuth2 临时码（{AUTH_FILE} 不存在或为空）")
        _print_authorize_guide()
        sys.exit(2)

    log_ok(f"临时码已绑定: {mask_credential(token)}")
    if obtained_at:
        log_ok(f"绑定时间: {format_obtained_at(obtained_at)}")
    log_ok(f"存储路径: {AUTH_FILE}")

    log_info("")
    log_info("=== 检测完成 ===")
    log_ok("环境就绪")
    sys.exit(0)


if __name__ == "__main__":
    main()
