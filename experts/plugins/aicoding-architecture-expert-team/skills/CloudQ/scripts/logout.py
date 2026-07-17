#!/usr/bin/env python3
"""
CloudQ OAuth 登出脚本

清除本地 OAuth 凭证文件。

用法:
    python3 logout.py           # 交互式确认
    python3 logout.py --force   # 跳过确认直接清除
"""

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from credential_manager import CREDENTIAL_FILE, clear_credential  # noqa: E402


def main():
    force = "--force" in sys.argv

    if not CREDENTIAL_FILE.exists():
        print()
        print("  ℹ️  当前没有 OAuth 凭证，无需登出。")
        print()
        return

    if not force:
        print()
        print("  🦞 CloudQ 登出")
        print("  " + "─" * 36)
        print()
        print(f"  将清除凭证文件：{CREDENTIAL_FILE}")
        print()
        try:
            answer = input("  确认登出？(y/N) > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  已取消。")
            return
        if answer not in ("y", "yes"):
            print("  已取消。")
            return

    clear_credential()
    print()
    print("  ✅ 已清除 OAuth 凭证。")
    print()
    print("  如需重新登录：python3 scripts/login.py")
    print()


if __name__ == "__main__":
    main()
