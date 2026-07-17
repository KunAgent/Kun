#!/usr/bin/env python3
"""
获取用户近期位置信息
用法: python3 get_user_recent_location.py --token <user_token>
返回: JSON，包含 cityId, cityName, lng, lat, formattedAddress
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))
import cliguard

import argparse
import json
import urllib.request
import urllib.error

API_URL = "https://click.meituan.com/cps/ai/product/getUserRecentLocation"


def get_user_recent_location(token: str) -> dict:
    body = {
        "token": token
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
            "token": token
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        print(json.dumps({"success": False, "error": f"HTTP {e.code}", "message": body_err}, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)

    if result.get("code") == 200 and result.get("success"):
        data = result.get("data", {})
        print(json.dumps({
            "success": True,
            "cityId": data.get("cityId"),
            "cityName": data.get("cityName"),
            "lng": data.get("lng"),
            "lat": data.get("lat"),
            "formattedAddress": data.get("formattedAddress"),
        }, ensure_ascii=False))
    else:
        print(json.dumps({
            "success": False,
            "error": result.get("message", "未知错误"),
            "code": result.get("code"),
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="获取用户近期位置信息")
    parser.add_argument("--token", required=True, help="用户 token")
    args = parser.parse_args()
    get_user_recent_location(args.token)
