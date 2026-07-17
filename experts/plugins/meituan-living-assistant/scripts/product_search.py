#!/usr/bin/env python3
"""
到餐商品搜索脚本
根据关键词、位置、城市 ID 搜索附近团购商品

用法:
    python product_search.py \
        --keyword "麦当劳" \
        --lat "39.968767" \
        --lng "116.375727" \
        --token "<user_token>" \
        --city-id "1" \
        [--page 1] \
        [--page-size 5]

输出:
    成功: {"success": true, "productList": [...], "isLastPage": false, "queryId": "..."}
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

API_URL = "https://click.meituan.com/cps/ai/product/searchProductByAgent"


def parse_distance_km(distance_text: str) -> float:
    """将 distanceText（如 '2.7km'、'358m'）转换为 km 浮点数，解析失败返回 999。"""
    try:
        text = distance_text.strip().lower()
        if text.endswith('km'):
            return float(text[:-2])
        elif text.endswith('m'):
            return float(text[:-1]) / 1000
    except Exception:
        pass
    return 999.0


def search_products(keyword: str, lat: str, lng: str, token: str,
                    city_id: str, page: int = 1, page_size: int = 10,
                    query_id: str = "", request_id: str = "",
                    max_distance_km: float = 8.0) -> dict:
    body = {
        "keyword": keyword,
        "page": page,
        "pageSize": str(page_size),
        "clientSource": "coupon-fusion-workbuddy",
        "userParamDTO": {
            "lat": lat,
            "lng": lng,
            "token": token,
            "cityId": city_id,
            "app": 216,
            "platform": 1,
            "partner": 1018
        }
    }
    # 翻页时带上上一页返回的 queryId 和 requestId
    if query_id:
        body["queryId"] = query_id
    if request_id:
        body["requestId"] = request_id

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
            "token": token
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))

        code = resp_data.get("code")
        if code == 200 and resp_data.get("success"):
            data_block = resp_data.get("data", {})
            product_list = data_block.get("productList", [])
            for item in product_list:
                if "productId" in item:
                    item["productId"] = str(item["productId"])
                if "poiId" in item:
                    item["poiId"] = str(item["poiId"])
            # 按距离过滤，超出 max_distance_km 的商品不展示
            product_list = [
                item for item in product_list
                if parse_distance_km(item.get("distanceText", "")) <= max_distance_km
            ]
            # 过滤后重新编号，确保序号连续（从 1 开始）
            for idx, item in enumerate(product_list, start=1):
                item["index"] = idx
            return {
                "success": True,
                "productList": product_list,
                "isLastPage": data_block.get("isLastPage", True),
                "queryId": str(data_block.get("queryId", "")),
                "requestId": str(data_block.get("requestId", "")),
                "page": page,
                "pageSize": page_size
            }
        else:
            return {
                "success": False,
                "error": "API_ERROR",
                "code": code,
                "message": resp_data.get("message", "搜索失败")
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
    parser = argparse.ArgumentParser(description="到餐商品搜索")
    parser.add_argument("--keyword",   required=True,  help="搜索关键词（商品名或门店名）")
    parser.add_argument("--lat",       required=True,  help="纬度（geo_query.py 返回的第二个值）")
    parser.add_argument("--lng",       required=True,  help="经度（geo_query.py 返回的第一个值）")
    parser.add_argument("--token",     required=True,  help="用户 token（auth.py token-verify 获取）")
    parser.add_argument("--city-id",   required=True,  help="城市 ID（city_query.py 获取）")
    parser.add_argument("--page",       type=int, default=1, help="页码，默认 1")
    parser.add_argument("--page-size",  type=int, default=10, help="每页条数，默认 10")
    parser.add_argument("--query-id",   default="", help="上一页返回的 queryId，翻页时传入")
    parser.add_argument("--request-id", default="", help="上一页返回的 requestId，翻页时传入")
    parser.add_argument("--max-distance-km", type=float, default=8.0, help="距离过滤上限（km），默认 8.0")

    args = parser.parse_args()

    result = search_products(
        keyword=args.keyword,
        lat=args.lat,
        lng=args.lng,
        token=args.token,
        city_id=args.city_id,
        page=args.page,
        page_size=args.page_size,
        query_id=args.query_id,
        request_id=args.request_id,
        max_distance_km=args.max_distance_km
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
