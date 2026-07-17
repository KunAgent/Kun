#!/usr/bin/env python3
"""
腾讯云智能顾问 — 架构风险巡检数据拉取脚本 (Python 版)
自动通过 ArchId 获取最新 ResultId，然后从三个接口拉取数据并合并输出为 JSON

用法:
    python3 risk_fetch_data.py <ArchId>

输出:
    output/data_<ArchId>.json
"""

import json
import os
import sys
from pathlib import Path

# 兼容 Windows 中文环境（GBK 编码无法处理 Unicode 特殊字符）
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 将脚本所在目录加入 sys.path 以便导入 tcloud_api
SCRIPT_DIR = Path(__file__).resolve().parent
# 公用脚本目录（baseDir/scripts）
BASE_SCRIPTS_DIR = SCRIPT_DIR.parent.parent.parent.parent / "scripts"
sys.path.insert(0, str(BASE_SCRIPTS_DIR))
sys.path.insert(0, str(SCRIPT_DIR))

from tcloud_api import call_api as call_tcloud_api


def call_api(action: str, payload: str) -> dict:
    """调用智能顾问 API 并返回解析后的 dict"""
    result = call_tcloud_api(
        "advisor",
        "advisor.tencentcloudapi.com",
        action,
        "2020-07-21",
        payload,
    )
    # call_tcloud_api 返回的已经是 dict，直接返回
    if isinstance(result, dict):
        return result
    # 兼容字符串返回的情况
    try:
        return json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return {"success": False, "error": {"code": "ParseError", "message": "响应解析失败"}}


def safe_parse(result: dict, label: str) -> dict:
    """安全解析 API 返回结果"""
    if result.get("success"):
        return result.get("data", {})
    else:
        return {"_error": result.get("error", {"code": "Unknown", "message": "未知错误"})}


def main():
    # ============== 参数解析 ==============
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("❌ 缺少必要参数 ArchId")
        print("用法: python3 risk_fetch_data.py <ArchId>")
        print("示例: python3 risk_fetch_data.py arch-0ccs5932")
        sys.exit(1)

    arch_id = sys.argv[1]
    base_dir = SCRIPT_DIR.parent
    output_dir = base_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=== 腾讯云智能顾问 — 架构风险巡检数据拉取 ===")
    print(f"架构图ID: {arch_id}")
    print("")

    # ============== 0. 通过 ArchId 获取最新 ResultId ==============
    print("▶ [0/3] 获取最新报告ID (DescribeArchScanReportLastInfo)...")

    report_last_result = call_api(
        "DescribeArchScanReportLastInfo",
        json.dumps({"ArchId": arch_id})
    )

    if not report_last_result.get("success"):
        error = report_last_result.get("error", {})
        error_msg = f"[{error.get('code', 'Unknown')}] {error.get('message', '未知错误')}"
        print(f"  ❌ 获取最新报告ID失败: {error_msg}")
        print("")
        print("ERROR_TYPE=API_FAILED")
        print(f"ERROR_MSG={error_msg}")
        sys.exit(1)

    result_id = report_last_result.get("data", {}).get("ResultId", "")

    if not result_id:
        print("  ⚠️  该架构图尚未进行过巡检，无法获取报告数据")
        print("")
        print("ERROR_TYPE=NO_SCAN")
        print("ERROR_MSG=该架构图尚未进行过巡检，请前往腾讯云智能顾问控制台发起巡检")
        sys.exit(1)

    print(f"  ✅ 获取最新报告ID成功: {result_id}")

    # ============== 1. 获取巡检概览 ==============
    print("▶ [1/3] 拉取巡检概览信息 (DescribeArchScanOverviewInfo)...")

    overview_result = call_api(
        "DescribeArchScanOverviewInfo",
        json.dumps({"ArchId": arch_id, "ResultId": result_id})
    )

    if overview_result.get("success"):
        print("  ✅ 巡检概览获取成功")
    else:
        print("  ❌ 巡检概览获取失败")
        print(f"  {json.dumps(overview_result, ensure_ascii=False)}")

    # ============== 2. 获取风险趋势 ==============
    print("▶ [2/3] 拉取风险趋势信息 (DescribeArchRiskTrendInfo)...")

    risk_trend_result = call_api(
        "DescribeArchRiskTrendInfo",
        json.dumps({"ArchId": arch_id, "ResultId": result_id})
    )

    if risk_trend_result.get("success"):
        print("  ✅ 风险趋势获取成功")
    else:
        print("  ❌ 风险趋势获取失败")
        print(f"  {json.dumps(risk_trend_result, ensure_ascii=False)}")

    # ============== 3. 获取风险明细列表（分页获取全部数据） ==============
    print("▶ [3/3] 拉取风险明细列表 (DescribeScanPluginRiskTrendListInfo)...")

    page_limit = 200
    page_offset = 0
    all_items = []
    total_count = 0
    risk_list_success = False
    page_num = 0

    while True:
        page_num += 1
        risk_list_payload = json.dumps({
            "ArchId": arch_id,
            "Limit": page_limit,
            "Offset": page_offset,
            "SessionId": "",
        })
        risk_list_page = call_api("DescribeScanPluginRiskTrendListInfo", risk_list_payload)

        if not risk_list_page.get("success"):
            print(f"  ❌ 第{page_num}页获取失败 (Offset={page_offset})")
            if page_num == 1:
                risk_list_success = False
            break

        data = risk_list_page.get("data", {})
        items = data.get("RiskTrendInsInfoList", [])
        total_count = data.get("TotalCount", 0)

        all_items.extend(items)

        print(f"  📄 第{page_num}页: 获取 {len(items)} 条 (Offset={page_offset}, Total={total_count})")

        risk_list_success = True
        page_offset += page_limit

        # 如果已经获取完所有数据，退出循环
        if page_offset >= total_count:
            break

    # 将合并后的数据组装为与原始接口返回格式一致的 JSON
    if risk_list_success:
        risk_list_result = {
            "success": True,
            "data": {
                "RiskTrendInsInfoList": all_items,
                "TotalCount": len(all_items),
            }
        }
        print(f"  ✅ 风险明细列表获取成功，共 {len(all_items)}/{total_count} 条")
    else:
        risk_list_result = {"success": False, "error": {"code": "FetchFailed", "message": "风险明细列表获取失败"}}
        print("  ❌ 风险明细列表获取失败")

    # ============== 4. 合并数据并输出 ==============
    print("")
    print("▶ 合并数据...")

    output_file = output_dir / f"data_{arch_id}.json"

    merged = {
        "archId": arch_id,
        "resultId": result_id,
        "overview": safe_parse(overview_result, "overview"),
        "riskTrend": safe_parse(risk_trend_result, "riskTrend"),
        "riskList": safe_parse(risk_list_result, "riskList"),
    }

    try:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"✅ 数据已保存到: {output_file}")
    except Exception as e:
        print(f"❌ 数据合并失败: {e}")
        sys.exit(1)

    print("")
    print("=== 数据拉取完成 ===")


if __name__ == "__main__":
    main()
