#!/usr/bin/env python3
"""
到餐商品下单脚本
根据商品 ID、门店 ID、用户参数发起下单，返回订单号和支付二维码

用法:
    python order.py \
        --product-id 123 \
        --poi-id 123 \
        --token "<user_token>" \
        --city-id "1" \
        --uuid "<device_token>" \
        [--quantity 1]

输出:
    成功: {"success": true, "orderId": "...", "payShortLink": "..."}
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

API_URL = "https://click.meituan.com/cps/ai/product/orderByAgent"


def place_order(product_id: str, poi_id: str, token: str,
                city_id: str, uuid: str, lat: str = "", lng: str = "",
                quantity: int = 1, client_type: str = "") -> dict:
    body = {
        "productId": str(product_id),
        "poiId": str(poi_id),
        "quantity": quantity,
        "clientSource": "coupon-fusion-workbuddy",
        "clientType": client_type,
        "userParamDTO": {
            "token": token,
            "cityId": city_id,
            "uuid": uuid,
            "lat": lat,
            "lng": lng,
            "app": 216,
            "platform": 1,
            "partner": 1018
        }
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
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))

        code = resp_data.get("code")
        if code == 200 and resp_data.get("success"):
            data_block = resp_data.get("data", {})
            return {
                "success": True,
                "orderId": str(data_block.get("orderId", "")),
                "payShortLink": data_block.get("payShortLink", ""),
                "payQrCodeImage": data_block.get("payUrlQrCode", ""),
                "WeixinPay-Required": data_block.get("wxPaymentCode") or ""
            }
        else:
            return {
                "success": False,
                "error": "API_ERROR",
                "code": code,
                "message": resp_data.get("message", "下单失败")
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
    parser = argparse.ArgumentParser(description="到餐商品下单")
    parser.add_argument("--product-id", type=str, required=True, help="商品 ID（搜索结果中的 productId）")
    parser.add_argument("--poi-id",     type=str, required=True, help="门店 ID（搜索结果中的 poiId）")
    parser.add_argument("--token",      required=True,           help="用户 token（auth.py token-verify 获取）")
    parser.add_argument("--city-id",    required=True,           help="城市 ID（city_query.py 获取）")
    parser.add_argument("--uuid",       required=True,           help="设备 ID（auth.py token-verify 获取的 device_token）")
    parser.add_argument("--lat",        default="",              help="纬度")
    parser.add_argument("--lng",        default="",              help="经度")
    parser.add_argument("--quantity",   type=int, default=1,     help="购买数量，默认 1")
    parser.add_argument("--client-type", default="",              help="客户端类型（mac/windows/miniprogram）")

    args = parser.parse_args()

    result = place_order(
        product_id=args.product_id,
        poi_id=args.poi_id,
        token=args.token,
        city_id=args.city_id,
        uuid=args.uuid,
        lat=args.lat,
        lng=args.lng,
        quantity=args.quantity,
        client_type=args.client_type
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
