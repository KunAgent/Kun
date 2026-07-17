#!/usr/bin/env python3
"""
校验用户是否已在美团微信小程序授权登录

用法:
    python check_login.py --token "<user_token>"

注意: 此脚本由 run.js check-login 子命令调用，token 由 run.js 内部获取后传入。
     不应直接从命令行手动调用。

输出:
    成功: {"success": true, "logged": true/false}
    失败: {"success": false, "error": "...", "message": "..."}
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))
import cliguard

import argparse
import json
import urllib.request
import urllib.error

API_URL = "https://click.meituan.com/cps/ai/product/checkLoginMtMiniProgram"


def check_login(token: str) -> dict:
    body = {
        "clientSource": "coupon-fusion-workbuddy",
        "userParamDTO": {
            "token": token
        }
    }

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))

        code = resp_data.get("code")
        if code == 200 and resp_data.get("success"):
            # data=true 表示已登录, data=false 表示未登录
            logged = bool(resp_data.get("data"))
            return {
                "success": True,
                "logged": logged
            }
        else:
            return {
                "success": False,
                "error": "API_ERROR",
                "code": code,
                "message": resp_data.get("message", "校验失败")
            }

    except urllib.error.HTTPError as e:
        return {
            "success": False,
            "error": "HTTP_ERROR",
            "message": f"HTTP {e.code}: {e.reason}"
        }
    except urllib.error.URLError as e:
        return {
            "success": False,
            "error": "NETWORK_ERROR",
            "message": str(e.reason)
        }
    except Exception as e:
        return {
            "success": False,
            "error": "UNKNOWN_ERROR",
            "message": str(e)
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="校验美团微信小程序登录状态")
    parser.add_argument("--token", required=True, help="用户 token")

    args = parser.parse_args()
    result = check_login(token=args.token)
    print(json.dumps(result, ensure_ascii=False, indent=2))
