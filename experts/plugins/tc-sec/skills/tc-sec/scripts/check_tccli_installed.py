#!/usr/bin/env python3
"""Check if tccli is installed and credentials are configured."""

import subprocess
import sys
import json
import os
import base


def check_tccli_installed():
    """Check if tccli command is available."""
    return base.tccli() is not None


def check_credentials_configured():
    """Check if tccli credentials are configured by reading the credential file directly."""
    credential_path = os.path.join(base.real_home(), ".tccli", "default.credential")

    # Method 1: Check credential file directly (more reliable)
    if os.path.exists(credential_path):
        try:
            with open(credential_path, "r") as f:
                content = f.read().strip()
            if not content:
                return False, "Credential file is empty"
            data = json.loads(content)
            secret_id = data.get("secretId", "")
            secret_key = data.get("secretKey", "")
            if secret_id and secret_key:
                return True, ""
            return False, "SecretId or SecretKey is empty in credential file"
        except json.JSONDecodeError:
            return False, "Credential file is not valid JSON"
        except Exception as e:
            return False, f"Error reading credential file: {e}"
    else:
        # Method 2: Fallback to tccli configure list
        try:
            result = subprocess.run(
                ["tccli", "configure", "list"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            output = result.stdout
            if "secretId" in output or "SecretId" in output:
                for line in output.splitlines():
                    if "secretid" in line.lower():
                        parts = line.split()
                        value = parts[-1] if parts else ""
                        if value and value not in ("None", "", "null"):
                            return True, ""
            return False, "No credential information found"
        except subprocess.TimeoutExpired:
            return False, "tccli configure list timed out"
        except Exception as e:
            return False, f"Error checking credentials: {e}"


def main():
    auto_installed = False
    if not check_tccli_installed():
        # 未安装则自动执行 pip install tccli（代码逻辑安装，非仅提示）。
        ok, msg = base.ensure_tccli_installed()
        auto_installed = True
        if not ok:
            print(
                json.dumps({
                    "status": "not_installed",
                    "auto_installed": False,
                    "message": (
                        "已尝试自动执行 pip install tccli 但未能完成安装。"
                        f"{msg} 完成后请重新运行检查。"
                    ),
                }, ensure_ascii=False)
            )
            sys.exit(2)
    creds_ok, err_msg = check_credentials_configured()
    if not creds_ok:
        print(
            json.dumps({
                "status": "no_credentials",
                "auto_installed": auto_installed,
                "message": f"tccli credentials not configured. {err_msg}. Please run: tccli configure",
            }, ensure_ascii=False)
        )
        sys.exit(2)

    print(
        json.dumps({
            "status": "ok",
            "auto_installed": auto_installed,
            "message": "tccli is installed and credentials are configured"
                       + ("（本次已自动执行 pip install tccli 完成安装）" if auto_installed else ""),
        }, ensure_ascii=False)
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
