#!/usr/bin/env python3
"""sc_grep - ripgrep (rg) 跨平台统一入口。
参数与 rg 完全一致，直接透传所有参数给 rg。
若系统未安装 rg，自动通过 pip 安装 pyripgrep 或提示安装方式。"""

import sys
import os
import subprocess
import base


def find_rg():
    """查找 rg 可执行文件路径"""
    rg = base.which("rg")
    if rg:
        return rg

    # 检查 pip 安装的 ripgrep-bin
    try:
        import ripgrep
        rg_path = ripgrep.get_rg_path()
        if os.path.isfile(rg_path):
            return rg_path
    except (ImportError, AttributeError):
        pass

    return None


def install_rg():
    """尝试通过 pip 安装 ripgrep"""
    print("ripgrep (rg) not found. Installing via pip...", file=sys.stderr)
    try:
        subprocess.check_call(
            [base.python(), "-m", "pip", "install", "ripgrep", "--quiet"],
            stdout=subprocess.DEVNULL,
        )
        import ripgrep
        return ripgrep.get_rg_path()
    except Exception:
        pass
    return None


def main():
    rg = find_rg()

    if not rg:
        rg = install_rg()

    if not rg:
        print(
            "error: ripgrep (rg) is required but not found.\n"
            "Install options:\n"
            "  macOS:   brew install ripgrep\n"
            "  Ubuntu:  apt install ripgrep\n"
            "  Windows: scoop install ripgrep\n"
            "  pip:     pip install ripgrep\n"
            "  cargo:   cargo install ripgrep",
            file=sys.stderr,
        )
        sys.exit(127)

    # 透传所有参数给 rg
    result = subprocess.run([rg] + sys.argv[1:])
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
