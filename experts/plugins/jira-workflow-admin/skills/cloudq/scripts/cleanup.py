#!/usr/bin/env python3
"""
腾讯云智能顾问 - 配置清理脚本

清理本机上 tencent-cloudq 产生的所有配置和缓存文件，
可选删除云端通过本工具创建的 CAM 角色。

用法:
    python3 cleanup.py               # 交互式清理（逐项确认）
    python3 cleanup.py --all         # 一键清理所有本地配置（不含云端角色）
    python3 cleanup.py --all --cloud # 一键清理所有本地配置 + 云端角色

清理范围:
    1. 配置目录  ~/.tencent-cloudq/（含 config.json）
    2. 临时缓存  {系统临时目录}/.tcloud_advisor_uin_cache
    3. 环境变量  TENCENTCLOUD_* 系列环境变量
    4. 云端角色  CAM 角色 advisor（可选，需 AK/SK）

返回码:
    0 - 清理完成
    1 - 用户取消

跨平台支持: Windows / Linux / macOS
"""

import json
import os
import platform
import shutil
import sys
import tempfile
from pathlib import Path

# 导入 tcloud_api 模块（用于可选的云端角色删除）
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# ============== 配置 ==============
CONFIG_DIR = Path.home() / ".tencent-cloudq"
CONFIG_FILE = CONFIG_DIR / "config.json"
CACHE_FILE = Path(tempfile.gettempdir()) / ".tcloud_advisor_uin_cache"
ROLE_NAME = "advisor"

# 智能顾问使用的所有环境变量
ENV_VARS = [
    "TENCENTCLOUD_SECRET_ID",
    "TENCENTCLOUD_SECRET_KEY",
    "TENCENTCLOUD_TOKEN",
    "TENCENTCLOUD_ROLE_ARN",
    "TENCENTCLOUD_ROLE_NAME",
    "TENCENTCLOUD_ROLE_SESSION",
    "TENCENTCLOUD_STS_DURATION",
]


# ============== 终端颜色 ==============
def _supports_color() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    if platform.system() == "Windows":
        return os.environ.get("TERM") == "xterm" or hasattr(sys.stderr, "reconfigure")
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


_COLOR = _supports_color()


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def green(t: str) -> str:
    return _c("32", t)


def red(t: str) -> str:
    return _c("31", t)


def yellow(t: str) -> str:
    return _c("33", t)


def bold(t: str) -> str:
    return _c("1", t)


def dim(t: str) -> str:
    return _c("2", t)


# ============== 工具函数 ==============
def confirm(prompt: str) -> bool:
    """交互式确认，默认为 No"""
    try:
        answer = input(f"{prompt} [y/N]: ").strip().lower()
        return answer in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        print()
        return False


def read_config() -> dict:
    """读取现有配置文件"""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def remove_file(path: Path, label: str) -> bool:
    """删除单个文件"""
    if not path.exists():
        print(f"  {dim('[-]')} {label}: {dim('不存在，跳过')}")
        return False
    try:
        path.unlink()
        print(f"  {green('[OK]')} {label}: 已删除")
        return True
    except OSError as e:
        print(f"  {red('[FAIL]')} {label}: 删除失败 - {e}")
        return False


def remove_dir(path: Path, label: str) -> bool:
    """删除目录及其所有内容"""
    if not path.exists():
        print(f"  {dim('[-]')} {label}: {dim('不存在，跳过')}")
        return False
    try:
        shutil.rmtree(str(path))
        print(f"  {green('[OK]')} {label}: 已删除")
        return True
    except OSError as e:
        print(f"  {red('[FAIL]')} {label}: 删除失败 - {e}")
        return False


# ============== 清理动作 ==============
def clean_config_dir(interactive: bool) -> bool:
    """清理配置目录 ~/.tencent-cloudq/"""
    print(f"\n{bold('1. 配置目录')}")

    if not CONFIG_DIR.exists():
        print(f"  {dim('[-]')} {CONFIG_DIR}: {dim('不存在，跳过')}")
        return False

    # 列出目录内容
    files = list(CONFIG_DIR.iterdir())
    print(f"  路径: {CONFIG_DIR}")
    if files:
        for f in files:
            size = f.stat().st_size if f.is_file() else 0
            print(f"    - {f.name} ({size} bytes)")
    else:
        print(f"    {dim('(空目录)')}")

    if interactive and not confirm(f"\n  确认删除 {CONFIG_DIR} ?"):
        print(f"  {yellow('[SKIP]')} 用户跳过")
        return False

    return remove_dir(CONFIG_DIR, str(CONFIG_DIR))


def clean_cache_file(interactive: bool) -> bool:
    """清理临时缓存文件"""
    print(f"\n{bold('2. 临时缓存')}")

    if not CACHE_FILE.exists():
        print(f"  {dim('[-]')} {CACHE_FILE}: {dim('不存在，跳过')}")
        return False

    print(f"  路径: {CACHE_FILE}")
    try:
        size = CACHE_FILE.stat().st_size
        print(f"    - .tcloud_advisor_uin_cache ({size} bytes)")
    except OSError:
        pass

    if interactive and not confirm(f"\n  确认删除 {CACHE_FILE} ?"):
        print(f"  {yellow('[SKIP]')} 用户跳过")
        return False

    return remove_file(CACHE_FILE, str(CACHE_FILE))


def clean_env_vars(interactive: bool) -> bool:
    """清理智能顾问相关环境变量"""
    print(f"\n{bold('4. 环境变量')}")

    # 检测哪些环境变量当前已设置
    found = {}
    for var in ENV_VARS:
        val = os.environ.get(var, "")
        if val:
            found[var] = val

    if not found:
        print(f"  {dim('[-]')} 未检测到已设置的 TENCENTCLOUD_* 环境变量，跳过")
        return False

    # 显示已设置的变量（敏感值掩码）
    print(f"  检测到 {len(found)} 个已设置的环境变量:")
    for var, val in found.items():
        if "SECRET" in var or "TOKEN" in var or "KEY" in var:
            display = val[:4] + "****" + val[-4:] if len(val) > 8 else "****"
        else:
            display = val
        print(f"    - {var} = {display}")

    if interactive and not confirm(f"\n  确认清理以上 {len(found)} 个环境变量?"):
        print(f"  {yellow('[SKIP]')} 用户跳过")
        return False

    # 生成清理命令
    is_windows = platform.system() == "Windows"
    print()

    if is_windows:
        # Windows: 生成 PowerShell 脚本
        script_file = Path(tempfile.gettempdir()) / "cleanup_tencent_env.ps1"
        lines = ["# 腾讯云智能顾问 - 环境变量清理脚本 (PowerShell)",
                 "# 自动生成，执行后可删除此文件", ""]
        for var in found:
            lines.append(f'Remove-Item Env:\\{var} -ErrorAction SilentlyContinue')
            lines.append(f'Write-Host "  [OK] 已清除 {var}"')
        lines.append("")
        lines.append('Write-Host ""')
        lines.append(f'Write-Host "  已清理 {len(found)} 个环境变量（仅影响当前会话）"')

        script_file.write_text("\n".join(lines), encoding="utf-8")
        print(f"  已生成 PowerShell 清理脚本: {script_file}")
        print(f"  请在 PowerShell 中执行:")
        print(f"    . {script_file}")

    else:
        # Linux / macOS: 生成 source 脚本
        script_file = Path(tempfile.gettempdir()) / "cleanup_tencent_env.sh"
        lines = ["#!/bin/sh",
                 "# 腾讯云智能顾问 - 环境变量清理脚本",
                 "# 自动生成，执行后可删除此文件", ""]
        for var in found:
            lines.append(f'unset {var}')
            lines.append(f'echo "  [OK] 已清除 {var}"')
        lines.append("")
        lines.append('echo ""')
        lines.append(f'echo "  已清理 {len(found)} 个环境变量（仅影响当前会话）"')

        script_file.write_text("\n".join(lines), encoding="utf-8")
        try:
            os.chmod(str(script_file), 0o755)
        except OSError:
            pass
        print(f"  已生成清理脚本: {script_file}")
        print(f"  请在当前终端执行:")
        print(f"    source {script_file}")

    print()
    print(f"  {yellow('注意')}: 环境变量存在于 shell 进程中，Python 脚本无法直接修改父 shell。")
    print(f"         请执行上方命令完成清理（仅影响当前终端会话）。")
    print(f"         如果变量写在 ~/.bashrc、~/.zshrc 或系统环境中，请手动移除对应行。")

    return True


def clean_cloud_role(interactive: bool) -> bool:
    """删除云端 CAM 角色（可选）"""
    print(f"\n{bold('3. 云端 CAM 角色')}")

    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")

    if not secret_id or not secret_key:
        print(f"  {dim('[-]')} 未配置 AK/SK 环境变量，跳过云端角色清理")
        print(f"      如需删除云端角色，请设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY 后重试")
        return False

    # 加载 tcloud_api
    try:
        from tcloud_api import call_api
    except ImportError:
        print(f"  {red('[FAIL]')} 无法加载 tcloud_api 模块")
        return False

    # 检查角色是否存在
    print(f"  正在检查角色 {ROLE_NAME} ...")
    check_result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "GetRole", "2019-01-16",
        {"RoleName": ROLE_NAME},
    )

    if not check_result.get("success"):
        err_code = check_result.get("error", {}).get("code", "")
        if "NotFound" in err_code or "not exist" in check_result.get("error", {}).get("message", "").lower():
            print(f"  {dim('[-]')} 角色 {ROLE_NAME} 不存在，无需删除")
            return False
        else:
            print(f"  {red('[FAIL]')} 查询角色失败: {check_result.get('error', {}).get('message', '未知错误')}")
            return False

    role_data = check_result.get("data", {})
    role_id = role_data.get("RoleId", "unknown")
    description = role_data.get("Description", "无描述")
    print(f"  检测到角色:")
    print(f"    名称: {ROLE_NAME}")
    print(f"    ID:   {role_id}")
    print(f"    描述: {description}")

    if interactive and not confirm(f"\n  确认删除云端角色 {ROLE_NAME} ? (此操作不可恢复)"):
        print(f"  {yellow('[SKIP]')} 用户跳过")
        return False

    # 执行删除
    print(f"  正在删除角色 {ROLE_NAME} ...")
    delete_result = call_api(
        "cam", "cam.tencentcloudapi.com",
        "DeleteRole", "2019-01-16",
        {"RoleName": ROLE_NAME},
    )

    if delete_result.get("success"):
        print(f"  {green('[OK]')} 云端角色 {ROLE_NAME} 已删除")
        return True
    else:
        err_msg = delete_result.get("error", {}).get("message", "未知错误")
        print(f"  {red('[FAIL]')} 删除角色失败: {err_msg}")
        return False


# ============== 主流程 ==============
def main():
    args = set(sys.argv[1:])

    # 帮助信息
    if args & {"-h", "--help"}:
        print(__doc__)
        sys.exit(0)

    auto_mode = "--all" in args
    include_cloud = "--cloud" in args

    # 标题
    print(f"\n{'=' * 58}")
    print(f"  腾讯云智能顾问 - 配置清理")
    print(f"{'=' * 58}")

    # 显示当前配置摘要
    config = read_config()
    if config:
        print(f"\n当前配置:")
        print(f"  账号 UIN:  {config.get('accountUin', '未知')}")
        print(f"  角色名称:  {config.get('roleName', '未知')}")
        print(f"  角色 ARN:  {config.get('roleArn', '未知')}")
        print(f"  配置时间:  {config.get('configuredAt', '未知')}")

    interactive = not auto_mode

    if interactive:
        print(f"\n{dim('提示: 使用 --all 跳过确认，--cloud 同时删除云端角色')}")

    # 执行清理（注意：云端角色删除必须在环境变量清理之前，因为需要 AK/SK）
    results = []
    results.append(("配置目录", clean_config_dir(interactive)))
    results.append(("临时缓存", clean_cache_file(interactive)))

    if include_cloud:
        results.append(("云端角色", clean_cloud_role(interactive)))
    else:
        print(f"\n{bold('3. 云端 CAM 角色')}")
        print(f"  {dim('[-]')} 未指定 --cloud 参数，跳过云端角色清理")
        print(f"      如需同时删除云端角色，请添加 --cloud 参数")

    # 环境变量清理放在最后（云端角色删除可能需要用到 AK/SK）
    results.append(("环境变量", clean_env_vars(interactive)))

    # 汇总
    cleaned = sum(1 for _, ok in results if ok)
    total = len(results)

    print(f"\n{'=' * 58}")
    print(f"  清理完成: {cleaned}/{total} 项已清理")
    print(f"{'=' * 58}\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
