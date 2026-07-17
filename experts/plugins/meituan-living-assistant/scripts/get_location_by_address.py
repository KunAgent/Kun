#!/usr/bin/env python3
"""
根据地址获取位置信息（经纬度 + 城市ID）
用法: python3 get_location_by_address.py --address <地址，需带城市名>
返回: JSON，包含 cityId, lng, lat
"""

import argparse
import json
import sys
import urllib.request
import urllib.error

API_URL = "https://click.meituan.com/cps/ai/product/getLocationByAddress"


def get_location_by_address(address: str) -> dict:
    payload = json.dumps({"address": address}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(json.dumps({"success": False, "error": f"HTTP {e.code}", "message": body}, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)

    if result.get("code") == 200 and result.get("success"):
        data = result.get("data", {})
        print(json.dumps({
            "success": True,
            "cityId": data.get("cityId"),
            "lng": data.get("lng"),
            "lat": data.get("lat"),
        }, ensure_ascii=False))
    else:
        print(json.dumps({
            "success": False,
            "error": result.get("message", "未知错误"),
            "code": result.get("code"),
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="根据地址获取位置信息")
    parser.add_argument("--address", required=True, help="地理位置，需带城市名，如「北京市望京恒电大厦」")
    args = parser.parse_args()
    get_location_by_address(args.address)
