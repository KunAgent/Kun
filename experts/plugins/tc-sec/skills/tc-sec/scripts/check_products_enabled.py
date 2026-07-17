"""
产品开通状态检测技能
检查 10 个腾讯云安全产品的开通/激活状态。
"""

import asyncio
import json
import logging
import os
import sys
import base

logger = logging.getLogger(__name__)

_TCCLI_SEMAPHORE = asyncio.Semaphore(10)
_TCCLI_CLI = base.tccli_cli_path()
_PY = base.python()

ALLOWED_ACTIONS = frozenset({
    # CWP
    "DescribeLicenseGeneral",
    # CFW
    "DescribeCfwInsStatus",
    # WAF
    "DescribeInstances",
    # TCSS
    "DescribePurchaseStateInfo",
    # BH
    "DescribeResources",
    # SSM
    "GetServiceStatus",
    # KMS
    "GetServiceStatus",
    # CDS
    "DescribeDbauditInstances",
    # CSIP
    "DescribePublicIpAssets",
})

# 产品 → (service, action, params)
_PRODUCT_APIS = {
    "CWP": ("cwp", "DescribeLicenseGeneral", {}),
    "CFW": ("cfw", "DescribeCfwInsStatus", {}),
    "WAF": ("waf", "DescribeInstances", {"Offset": 0, "Limit": 1, "FreeDelayFlag": 1}),
    "TCSS": ("tcss", "DescribePurchaseStateInfo", {}),
    "BH": ("bh", "DescribeResources", {"Offset": 0, "Limit": 1}),
    "SSM": ("ssm", "GetServiceStatus", {}),
    "KMS": ("kms", "GetServiceStatus", {}),
    "CDS": ("cds", "DescribeDbauditInstances", {"Offset": 0, "Limit": 1}),
    "CSIP": ("csip", "DescribePublicIpAssets", {"Filter": {"Limit": 1, "Offset": 0}}),
}

# CWP 分析共享 CWP 授权
_CWP_ANALYSIS_API = ("cwp", "DescribeLicenseGeneral", {})


async def _run_tccli(service: str, action: str, params: dict = None) -> dict:
    if action not in ALLOWED_ACTIONS:
        return {"Error": f"操作被拒绝: {action} 不在允许列表中"}

    async with _TCCLI_SEMAPHORE:
        cmd = [_PY, _TCCLI_CLI, service, action, "--output", "json"]
        if params:
            for k, v in params.items():
                if isinstance(v, (dict, list)):
                    cmd.extend([f"--{k}", json.dumps(v, ensure_ascii=False)])
                else:
                    cmd.extend([f"--{k}", str(v)])

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            output = stdout.decode("utf-8", errors="replace").strip()
            if not output:
                err_msg = stderr.decode("utf-8", errors="replace").strip()
                return {"Error": {"Code": "EmptyResponse", "Message": err_msg or "tccli 返回为空"}}
            return json.loads(output)
        except json.JSONDecodeError as e:
            return {"Error": {"Code": "JsonError", "Message": f"无法解析 JSON: {output[:200]} ({e})"}}
        except Exception as e:
            return {"Error": {"Code": "Exception", "Message": str(e)[:200]}}


def _has_error(result: dict) -> bool:
    return "Error" in result


def _check_cwp(result: dict) -> dict:
    not_expired = result.get("NotExpiredLicenseCnt", 0)
    total = result.get("LicenseCnt", 0)
    activated = not_expired > 0 or total > 0
    protect_type = result.get("ProtectType", "")
    return {
        "activated": activated,
        "product": "CWP",
        "version": protect_type,
        "detail": {
            "NotExpiredLicenseCnt": not_expired,
            "LicenseCnt": total,
            "FlagshipVersionLicenseCnt": result.get("FlagshipVersionLicenseCnt", 0),
            "ProVersionLicenseCnt": result.get("ProVersionLicenseCnt", 0),
            "CwpVersionLicenseCnt": result.get("CwpVersionLicenseCnt", 0),
        },
    }


def _check_cfw(result: dict) -> dict:
    status_list = result.get("CfwInsStatus", [])
    total = result.get("TotalCount", 0)
    activated = total > 0 or len(status_list) > 0
    return {
        "activated": activated,
        "product": "CFW",
        "detail": {
            "TotalCount": total,
            "Instances": [{"Name": i.get("CfwInsName"), "Type": i.get("FwType"), "Status": i.get("Status")} for i in status_list],
        },
    }


def _check_waf(result: dict) -> dict:
    total = result.get("Total", 0)
    instances = result.get("Instances", [])
    activated = total > 0 or len(instances) > 0
    return {
        "activated": activated,
        "product": "WAF",
        "detail": {
            "Total": total,
            "Editions": [i.get("Edition", "?") for i in instances],
        },
    }


def _check_tcss(result: dict) -> dict:
    state = result.get("State", 0)
    state_map = {0: "未购买", 1: "待购买", 2: "试用中", 3: "专业版", 4: "已过期"}
    activated = state in (2, 3)
    return {
        "activated": activated,
        "product": "TCSS",
        "version": state_map.get(state, f"未知({state})"),
        "detail": {
            "State": state,
            "CoresCnt": result.get("CoresCnt", 0),
            "ExpirationTime": result.get("ExpirationTime", ""),
        },
    }


def _check_bh(result: dict) -> dict:
    resources = result.get("ResourceSet", [])
    total = result.get("TotalCount", 0)
    activated = total > 0 or len(resources) > 0
    return {
        "activated": activated,
        "product": "BH",
        "detail": {"TotalCount": total},
    }


def _check_ssm(result: dict) -> dict:
    enabled = result.get("ServiceEnabled", False)
    invalid_type = result.get("InvalidType", 0)
    return {
        "activated": enabled,
        "product": "SSM",
        "detail": {"ServiceEnabled": enabled, "InvalidType": invalid_type},
    }


def _check_kms(result: dict) -> dict:
    enabled = result.get("ServiceEnabled", False)
    invalid_type = result.get("InvalidType", 0)
    subscription = result.get("SubscriptionInfo", "")
    return {
        "activated": enabled,
        "product": "KMS",
        "detail": {"ServiceEnabled": enabled, "InvalidType": invalid_type, "SubscriptionInfo": subscription},
    }


def _check_cds(result: dict) -> dict:
    total = result.get("TotalCount", 0)
    instances = result.get("Instances", result.get("CdsAuditInstanceSet", []))
    activated = total > 0 or len(instances) > 0
    return {
        "activated": activated,
        "product": "CDS",
        "detail": {"TotalCount": total},
    }


def _check_csip(result: dict) -> dict:
    data = result.get("Data", [])
    total = result.get("TotalCount", len(data))
    activated = total > 0 or len(data) > 0
    return {
        "activated": activated,
        "product": "CSIP",
        "detail": {"TotalCount": total, "Assets": len(data)},
    }


_CHECKERS = {
    "CWP": _check_cwp,
    "CFW": _check_cfw,
    "WAF": _check_waf,
    "TCSS": _check_tcss,
    "BH": _check_bh,
    "SSM": _check_ssm,
    "KMS": _check_kms,
    "CDS": _check_cds,
    "CSIP": _check_csip,
}


async def check_product_activated(product: str = "all") -> dict:
    """
    检查产品开通状态

    Args:
        product: 产品名或 "all"。支持: CWP, CWP-Analysis, CFW, WAF, TCSS, BH, SSM, KMS, CDS, CSIP, all

    Returns:
        单产品时返回该产品的检测结果；all 时返回汇总。
        每个产品返回:
        {
            "product": "XXX",
            "activated": true/false/None,
            "version": "...",     # 可选，版本信息
            "detail": {...},       # 详细字段
            "error": "..."         # 仅在无法判断时
        }
    """
    product = product.strip()

    if product.lower() == "all":
        return await check_all_products()

    # CWP-Analysis 共享 CWP 授权
    if product in ("CWP-Analysis", "CWP-分析"):
        return await _check_single("CWP-Analysis", *_CWP_ANALYSIS_API, _check_cwp)

    if product not in _PRODUCT_APIS:
        available = ", ".join(sorted(list(_PRODUCT_APIS.keys()) + ["CWP-Analysis"]))
        return {"error": f"未知产品: {product}。支持的产品: {available}"}

    svc, action, params = _PRODUCT_APIS[product]
    checker = _CHECKERS[product]
    return await _check_single(product, svc, action, params, checker)


async def _check_single(product: str, service: str, action: str, params: dict, checker) -> dict:
    result = await _run_tccli(service, action, params if params else None)

    if _has_error(result):
        err = result["Error"]
        if isinstance(err, dict):
            code = err.get("Code", "")
            msg = err.get("Message", str(err))
            # CAM 权限不足也算 API 可达，但无法判断开通状态
            if "Unauthorized" in code or "Unauthorized" in msg:
                return {
                    "product": product,
                    "activated": None,
                    "error": f"无CAM权限({code})，无法判断开通状态",
                }
        else:
            msg = str(err)
        return {"product": product, "activated": None, "error": str(msg)[:300]}

    info = checker(result)
    info["product"] = product
    return info


async def check_all_products() -> dict:
    """
    检查全部 10 个产品的开通状态

    Returns:
        {
            "products": [
                {"product": "CWP", "activated": true, ...},
                ...
            ],
            "summary": {
                "activated": ["CWP", "CFW", ...],
                "not_activated": ["WAF", "BH", ...],
                "unknown": ["SSM", ...],
            }
        }
    """
    products_to_check = list(_PRODUCT_APIS.keys())

    tasks = []
    for p in products_to_check:
        tasks.append(check_product_activated(p))

    results = await asyncio.gather(*tasks)

    activated = []
    not_activated = []
    unknown = []

    for r in results:
        if r.get("activated") is True:
            activated.append(r["product"])
        elif r.get("activated") is False:
            not_activated.append(r["product"])
        else:
            unknown.append(r["product"])

    return {
        "products": results,
        "summary": {
            "activated": activated,
            "not_activated": not_activated,
            "unknown": unknown,
        },
    }


# ============================================================
# CLI 入口
# ============================================================

def _print_results(data: dict):
    """格式化输出结果"""
    if "products" in data:
        # all 模式
        for r in data["products"]:
            _print_single(r)
        print()
        s = data["summary"]
        print(f"汇总: ✅已开通({len(s['activated'])}): {', '.join(s['activated']) or '无'}")
        print(f"      ❌未开通({len(s['not_activated'])}): {', '.join(s['not_activated']) or '无'}")
        if s["unknown"]:
            print(f"      ⚠️无法判断({len(s['unknown'])}): {', '.join(s['unknown'])}")
    else:
        _print_single(data)


def _print_single(r: dict):
    p = r.get("product", "?")
    activated = r.get("activated")
    detail = r.get("detail", {})
    version = r.get("version", "")
    error = r.get("error", "")

    if activated is True:
        status = "✅ 已开通"
        extra = f" [{version}]" if version else ""
    elif activated is False:
        status = "❌ 未开通"
        extra = ""
    else:
        status = "⚠️ 无法判断"
        extra = f" ({error})"

    detail_str = ", ".join(f"{k}={v}" for k, v in detail.items()) if detail else ""
    line = f"  {p:<15} {status}{extra}"
    if detail_str:
        line += f"  ({detail_str})"
    print(line)


if __name__ == "__main__":
    import sys
    import json as _json

    args = [a for a in sys.argv[1:] if a]
    json_mode = "--json" in args
    args = [a for a in args if a != "--json"]
    product = args[0] if args else "all"

    async def main():
        result = await check_product_activated(product)
        if json_mode:
            print(_json.dumps(result, ensure_ascii=False))
        else:
            _print_results(result)

    asyncio.run(main())
