#!/usr/bin/env python3
"""
Datalab Knowledge Analyst API 统一调用脚本 v2.1.0
===================================================
用途：替代 Agent 自己拼 curl/requests 代码，所有 API 调用通过此脚本完成。
调用方式：python call_api.py <action> [--参数 值]

支持的 action:
  report_log          - 日志上报（静默，Agent 内部行为）
  search_game         - 业务名称模糊搜索
  dashboard_list      - 报表列表
  dashboard_search    - 报表搜索
  dashboard_overview  - 获取报表概览
  chart_data          - 获取单图表数据
  dashboard_data      - 获取全量报表数据
  knot_search         - 通过 Datalab 后端代理调 Knot MCP 知识库搜索（需要 game_code）
  full_report         - 【组合】report_log + dashboard_overview + dashboard_data 一次完成

环境变量：
  DATABRAIN_TOKEN        - 认证 token（不含 Bearer 前缀）
  DATABRAIN_HOST         - API 主机地址
  DATABRAIN_DISPLAY_HOST - 系统链接展示域名（可选）
"""

import argparse
import json
import os
import sys
import time
from urllib.parse import urlparse, parse_qs

# ============================================================
# 配置
# ============================================================
TOKEN = os.environ.get("DATABRAIN_TOKEN", "")
HOST = os.environ.get("DATABRAIN_HOST", "")
DISPLAY_HOST = os.environ.get("DATABRAIN_DISPLAY_HOST", "")

TIMEOUT_DEFAULT = 30
TIMEOUT_DASHBOARD_DATA = 90
TIMEOUT_CHART_DATA = 60

SKILL_API_PREFIX = "/api/v1/datalab/skill"

# ============================================================
# HTTP 客户端（使用 requests 库，禁止 curl/subprocess）
# ============================================================
try:
    import requests
except ImportError:
    print("[ERROR] requests 库未安装，请先 pip install requests", file=sys.stderr)
    sys.exit(1)


def _headers():
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}",
    }


def _post(endpoint: str, payload: dict, timeout: int = TIMEOUT_DEFAULT) -> dict:
    """统一 POST 请求，带计时和错误处理"""
    url = f"{HOST}{endpoint}"
    t0 = time.time()
    try:
        r = requests.post(url, headers=_headers(), json=payload, timeout=timeout)
        elapsed_ms = (time.time() - t0) * 1000
        timing = {
            "url": endpoint,
            "status_code": r.status_code,
            "elapsed_ms": round(elapsed_ms, 1),
        }
        # HTTP 4xx/5xx 时，尝试解析响应但标记为错误
        if r.status_code >= 400:
            try:
                result = r.json()
            except Exception:
                result = {}
            result["_http_error"] = True
            result["_http_status"] = r.status_code
            result["_http_reason"] = r.reason
            # 如果响应体中 code==0 但 HTTP 状态码是错误的，覆盖 code 为 -1
            if result.get("code") == 0:
                result["code"] = -1
                result["msg"] = result.get("msg", "") or f"HTTP {r.status_code} {r.reason}"
            result["_timing"] = timing
            return result
        try:
            result = r.json()
        except (ValueError, json.JSONDecodeError):
            return {
                "code": -1,
                "msg": f"响应非 JSON 格式（HTTP {r.status_code}），前 200 字符: {r.text[:200]}",
                "_timing": timing,
            }
        result["_timing"] = timing
        return result
    except requests.exceptions.Timeout:
        elapsed_ms = (time.time() - t0) * 1000
        return {
            "code": -1,
            "msg": f"请求超时（{timeout}s）",
            "_timing": {"url": endpoint, "status_code": 0, "elapsed_ms": round(elapsed_ms, 1)},
        }
    except requests.exceptions.ConnectionError:
        elapsed_ms = (time.time() - t0) * 1000
        return {
            "code": -1,
            "msg": f"连接失败，请检查 DATABRAIN_HOST ({HOST}) 是否可达",
            "_timing": {"url": endpoint, "status_code": 0, "elapsed_ms": round(elapsed_ms, 1)},
        }
    except Exception as e:
        elapsed_ms = (time.time() - t0) * 1000
        return {
            "code": -1,
            "msg": f"请求异常: {str(e)}",
            "_timing": {"url": endpoint, "status_code": 0, "elapsed_ms": round(elapsed_ms, 1)},
        }


# ============================================================
# 图表引用解析工具（报表id@图表id 格式）
# ============================================================
def parse_chart_refs(refs: list) -> dict:
    """
    解析 '报表id@图表id' 格式的引用列表，提取 dashboard_id 和 chart_ids 的映射关系。

    参数:
        refs: 字符串列表，每个元素格式为 'dashboard_id@chart_id'
              - 支持 'dashboard_id@chart_id'（标准格式）
              - 支持纯 'chart_id'（无 @ 分隔符，此时 dashboard_id 为空，需要额外提供）

    返回:
        {
            "groups": [
                {
                    "dashboard_id": "报表ID",
                    "chart_ids": ["图表ID1", "图表ID2", ...]
                },
                ...
            ],
            "errors": ["格式错误的引用..."]  // 如果有解析失败的项
        }

    示例:
        parse_chart_refs(["abc123@chart1", "abc123@chart2", "def456@chart3"])
        => {
            "groups": [
                {"dashboard_id": "abc123", "chart_ids": ["chart1", "chart2"]},
                {"dashboard_id": "def456", "chart_ids": ["chart3"]}
            ],
            "errors": []
        }
    """
    from collections import OrderedDict

    groups = OrderedDict()  # dashboard_id -> list of chart_ids
    errors = []

    for ref in refs:
        ref = ref.strip()
        if not ref:
            continue

        if "@" in ref:
            parts = ref.split("@", 1)  # 只按第一个 @ 分割
            dashboard_id = parts[0].strip()
            chart_id = parts[1].strip()
            if not dashboard_id or not chart_id:
                errors.append(f"格式不完整: '{ref}'（@ 两侧不能为空）")
                continue
            if dashboard_id not in groups:
                groups[dashboard_id] = []
            groups[dashboard_id].append(chart_id)
        else:
            # 纯 chart_id（无 @），归入空 dashboard_id 组
            if "" not in groups:
                groups[""] = []
            groups[""].append(ref)

    result_groups = []
    for dashboard_id, chart_ids in groups.items():
        result_groups.append({
            "dashboard_id": dashboard_id,
            "chart_ids": chart_ids,
        })

    return {
        "groups": result_groups,
        "errors": errors,
    }


# ============================================================
# URL 解析工具
# ============================================================
def parse_dashboard_url(url: str) -> dict:
    """从 URL 中提取 dashboard_id 和 game_code"""
    result = {"dashboard_id": None, "game_code": None, "host": None}
    try:
        parsed = urlparse(url)
        result["host"] = f"{parsed.scheme}://{parsed.netloc}"
        # 从 query string 提取 dashboardId
        qs = parse_qs(parsed.query)
        if "dashboardId" in qs:
            result["dashboard_id"] = qs["dashboardId"][0]
        # 从路径提取 game_code: /v2/datalab/{game_code}/...  或 /v2/dashboard/game/{game_code}/...
        parts = parsed.path.strip("/").split("/")
        if "game" in parts:
            idx = parts.index("game")
            if idx + 1 < len(parts):
                result["game_code"] = parts[idx + 1]
        elif "datalab" in parts:
            idx = parts.index("datalab")
            if idx + 1 < len(parts):
                result["game_code"] = parts[idx + 1]
    except Exception:
        pass
    return result


# ============================================================
# 各 API Action 实现
# ============================================================
def action_report_log(args):
    """日志上报（静默，Agent 内部行为，不要向用户提及）"""
    payload = {
        "question": args.question or "",
        "dashboard_id": getattr(args, "dashboard_id", "") or "",
        "game_code": getattr(args, "game_code", "") or "",
        "log_api_host": HOST,
    }
    result = _post(f"{SKILL_API_PREFIX}/report_log", payload)
    return result


def action_search_game(args):
    """业务名称模糊搜索"""
    payload = {"game_name": args.game_name}
    if args.top:
        payload["top"] = args.top
    result = _post(f"{SKILL_API_PREFIX}/search_game", payload)
    return result


def action_dashboard_list(args):
    """查询业务下的报表列表"""
    payload = {"game_code": args.game_code}
    if args.category:
        payload["category"] = args.category
    if args.page:
        payload["page"] = args.page
    if args.page_size:
        payload["page_size"] = args.page_size
    result = _post(f"{SKILL_API_PREFIX}/dashboard_list", payload)
    return result


def action_dashboard_search(args):
    """按关键词搜索报表"""
    payload = {}
    if args.game_code:
        payload["game_code"] = args.game_code
    if args.keyword:
        payload["keyword"] = args.keyword
    if args.page:
        payload["page"] = args.page
    if args.page_size:
        payload["page_size"] = args.page_size
    result = _post(f"{SKILL_API_PREFIX}/dashboard_search", payload)
    return result


def action_dashboard_overview(args):
    """获取报表结构（图表列表 + 筛选器）"""
    payload = {}
    if args.dashboard_id:
        payload["dashboard_id"] = args.dashboard_id
    if getattr(args, "dashboard_url", None):
        payload["dashboard_url"] = args.dashboard_url
    if getattr(args, "game_code", None):
        payload["game_code"] = args.game_code
    result = _post(f"{SKILL_API_PREFIX}/dashboard_overview", payload)
    return result


def _normalize_filters(filters: list) -> list:
    """修正 Agent/LLM 可能生成的错误 operation 别名，映射到后端 API 期望的标准操作符"""
    OPERATION_ALIAS_MAP = {
        "in": "include",
        "not_in": "exclude",
        "not in": "exclude",
        "notin": "exclude",
        "gt": "greater",
        "lt": "less",
        "gte": "greaterOrEqual",
        "ge": "greaterOrEqual",
        "lte": "lessOrEqual",
        "le": "lessOrEqual",
        "eq": "equal",
        "neq": "notEqual",
        "ne": "notEqual",
        "not_equal": "notEqual",
        "not_null": "notNull",
        "notnull": "notNull",
        "is_null": "null",
        "isnull": "null",
        "range": "between",
    }
    for f in filters:
        if isinstance(f, dict) and "operation" in f:
            op = f["operation"]
            if op in OPERATION_ALIAS_MAP:
                f["operation"] = OPERATION_ALIAS_MAP[op]
    return filters


def action_chart_data(args):
    """获取单图表数据"""
    payload = {
        "dashboard_id": args.dashboard_id,
        "chart_id": args.chart_id,
    }
    if getattr(args, "game_code", None):
        payload["game_code"] = args.game_code
    if args.filters:
        payload["filters"] = _normalize_filters(json.loads(args.filters))
    if args.aggregation:
        payload["aggregation"] = json.loads(args.aggregation)
    result = _post(f"{SKILL_API_PREFIX}/chart_data", payload, timeout=TIMEOUT_CHART_DATA)
    return result


def action_dashboard_data(args):
    """一次性获取所有图表数据（支持 chart_ids 过滤指定图表，支持 chart_refs 格式）"""
    payload = {}
    dashboard_id = getattr(args, "dashboard_id", "") or ""
    chart_ids_from_refs = None

    # 🆕 chart_refs 解析
    chart_refs_raw = getattr(args, "chart_refs", "") or ""
    if chart_refs_raw:
        refs_list = json.loads(chart_refs_raw)
        parsed_refs = parse_chart_refs(refs_list)
        groups = parsed_refs["groups"]
        if groups:
            first_group = groups[0]
            if first_group["dashboard_id"]:
                dashboard_id = dashboard_id or first_group["dashboard_id"]
            chart_ids_from_refs = first_group["chart_ids"]

    if dashboard_id:
        payload["dashboard_id"] = dashboard_id
    if getattr(args, "dashboard_url", None):
        payload["dashboard_url"] = args.dashboard_url
    if getattr(args, "game_code", None):
        payload["game_code"] = args.game_code
    if args.filters:
        payload["filters"] = _normalize_filters(json.loads(args.filters))
    # chart_ids 优先级：--chart_refs 解析结果 > --chart_ids 参数
    if chart_ids_from_refs:
        payload["chart_ids"] = chart_ids_from_refs
    elif getattr(args, "chart_ids", None):
        payload["chart_ids"] = json.loads(args.chart_ids)
    if getattr(args, "auto_aggregate", False):
        payload["auto_aggregate"] = True
    result = _post(f"{SKILL_API_PREFIX}/dashboard_data", payload, timeout=TIMEOUT_DASHBOARD_DATA)
    return result


def action_knot_search(args):
    """通过 Datalab 后端代理调用 Knot MCP 知识库搜索
    
    Datalab 后端负责：
    1. 根据 game_code 从七彩石获取对应的 knot_uuid
    2. 完成 MCP 协议握手（initialize + session）
    3. 转发 tools/call 请求到 Knot MCP Server
    4. 返回知识库检索结果
    """
    if not args.query and not args.list_tools:
        return {"code": -1, "msg": "必须提供 --query 参数指定搜索关键词"}

    if not args.game_code:
        return {"code": -1, "msg": "必须提供 --game_code 参数（用于从七彩石获取对应知识库）"}

    payload = {
        "game_code": args.game_code,
        "query": args.query or "",
    }
    if args.keyword:
        payload["keyword"] = args.keyword
    if args.top_k:
        payload["top_k"] = args.top_k
    if args.search_domain:
        payload["search_domain"] = args.search_domain
    if args.data_type:
        payload["data_type"] = args.data_type
    if args.tool_name and args.tool_name != "knowledgebase_search":
        payload["tool_name"] = args.tool_name
    if args.list_tools:
        payload["list_tools"] = True

    result = _post(f"{SKILL_API_PREFIX}/knot_search", payload, timeout=TIMEOUT_DEFAULT)

    # 提取 MCP 状态（兼容新格式）
    data = result.get("data", {})
    if isinstance(data, dict):
        mcp_status = data.get("_mcp_status") or data.get("MCPStatus")
        if mcp_status:
            result["_mcp_status"] = mcp_status
        elif data.get("code") == 0:
            result["_mcp_status"] = {"success": True, "msg": "MCP 知识库请求成功"}
        else:
            result["_mcp_status"] = {"success": False, "msg": data.get("msg", "MCP 知识库请求失败")}
    elif result.get("code") == 0:
        result["_mcp_status"] = {"success": True, "msg": "MCP 知识库请求成功"}
    else:
        result["_mcp_status"] = {"success": False, "msg": result.get("msg", "请求失败")}

    return result


def action_parse_refs(args):
    """解析 'dashboard_id@chart_id' 引用列表，返回分组结果（纯本地解析，不调 API）"""
    refs_list = json.loads(args.chart_refs)
    result = parse_chart_refs(refs_list)
    return {"code": 0, "data": result}


def action_multi_report(args):
    """
    多报表批量查询：当 chart_refs 包含多个不同 dashboard_id 时，自动循环每组执行 overview + dashboard_data。
    返回所有报表的汇总结果。

    用法：python scripts/call_api.py multi_report --chart_refs '["dash1@c1","dash1@c2","dash2@c3"]'
    """
    total_start = time.time()
    chart_refs_raw = getattr(args, "chart_refs", "") or ""
    if not chart_refs_raw:
        return {"code": -1, "msg": "multi_report 必须提供 --chart_refs"}

    refs_list = json.loads(chart_refs_raw)
    parsed_refs = parse_chart_refs(refs_list)

    if parsed_refs["errors"]:
        return {"code": -1, "msg": "chart_refs 解析有误", "errors": parsed_refs["errors"]}

    groups = parsed_refs["groups"]
    if not groups:
        return {"code": -1, "msg": "chart_refs 解析结果为空"}

    game_code = getattr(args, "game_code", "") or ""
    filters_raw = getattr(args, "filters", "") or ""
    auto_aggregate = getattr(args, "auto_aggregate", False)
    question = getattr(args, "question", "") or ""

    # report_log（静默，仅记录一次）
    first_dashboard_id = groups[0]["dashboard_id"] if groups[0]["dashboard_id"] else "multi"
    log_payload = {
        "question": question or f"批量分析 {len(groups)} 个报表",
        "dashboard_id": first_dashboard_id,
        "game_code": game_code,
        "log_api_host": HOST,
    }
    _post(f"{SKILL_API_PREFIX}/report_log", log_payload)

    # 逐组执行
    results = []
    for group in groups:
        dashboard_id = group["dashboard_id"]
        chart_ids = group["chart_ids"]
        group_result = {
            "dashboard_id": dashboard_id,
            "chart_ids": chart_ids,
            "overview": None,
            "data": None,
            "error": None,
        }

        if not dashboard_id:
            group_result["error"] = "dashboard_id 为空，无法查询（chart_refs 中缺少 @ 前的报表ID）"
            results.append(group_result)
            continue

        # overview
        overview_payload = {"dashboard_id": dashboard_id}
        if game_code:
            overview_payload["game_code"] = game_code
        overview_result = _post(f"{SKILL_API_PREFIX}/dashboard_overview", overview_payload)
        overview_data = overview_result.get("data", {})
        if isinstance(overview_data, dict):
            group_result["overview"] = overview_data
        else:
            group_result["overview"] = {"_error": str(overview_data)}

        # dashboard_data
        data_payload = {"dashboard_id": dashboard_id}
        if game_code:
            data_payload["game_code"] = game_code
        if filters_raw:
            data_payload["filters"] = _normalize_filters(json.loads(filters_raw))
        if chart_ids:
            data_payload["chart_ids"] = chart_ids
        if auto_aggregate:
            data_payload["auto_aggregate"] = True
        data_result = _post(f"{SKILL_API_PREFIX}/dashboard_data", data_payload, timeout=TIMEOUT_DASHBOARD_DATA)
        raw_data = data_result.get("data", {})
        if isinstance(raw_data, dict):
            group_result["data"] = raw_data
        else:
            group_result["data"] = {"_error": str(raw_data)}

        results.append(group_result)

    total_ms = (time.time() - total_start) * 1000
    return {
        "code": 0,
        "total_groups": len(groups),
        "timing_ms": round(total_ms, 1),
        "results": results,
    }


def action_full_report(args):
    """
    组合操作：report_log + dashboard_overview + dashboard_data 一次完成
    这是最常用的场景：用户给了报表链接，要求全量分析

    支持 --chart_refs 参数：传入 '报表id@图表id' 格式的引用列表（JSON 数组）
    会自动解析出 dashboard_id 和 chart_ids，无需再单独传 --dashboard_id
    """
    total_start = time.time()
    output = {"steps": [], "timing_summary": {}}

    # 如果传了 URL，先解析
    dashboard_id = getattr(args, "dashboard_id", "") or ""
    game_code = getattr(args, "game_code", "") or ""
    dashboard_url = getattr(args, "dashboard_url", "") or ""
    chart_ids_from_refs = None

    # 🆕 chart_refs 解析：从 'dashboard_id@chart_id' 格式中提取信息
    chart_refs_raw = getattr(args, "chart_refs", "") or ""
    if chart_refs_raw:
        refs_list = json.loads(chart_refs_raw)
        parsed_refs = parse_chart_refs(refs_list)

        # 如果有解析错误，记录到 output
        if parsed_refs["errors"]:
            output["_chart_refs_errors"] = parsed_refs["errors"]

        groups = parsed_refs["groups"]
        if len(groups) == 1:
            # 单报表：直接取 dashboard_id 和 chart_ids
            group = groups[0]
            if group["dashboard_id"]:
                dashboard_id = dashboard_id or group["dashboard_id"]
            chart_ids_from_refs = group["chart_ids"]
        elif len(groups) > 1:
            # 多报表：自动委托给 multi_report 处理（循环每组）
            return action_multi_report(args)

    if dashboard_url and not dashboard_id:
        parsed = parse_dashboard_url(dashboard_url)
        dashboard_id = parsed.get("dashboard_id") or ""
        game_code = game_code or parsed.get("game_code") or ""

    if not dashboard_id and not dashboard_url:
        return {"code": -1, "msg": "必须提供 --dashboard_id 或 --dashboard_url 或 --chart_refs"}

    # Step 1: report_log（静默）
    log_payload = {
        "question": getattr(args, "question", "") or f"分析报表 {dashboard_id}",
        "dashboard_id": dashboard_id,
        "game_code": game_code,
        "log_api_host": HOST,
    }
    log_result = _post(f"{SKILL_API_PREFIX}/report_log", log_payload)
    log_ok = log_result.get("code") == 0 and not log_result.get("_http_error")
    output["steps"].append({
        "step": "report_log",
        "result": "ok" if log_ok else "error",
        "_timing": log_result.get("_timing"),
    })

    # Step 2: dashboard_overview
    overview_payload = {}
    if dashboard_id:
        overview_payload["dashboard_id"] = dashboard_id
    if dashboard_url:
        overview_payload["dashboard_url"] = dashboard_url
    if game_code:
        overview_payload["game_code"] = game_code
    overview_result = _post(f"{SKILL_API_PREFIX}/dashboard_overview", overview_payload)
    output["steps"].append({"step": "dashboard_overview", "_timing": overview_result.get("_timing")})
    overview_data = overview_result.get("data", {})
    # 防御：API 返回错误时 data 可能是字符串而非 dict
    if not isinstance(overview_data, dict):
        output["overview"] = {"_error": str(overview_data)}
    else:
        output["overview"] = overview_data

    # 从概览中提取 dashboard_id（如果之前没有）
    if not dashboard_id and isinstance(overview_data, dict):
        dashboard_id = overview_data.get("dashboard", {}).get("dashboard_id", "")

    # Step 3: dashboard_data
    data_payload = {}
    if dashboard_id:
        data_payload["dashboard_id"] = dashboard_id
    if dashboard_url:
        data_payload["dashboard_url"] = dashboard_url
    if game_code:
        data_payload["game_code"] = game_code
    if getattr(args, "filters", None):
        data_payload["filters"] = _normalize_filters(json.loads(args.filters))
    # chart_ids 优先级：--chart_refs 解析结果 > --chart_ids 参数
    if chart_ids_from_refs:
        data_payload["chart_ids"] = chart_ids_from_refs
    elif getattr(args, "chart_ids", None):
        data_payload["chart_ids"] = json.loads(args.chart_ids)
    if getattr(args, "auto_aggregate", False):
        data_payload["auto_aggregate"] = True
    data_result = _post(f"{SKILL_API_PREFIX}/dashboard_data", data_payload, timeout=TIMEOUT_DASHBOARD_DATA)
    output["steps"].append({"step": "dashboard_data", "_timing": data_result.get("_timing")})
    raw_data = data_result.get("data", {})
    # 防御：API 返回错误时 data 可能是字符串而非 dict
    if not isinstance(raw_data, dict):
        output["data"] = {"_error": str(raw_data)}
    else:
        output["data"] = raw_data

    # 汇总计时
    total_ms = (time.time() - total_start) * 1000
    output["timing_summary"] = {
        "total_ms": round(total_ms, 1),
        "report_log_ms": log_result.get("_timing", {}).get("elapsed_ms", 0),
        "overview_ms": overview_result.get("_timing", {}).get("elapsed_ms", 0),
        "dashboard_data_ms": data_result.get("_timing", {}).get("elapsed_ms", 0),
    }

    # 数据完整性校验（安全取值，防止 overview/data 非 dict 或 charts 非 list）
    overview_obj = output.get("overview", {})
    expected_count = overview_obj.get("dashboard", {}).get("chart_count", 0) if isinstance(overview_obj, dict) else 0
    data_obj = output.get("data", {})
    actual_charts = data_obj.get("charts", []) if isinstance(data_obj, dict) else []
    if not isinstance(actual_charts, list):
        actual_charts = []
    actual_count = len(actual_charts)
    output["validation"] = {
        "expected_chart_count": expected_count,
        "actual_chart_count": actual_count,
        "all_charts_received": expected_count == actual_count and actual_count > 0,
        "charts_status": [
            {
                "chart_id": c.get("chart_id"),
                "chart_name": c.get("chart_name"),
                "chart_type": c.get("chart_type"),
                "status": c.get("status"),
            }
            for c in actual_charts
            if isinstance(c, dict)
        ],
    }

    return output


# ============================================================
# CLI 入口
# ============================================================
def build_parser():
    parser = argparse.ArgumentParser(
        description="Datalab Knowledge Analyst API 统一调用脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python call_api.py search_game --game_name "麻将"
  python call_api.py dashboard_list --game_code "iaa_mpp"
  python call_api.py dashboard_search --game_code "iaa_mpp" --keyword "留存"
  python call_api.py dashboard_overview --dashboard_id "abc123"
  python call_api.py chart_data --dashboard_id "abc123" --chart_id "task_001"
  python call_api.py dashboard_data --dashboard_id "abc123"
  python call_api.py full_report --dashboard_id "abc123"

环境变量:
  DATABRAIN_TOKEN        - 必需，认证 Token（不含 Bearer 前缀）
  DATABRAIN_HOST         - 必需，API 主机地址
  DATABRAIN_DISPLAY_HOST - 可选，系统展示域名
        """,
    )
    subparsers = parser.add_subparsers(dest="action", help="API action")

    # report_log
    p = subparsers.add_parser("report_log", help="日志上报（静默）")
    p.add_argument("--question", type=str, default="")
    p.add_argument("--dashboard_id", type=str, default="")
    p.add_argument("--game_code", type=str, default="")

    # search_game
    p = subparsers.add_parser("search_game", help="业务名称模糊搜索")
    p.add_argument("--game_name", type=str, required=True)
    p.add_argument("--top", type=int, default=3)

    # dashboard_list
    p = subparsers.add_parser("dashboard_list", help="报表列表")
    p.add_argument("--game_code", type=str, required=True)
    p.add_argument("--category", type=str, default="")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page_size", type=int, default=20)

    # dashboard_search
    p = subparsers.add_parser("dashboard_search", help="报表搜索")
    p.add_argument("--game_code", type=str, default="")
    p.add_argument("--keyword", type=str, default="")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page_size", type=int, default=10)

    # dashboard_overview
    p = subparsers.add_parser("dashboard_overview", help="获取报表概览")
    p.add_argument("--dashboard_id", type=str, default="")
    p.add_argument("--dashboard_url", type=str, default="")
    p.add_argument("--game_code", type=str, default="")

    # chart_data
    p = subparsers.add_parser("chart_data", help="获取单图表数据")
    p.add_argument("--dashboard_id", type=str, required=True)
    p.add_argument("--chart_id", type=str, required=True)
    p.add_argument("--game_code", type=str, default="")
    p.add_argument("--filters", type=str, default="", help="JSON 格式筛选条件")
    p.add_argument("--aggregation", type=str, default="", help="JSON 格式聚合配置")

    # dashboard_data
    p = subparsers.add_parser("dashboard_data", help="获取全量报表数据（支持 chart_ids / chart_refs 过滤）")
    p.add_argument("--dashboard_id", type=str, default="")
    p.add_argument("--dashboard_url", type=str, default="")
    p.add_argument("--game_code", type=str, default="")
    p.add_argument("--filters", type=str, default="", help="JSON 格式筛选条件")
    p.add_argument("--chart_ids", type=str, default="", help="JSON 数组格式图表 ID 列表，如 '[\"id1\",\"id2\"]'")
    p.add_argument("--chart_refs", type=str, default="", help="JSON 数组格式 '报表id@图表id' 引用列表，如 '[\"dash1@chart1\",\"dash1@chart2\"]'")
    p.add_argument("--auto_aggregate", action="store_true")

    # knot_search（通过 Datalab 后端代理调 Knot MCP 知识库）
    p = subparsers.add_parser("knot_search", help="通过 Datalab 后端代理调 Knot MCP 知识库搜索")
    p.add_argument("--game_code", type=str, required=True, help="业务标识（必填，用于从七彩石获取对应知识库 UUID）")
    p.add_argument("--query", type=str, default="", help="搜索关键词（语义检索）")
    p.add_argument("--keyword", type=str, default="", help="关键词检索（默认同 query）")
    p.add_argument("--top_k", type=int, default=0, help="返回结果数量（0=使用默认值）")
    p.add_argument("--search_domain", type=str, default="", help="指定检索域（可选，提升准确度）")
    p.add_argument("--data_type", type=str, default="", help="指定数据类型（可选，如 document）")
    p.add_argument("--tool_name", type=str, default="knowledgebase_search", help="MCP 工具名称")
    p.add_argument("--list_tools", action="store_true", help="仅列出可用工具，不执行搜索")

    # multi_report（多报表批量查询）
    p = subparsers.add_parser("multi_report", help="多报表批量查询：chart_refs 含多个 dashboard 时自动循环")
    p.add_argument("--chart_refs", type=str, required=True, help="JSON 数组格式 '报表id@图表id' 引用列表")
    p.add_argument("--game_code", type=str, default="")
    p.add_argument("--question", type=str, default="")
    p.add_argument("--filters", type=str, default="", help="JSON 格式筛选条件")
    p.add_argument("--auto_aggregate", action="store_true")

    # full_report（组合操作）
    p = subparsers.add_parser("full_report", help="组合：report_log + overview + dashboard_data")
    p.add_argument("--dashboard_id", type=str, default="")
    p.add_argument("--dashboard_url", type=str, default="")
    p.add_argument("--game_code", type=str, default="")
    p.add_argument("--question", type=str, default="")
    p.add_argument("--filters", type=str, default="", help="JSON 格式筛选条件")
    p.add_argument("--chart_ids", type=str, default="", help="JSON 数组格式图表 ID 列表，如 '[\"id1\",\"id2\"]'")
    p.add_argument("--chart_refs", type=str, default="", help="JSON 数组格式 '报表id@图表id' 引用列表，如 '[\"dash1@chart1\",\"dash1@chart2\"]'")
    p.add_argument("--auto_aggregate", action="store_true")

    # parse_refs（独立解析 chart_refs，不调 API，仅用于 Agent 预处理）
    p = subparsers.add_parser("parse_refs", help="解析 '报表id@图表id' 引用列表，返回分组结果")
    p.add_argument("--chart_refs", type=str, required=True, help="JSON 数组格式 '报表id@图表id' 引用列表")

    return parser


ACTION_MAP = {
    "report_log": action_report_log,
    "search_game": action_search_game,
    "dashboard_list": action_dashboard_list,
    "dashboard_search": action_dashboard_search,
    "dashboard_overview": action_dashboard_overview,
    "chart_data": action_chart_data,
    "dashboard_data": action_dashboard_data,
    "knot_search": action_knot_search,
    "parse_refs": action_parse_refs,
    "multi_report": action_multi_report,
    "full_report": action_full_report,
}


def call_api(action: str, **kwargs) -> dict:
    """Programmatic entry for datalab skill API actions (same behavior as CLI)."""
    if not TOKEN:
        return {"code": -1, "msg": "DATABRAIN_TOKEN 未设置"}
    if not HOST:
        return {"code": -1, "msg": "DATABRAIN_HOST 未设置"}
    fn = ACTION_MAP.get(action)
    if not fn:
        return {"code": -1, "msg": f"未知 action: {action}"}
    return fn(argparse.Namespace(**kwargs))


def main():
    # 前置检查
    if not TOKEN:
        print(json.dumps({"code": -1, "msg": "DATABRAIN_TOKEN 未设置"}, ensure_ascii=False))
        sys.exit(1)
    if not HOST:
        print(json.dumps({"code": -1, "msg": "DATABRAIN_HOST 未设置"}, ensure_ascii=False))
        sys.exit(1)

    parser = build_parser()
    args = parser.parse_args()

    if not args.action:
        parser.print_help()
        sys.exit(1)

    action_map = ACTION_MAP

    fn = action_map.get(args.action)
    if not fn:
        print(json.dumps({"code": -1, "msg": f"未知 action: {args.action}"}, ensure_ascii=False))
        sys.exit(1)

    result = fn(args)

    # [TEST TAG] MCP 请求状态（自动化测试用，后期上线可移除）
    if isinstance(result, dict) and "_mcp_status" in result:
        mcp = result["_mcp_status"]
        tag = "[MCP_OK]" if mcp.get("success") else "[MCP_FAIL]"
        print(f"{tag} {mcp.get('msg', '')}", file=sys.stderr)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
