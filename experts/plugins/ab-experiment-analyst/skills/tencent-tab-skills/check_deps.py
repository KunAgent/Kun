#!/usr/bin/env python3
"""
check_deps.py - 检查并安装所需依赖
- Python 库：requests
- CLI 工具：mcporter（npm 全局安装）

输出规范（适合 agent 读取）：
  stderr  过程日志（每步状态）
  stdout  最终 JSON 结果
"""

import importlib
import json
import shutil
import subprocess
import sys


def _log(msg: str) -> None:
    """过程日志输出到 stderr，不干扰 stdout 的结构化结果。"""
    print(f"[check_deps] {msg}", file=sys.stderr)


def check_python_package(package: str) -> bool:
    """检查 Python 包是否已安装"""
    try:
        importlib.import_module(package)
        return True
    except ImportError:
        return False


def install_python_package(package: str) -> bool:
    """通过 pip 安装 Python 包"""
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", package],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _log(f"pip 安装 {package} 失败: {result.stderr.strip()}")
    return result.returncode == 0


def check_cli_tool(tool: str) -> bool:
    """检查 CLI 工具是否在 PATH 中"""
    return shutil.which(tool) is not None


def install_npm_package(package: str) -> bool:
    """通过 npm 全局安装包"""
    result = subprocess.run(
        ["npm", "install", "-g", package],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        _log(f"npm 安装 {package} 失败: {result.stderr.strip()}")
    return result.returncode == 0


def main():
    failures = {}
    installed = {}
    all_ok = True

    # ── Python 依赖 ──────────────────────────────────
    python_packages = ["requests"]
    for pkg in python_packages:
        if check_python_package(pkg):
            _log(f"{pkg} 已安装")
        else:
            _log(f"{pkg} 未安装，尝试安装...")
            if install_python_package(pkg):
                _log(f"{pkg} 安装成功")
                installed[f"python:{pkg}"] = "installed"
            else:
                _log(f"{pkg} 安装失败，请手动执行: pip3 install {pkg}")
                failures[f"python:{pkg}"] = "failed"
                all_ok = False

    # ── CLI 工具 ─────────────────────────────────────
    npm_tools = ["mcporter"]
    for tool in npm_tools:
        if check_cli_tool(tool):
            _log(f"{tool} 已安装")
        else:
            _log(f"{tool} 未安装，尝试通过 npm 安装...")
            if install_npm_package(tool):
                _log(f"{tool} 安装成功")
                installed[f"cli:{tool}"] = "installed"
            else:
                _log(f"{tool} 安装失败，请手动执行: npm install -g {tool}")
                failures[f"cli:{tool}"] = "failed"
                all_ok = False

    # ── 最终结果输出到 stdout（JSON，供 agent 读取） ──
    # all_ok 时只输出简洁状态；有异常时才附带详情，避免冗余
    if all_ok:
        result = {"all_ok": True}
        if installed:
            result["installed"] = installed  # 新安装的包值得告知 agent
    else:
        result = {"all_ok": False, "failures": failures}
        if installed:
            result["installed"] = installed

    print(json.dumps(result, ensure_ascii=False))

    if not all_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
