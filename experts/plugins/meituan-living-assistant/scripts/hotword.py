#!/usr/bin/env python3
"""
热搜词查询脚本
根据城市 ID 获取当前热门搜索关键词

用法:
    python hotword.py --city-id "1"

输出:
    成功: {"success": true, "hotWords": ["麦当劳", "肯德基", "海底捞", ...]}
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
import urllib.parse

API_URL = "https://peppermall.meituan.com/api/product/search/consumer/hotword"


def get_hotwords(city_id: str) -> dict:
    params = urllib.parse.urlencode({"selectCityId": city_id})
    req = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
        },
        method="GET"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))

        code = resp_data.get("code")
        if code == 200:
            hot_words = [item["word"] for item in resp_data.get("data", {}).get("hotWord", [])]
            return {
                "success": True,
                "hotWords": hot_words
            }
        else:
            return {
                "success": False,
                "error": "API_ERROR",
                "code": code,
                "message": resp_data.get("message", "热搜词获取失败")
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
    parser = argparse.ArgumentParser(description="热搜词查询")
    parser.add_argument("--city-id", required=True, help="城市 ID（city_query.py 获取）")

    args = parser.parse_args()

    result = get_hotwords(city_id=args.city_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
