from run_context_wrapper import RunContextWrapper
from loguru import logger
import time
import traceback
import json
import pandas as pd
from typing import Dict, List, Tuple, Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from dashboard_common.cls import log_metrics

import contextvars; current_plan_input_var = contextvars.ContextVar("current_plan_input", default="")
from dashboard_strategy.context import GameContext, ReferenceItem
from dashboard_strategy.constants import ToolName, AgentName
from dashboard_strategy.sensitive_data import add_sensitive_dashboard_data
from dashboard_common.config import globalvar as gl
from dashboard_tools.tool_common import get_tool_enabled, function_tool
from dashboard_tools.dashboard.utils.dashboard_metric_map import DASHBOARD_METRIC_MAP, DASHBOARD_METRIC_URL_BY_TYPE, DASHBOARD_METRIC_URL_BY_TYPE_REALTIME, DASHBOARD_METRIC_URL_BY_TYPE_MCP, DASHBOARD_MCP_METRIC_MAP_BY_NAME, get_dashboard_metric_info

from dashboard_utils.helper import default_tool_error_function
from dashboard_tools.dashboard.utils.dashboard_tools_util import map_country_name, update_input, get_bi_data, str_to_dt, dt_to_str, update_date, convert_to_csv, sort_query_data, sort_mcp_query_data, apply_metric_code_to_name_mapping  # get_mcp_bi_data: commented out for MCP bi data

def _get_dashboard_plan_input(game_context: "GameContext") -> str:
    """取当前轮对应的 plan 输入：优先用 contextvar（并行时各 agent 上下文独立），否则回退到拼接所有 dashboard 的 input。"""
    ctx_input = (current_plan_input_var.get() or "").strip()
    if ctx_input:
        return ctx_input
    if len(game_context.plan_items) == 1:
        item = game_context.plan_items[0]
        if item["agent"] in (AgentName.DashboardAgent.value, AgentName.SimplifiedDashboardAgent.value, AgentName.TechlandAgent.value):
            return str(item["input"]).strip()
    return ""


def _safe_json_loads(text: str) -> Any:
    """
    Safely parse JSON string, return original string if parsing fails.
    """
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text


def _auto_unwrap_result(result: Any) -> Any:
    """
    Unwrap CallToolResult objects to extract JSON data from TextContent.
    """
    try:
        # Handle mcp.types.CallToolResult objects
        if hasattr(result, '__class__') and 'CallToolResult' in str(result.__class__):
            content = result.content

            # Handle TextContent objects in a list
            if isinstance(content, list) and len(content) > 0:
                first_item = content[0]
                if hasattr(first_item, 'text'):
                    return _safe_json_loads(first_item.text)

            # Handle direct string content
            if isinstance(content, str):
                return _safe_json_loads(content)

            return content

        # Handle other formats
        if isinstance(result, dict):
            return result
        if isinstance(result, str):
            return _safe_json_loads(result)

        return None
    except Exception as e:
        logger.warning(f"[Dashboard Tools] 解包结果时出错: {str(e)}")
        return None


async def _ensure_mcp_server(context: RunContextWrapper[GameContext], caller: str):
    """Get MCP server initialized by run_tool lifecycle; do not restart in tool layer."""
    context.context.dashboard_inner_vars.setdefault("dashboard_mcp_server", [])
    mcp_servers = context.context.dashboard_inner_vars.get("dashboard_mcp_server") or []
    if mcp_servers:
        return mcp_servers[0]

    logger.error(f"[MCP Lifecycle] {caller}: dashboard_mcp_server is empty (expected run_tool on_start init)")
    return None


def _normalize_country_filter_values(query: "Query") -> "Query":
    """
    Convert country filter values to lowercase.
    Country codes should be lowercase (e.g., "us", "cn", "th") not uppercase.
    """
    if not query.filters:
        return query
    
    for filter_item in query.filters:
        # Check if this is a country_code filter
        if filter_item.member and "country_code" in filter_item.member.lower():
            if filter_item.values:
                # Convert all country code values to lowercase
                filter_item.values = [v.lower() if isinstance(v, str) and v != "All" else v for v in filter_item.values]
                logger.info(f"[Dashboard Tools] Normalized country filter values to lowercase: {filter_item.values}")
    
    return query


def _remove_time_dimensions_from_dimensions_and_filters(query: "Query") -> "Query":
    """
    Remove time dimensions (e.g., dtstatdate) from dimensions and filter array.
    Time dimensions should only be in timeDimensions, not in dimensions or filters.
    """
    if query.dimensions:
        original_dimensions = query.dimensions.copy()
        # Remove any dimension that contains "dtstatdate"
        query.dimensions = [dim for dim in query.dimensions if "dtstatdate" not in dim.lower()]

        if len(query.dimensions) < len(original_dimensions):
            removed = [dim for dim in original_dimensions if dim not in query.dimensions]
            logger.info(f"[Dashboard Tools] Removed time dimensions from dimensions array: {removed}")
    if query.filters:
        original_filters = query.filters.copy()
        # Remove any dimension that contains "dtstatdate"
        query.filters = [dim for dim in query.filters if "dtstatdate" not in dim.member]
        if len(query.filters) < len(original_filters):
            removed = [dim for dim in original_filters if "dtstatdate" in dim.member]
            logger.info(f"[Dashboard Tools] Removed time dimensions from filters array: {removed}")

    return query


def _build_metric_map_from_describe_data(describe_data_result: Any, game_code: str) -> Dict[str, Dict[str, str]]:
    """
    Build a metric map from describe_data output.

    Args:
        describe_data_result: The result from describe_data tool call (can be CallToolResult, dict, or str)
        game_code: The game code for which the metric map is being built

    Returns:
        A dictionary mapping metric_code to metric info:
        {
            "metric_code": {
                "metric_name_en": "...",
                "metric_name_cn": "...",
                "metric_desc": "...",
                "value_type": "numerical" or "percent"
            }
        }
    """
    metric_map = {}

    try:
        # Unwrap the result to get the actual data
        result_data = _auto_unwrap_result(describe_data_result)

        # Handle string result
        if isinstance(result_data, str):
            result_data = _safe_json_loads(result_data)

        # Extract data array from response
        if not isinstance(result_data, dict) or "data" not in result_data:
            logger.warning(f"[Dashboard Tools] Invalid describe_data result structure for game_code: {game_code}")
            return metric_map

        cubes = result_data.get("data", [])

        # Iterate through all cubes/models
        for cube in cubes:
            if not isinstance(cube, dict) or "measures" not in cube:
                continue

            measures = cube.get("measures", [])

            # Process each measure
            for measure in measures:
                if not isinstance(measure, dict) or "name" not in measure:
                    continue

                # Extract metric code (last part after the dot)
                full_name = measure.get("name", "")
                if "." not in full_name:
                    continue

                metric_code = full_name.split(".")[-1]

                # Extract description as metric_desc
                metric_desc = measure.get("description", "")

                # Extract value_type: first use format, then meta["value_type"], then default to "float"
                value_type = "float"  # default
                meta = measure.get("meta", [])

                if "format" in measure and measure.get("format"):
                    value_type = measure.get("format")
                elif meta:
                    # Handle both list and dict formats for meta
                    if isinstance(meta, list):
                        # Check meta array for value_type
                        for meta_item in meta:
                            if isinstance(meta_item, dict) and "value_type" in meta_item:
                                value_type = meta_item["value_type"]
                                break
                    elif isinstance(meta, dict) and "value_type" in meta:
                        value_type = meta["value_type"]

                # Extract Chinese name from meta[0]["name_zh"] or meta["name_zh"]
                metric_name_cn = metric_code  # default fallback
                if meta:
                    if isinstance(meta, list) and len(meta) > 0:
                        first_meta = meta[0]
                        if isinstance(first_meta, dict) and "name_zh" in first_meta:
                            metric_name_cn = first_meta["name_zh"]
                    elif isinstance(meta, dict) and "name_zh" in meta:
                        metric_name_cn = meta["name_zh"]

                # Use shortTitle or title as English name
                metric_name_en = measure.get("shortTitle") or measure.get("title", metric_code)

                # Store in metric map
                metric_map[metric_code] = {
                    "metric_name_en": metric_name_en,
                    "metric_name_cn": metric_name_cn,
                    "metric_desc": metric_desc,
                    "value_type": value_type
                }

        logger.info(f"[Dashboard Tools] Built metric map for game_code {game_code} with {len(metric_map)} metrics")

    except Exception as e:
        logger.warning(f"[Dashboard Tools] Error building metric map from describe_data: {str(e)}")
        logger.error(traceback.format_exc())

    return metric_map


class Filter(BaseModel):
    member: str = Field(..., description="The full field name to filter on, including model prefix. Examples: 'Orders.status', 'Users.country', 'Products.category'")
    operator: str = Field(
        ..., description="The filter operator. Common operators: 'equals', 'notEquals', 'contains', 'notContains', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'beforeDate', 'afterDate'"
    )
    values: Optional[list[str]] = Field(None, description="The values to filter by. For 'equals' use single value, for 'in' use multiple values. Examples: ['active'], ['US', 'CA', 'UK']")

    class Config:
        exclude_none = True


class TimeDimension(BaseModel):
    dimension: str = Field(..., description="The full time dimension name including model prefix. Examples: 'Orders.createdAt', 'Users.registeredAt', 'Events.timestamp'")
    granularity: Optional[Literal["second", "minute", "hour", "day", "week", "month", "quarter", "year"]] = Field(
        None, description="Time granularity for grouping. Choose based on your analysis needs: 'day' for daily trends, 'week' for weekly patterns, 'month' for monthly reports, etc. If the user does NOT specify granularity, do NOT set this field."
    )
    dateRange: Union[list[str], str] = Field(
        ...,
        description="Date range specification. Can be: 1) Two ISO date strings ['2024-01-01', '2024-12-31'], 2) Relative date strings like 'last 30 days', 'this month', 'last year', 'today', 'yesterday'",
    )

    class Config:
        exclude_none = True


class Query(BaseModel):
    measures: list[str] = Field([], description="List of measure names to aggregate. Examples: ['Users.count', 'Orders.revenue', 'Products.quantity']. Use list_metrics() to see available measures.")
    dimensions: list[str] = Field([], description="List of dimension names to group by. Examples: ['Users.country', 'Orders.status']. Use list_dimensions() to see available dimensions. IMPORTANT: Include ALL dimensions mentioned in the user's query for comparison or grouping.")
    timeDimensions: list[TimeDimension] = Field([], description="Time-based dimensions for temporal analysis. Examples: daily trends, monthly reports, weekly patterns.")
    filters: list[Filter] = Field([], description="List of filter conditions to apply. Use list_dimension_values() to see available filter values. CRITICAL: You MUST include filters for ALL conditions mentioned in the user's query, including: country/region filters when a location is mentioned (e.g., '泰国'/Thailand, '美国'/USA), platform/OS filters when a platform is mentioned (e.g., 'Steam', 'iOS', 'Android'), and any other specific conditions the user specifies.")

    class Config:
        exclude_none = True


class DashboardException(Exception):
    """Custom exception for dashboard agent."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardWrongTokenException(DashboardException):
    """Custom exception for dashboard wrong token issues."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardEmptyDataException(DashboardException):
    """Custom exception for dashboard empty data issues."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardPermissionException(DashboardException):
    """Custom exception for dashboard permission issues."""

    def __init__(self, game):
        super().__init__(
            f"User does not have permission to access dashboard info for game {game}. "
        )
        self.game = game


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.DashboardMcpDescribeDataTool.value),
    readable_name_map={
        "English": "Dashboard Game Feature Data Description Tool",
        "Chinese": "经分游戏特性数据说明工具",
    }
)
async def dashboard_mcp_describe_data_tool(
    context: RunContextWrapper[GameContext],
    game_code: str = None,
    user_query: str = None,
) -> str:
    """
    Get MCP describe_data schema for react agent to build read_data query (两步流程第一步).

    Calls describe_data to get schema and returns schema string directly.
    React agent should build a valid read_data query JSON and pass it to dashboard_mcp_read_data_tool.

    Args:
    - game_code: Required. Valid dashboard game_code (e.g. demo, i_game, nikke).
    - user_query: Required semantic user query for MCP describe_data.
                  Default should be the user's input query; if user intent is ambiguous,
                  agent should rewrite/build a clearer user_query before calling this tool.

    Returns: JSON string of describe_data schema.
    """
    logger.info(
        f"【Functool Call】-【dashboard_mcp_describe_data_tool】: Calling dashboard_mcp_describe_data_tool with game_code: {game_code}, user_query: {user_query}, token: {context.context.token}.")
    start_time = time.time()

    if context.context.dashboard_inner_vars.get("no_mcp_available"):
        return context.context.dashboard_inner_vars.get("mcp_unavailable_reason", "MCP server is not available, please try again later.")

    try:
        context.context.had_describe_data = True
        mcp_server = await _ensure_mcp_server(context, "dashboard_mcp_describe_data_tool")
        if mcp_server is None:
            log_metrics("dashboard_mcp_describe_data_tool", "0", round((time.time() - start_time) * 1000, 2))
            return "MCP server is not available, please try again later."

        # Use caller-provided semantic query for describe_data, fallback to original user input
        resolved_user_query = (user_query or getattr(context.context, "user_input", "") or "").strip()
        if not resolved_user_query:
            log_metrics("dashboard_mcp_describe_data_tool", "0", round((time.time() - start_time) * 1000, 2))
            return "Error: user_query is required. Please pass a clear user query (default should be user's input query)."
        intent = resolved_user_query[:2000]
        trace_id = getattr(context.context, "message_id", "") or ""

        logger.info(f"[dashboard_mcp_describe_data_tool] Calling describe_data with game_code={game_code}, query={resolved_user_query!r}, trace_id={trace_id}")
        result = await mcp_server.call_tool('describe_data', {
            'game_code': game_code,
            'user_token': "Bearer " + context.context.token,
            'query': intent,
            'trace_id': trace_id,
        })
        result_data = _auto_unwrap_result(result)
        if isinstance(result_data, (dict, list)):
            schema_str = json.dumps(result_data, ensure_ascii=False)
        elif isinstance(result_data, str):
            schema_str = result_data
        else:
            schema_str = str(result)

        schema_str_trimmed = schema_str.strip()
        if not schema_str_trimmed or schema_str_trimmed in {"{}", "[]", "null", "None"}:
            logger.info(f"[dashboard_mcp_describe_data_tool] No relevant metric/schema for intent {intent}")
            log_metrics("dashboard_mcp_describe_data_tool", "0", round((time.time() - start_time) * 1000, 2))
            return "Functool Return】-【dashboard_mcp_describe_data_tool】: no_relevant_metric, please try other tools"

        # Build and store metric map from describe_data result
        if game_code:
            metric_map = _build_metric_map_from_describe_data(result, game_code)
            if metric_map:
                if "mcp_metric_maps" not in context.context.dashboard_inner_vars:
                    context.context.dashboard_inner_vars["mcp_metric_maps"] = {}
                context.context.dashboard_inner_vars["mcp_metric_maps"][game_code] = metric_map
                logger.info(f"[Dashboard Tools] Stored metric map for game_code: {game_code} with {len(metric_map)} metrics")

        logger.info(f"[dashboard_mcp_describe_data_tool] Returning describe_data schema to react agent, game_code={game_code}, schema_len={len(schema_str)}")
        log_metrics("dashboard_mcp_describe_data_tool", "0", round((time.time() - start_time) * 1000, 2))
        return schema_str
    except Exception as e:
        logger.warning(
            f"【Functool Return】-【dashboard_mcp_describe_data_tool】: Error message is {e}.")
        log_metrics("dashboard_mcp_describe_data_tool", "0", round((time.time() - start_time) * 1000, 2))
        return f"【Functool Return】-【dashboard_mcp_describe_data_tool】: call failed with error: {e}. Please check the error, correct your input (e.g. game_code) and retry with correct input."


def _handle_mcp_error(error_msg: str, start_time: float, log_level: str = "error", **kwargs) -> str:
    """
    Helper function to handle MCP errors consistently.
    
    Args:
        error_msg: The error message to log and return
        start_time: Start time for metrics calculation
        log_level: Log level ("error", "warning", "info")
        **kwargs: Additional context to log (e.g., result_data, result)
    """
    tool_name = "dashboard_mcp_read_data_tool"
    
    # Log with appropriate level
    log_msg = f"【MCP {log_level.capitalize()}】-【{tool_name}】: {error_msg}"
    if kwargs:
        log_msg += f" Additional context: {kwargs}"
    
    if log_level == "error":
        logger.error(log_msg)
    elif log_level == "warning":
        logger.warning(log_msg)
    else:
        logger.info(log_msg)
    
    log_metrics(tool_name, "0", round((time.time() - start_time) * 1000, 2))
    
    return f"【Functool Return】-【{tool_name}】: {error_msg} Please check the error, correct your query (game_code, measures, dimensions, filters, timeDimensions) and retry with correct input."


# 不使用时间维度过滤的表（即使用户询问时间也不做 timeDimensions 过滤）
TABLES_WITHOUT_TIME_DIMENSION = frozenset(["hok_ret_smurf_battle_social_activetag_version_gap_d"])


def _query_uses_table(query: "Query", table_name: str) -> bool:
    """判断 query 是否使用了指定表（通过 measures/dimensions/filters 的 member 前缀判断）。"""
    def any_refers_table(items, get_member=None) -> bool:
        if not items:
            return False
        for x in items:
            s = (get_member(x) if get_member else x) if isinstance(x, str) else getattr(x, "member", None)
            if s and isinstance(s, str) and s.startswith(table_name + "."):
                return True
        return False

    return (
        any_refers_table(query.measures)
        or any_refers_table(query.dimensions)
        or any_refers_table(query.filters, lambda f: f.member)
    )


def _remove_time_dimension_for_special_tables(query: "Query") -> "Query":
    """对不需要时间维度过滤的表，清空 timeDimensions，再去做 read_data。"""
    for table_name in TABLES_WITHOUT_TIME_DIMENSION:
        if _query_uses_table(query, table_name):
            if query.timeDimensions:
                query.timeDimensions = []
                logger.info(
                    f"[Dashboard MCP Tools] Table {table_name} does not support time filter; cleared timeDimensions."
                )
            break
    return query


def _add_resourceversion_for_filter(query: "Query") -> "Query":
    if query.measures:
        for tabke_name in ["hok_ret_qidongzhucezhuanhualoudou_pt1_v1_22","hok_ret_qidongzhucezhuanhualoudou_pt1_v1","hok_signup_funnel"]:
            if any(tabke_name in measure for measure in query.measures):
                if not any("resourceversion" in filter.member for filter in query.filters):
                    added_filter = Filter(member=f"{tabke_name}.resourceversion", operator="equals", values=["所有版本"])
                    query.filters.append(added_filter)
                    logger.info(f"[Dashboard MCP Tools] added resourceversion filter for {tabke_name}, {added_filter}")
        for tabke_name in ["hok_ret_smurf_register_retention_d"]:
            if any(tabke_name in measure for measure in query.measures):
                if not any("country_name" in filter.member for filter in query.filters):
                    added_filter = Filter(member=f"{tabke_name}.country_name", operator="equals", values=["所有国家"])
                    query.filters.append(added_filter)
                    logger.info(f"[Dashboard MCP Tools] added country_name filter for {tabke_name}, {added_filter}")
                if not any("area_name" in filter.member for filter in query.filters):
                    added_filter = Filter(member=f"{tabke_name}.area_name", operator="equals", values=["所有区域"])
                    query.filters.append(added_filter)
                    logger.info(f"[Dashboard MCP Tools] added area_name filter for {tabke_name}, {added_filter}")
    return query


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.DashboardMcpReadDataTool.value),
    readable_name_map={
        "English": "Dashboard Game Feature Data Query Tool",
        "Chinese": "经分游戏特性数据查询工具",
    }
)
async def dashboard_mcp_read_data_tool(
    context: RunContextWrapper[GameContext],
    game_code: str = None,
    query: Union[Query, str] = None,
) -> str:
    """Execute MCP read_data with query JSON built by react agent (两步流程第二步).

    Usually call after dashboard_mcp_describe_data_tool gets schema, then pass the built query JSON here.

    Parameters:
    - game_code: Required. Valid dashboard game_code (e.g. demo, i_game, nikke).
    - query: Required. Read_data query JSON string or a Query object.
            Expected JSON shape when relevant metrics exist:
            {
              "measures": ["cube_name.measure_name"],
              "dimensions": ["cube_name.dimension_name"],
              "timeDimensions": [{"dimension": "cube_name.dtstatdate", "dateRange": ["YYYY-MM-DD", "YYYY-MM-DD"], "granularity": "day"}],
              "filters": [{"member": "cube_name.field", "operator": "equals" or "in", "values": ["string only"]}]
            }
            Rules:
            * First decide whether the user question can be answered by tables/metrics in schema.
            * If no relevant table/metric can answer the question, pass {"no_relevant_metric": true} or switch to other tools.
            * measures must come from schema and should keep same cube prefix in one request.
            * dimensions must come from schema; NEVER put dtstatdate (or other time field) in dimensions or filters.
            * timeDimensions is where time constraints belong; include dimension + dateRange (default last 30 days if user does not specify), granularity only when user asks (day/week/month).
            * filters should include required cube constraints; values must be string array (e.g. ["255"], not [255]).
            * country_code values must be lowercase (e.g. "us", "cn"); include required fields like country_code/os when schema requires.
            * measures/dimensions/timeDimensions/filters should use exact schema names from describe_data.

    Returns: Query results (game_name, references, data CSV).
    """
    logger.info(
        f"【Functool Call】-【dashboard_mcp_read_data_tool】: Calling dashboard_mcp_read_data_tool with game_code: {game_code}, query: {query}, token: {context.context.token}.")
    start_time = time.time()

    if context.context.dashboard_inner_vars.get("no_mcp_available"):
        return context.context.dashboard_inner_vars.get("mcp_unavailable_reason", "MCP server is not available, please try again later.")

    if query is None or (isinstance(query, str) and not query.strip()):
        log_metrics("dashboard_mcp_read_data_tool", "0", round((time.time() - start_time) * 1000, 2))
        return "Error: query is required. Please build a valid read_data query JSON and pass it as query."

    try:
        if isinstance(query, str):
            query_str = query.strip()
            query_dict = _safe_json_loads(query_str)
            if not isinstance(query_dict, dict):
                log_metrics("dashboard_mcp_read_data_tool", "0", round((time.time() - start_time) * 1000, 2))
                return "Error: query must be a valid JSON object for MCP read_data."
            if query_dict.get("no_relevant_metric") is True:
                log_metrics("dashboard_mcp_read_data_tool", "0", round((time.time() - start_time) * 1000, 2))
                return "no_relevant_metric, please try other tools"
            query = Query.model_validate(query_dict)
        elif hasattr(query, "model_dump"):
            pass
        else:
            query = Query.model_validate(query) if hasattr(query, "__dict__") else Query(**query)

        mcp_server = await _ensure_mcp_server(context, "dashboard_mcp_read_data_tool")
        if mcp_server is None:
            log_metrics("dashboard_mcp_read_data_tool", "0", round((time.time() - start_time) * 1000, 2))
            return "MCP server is not available, please try again later."

        # Normalize country filter values to lowercase before sending query
        query = _normalize_country_filter_values(query)
        # 对不需要时间过滤的表（如 hok_ret_smurf_battle_social_activetag_version_gap_d）清空 timeDimensions
        query = _remove_time_dimension_for_special_tables(query)
        # Remove time dimensions (e.g., dtstatdate) from dimensions and filters array
        # query = _remove_time_dimensions_from_dimensions_and_filters(query)
        # query = _add_resourceversion_for_filter(query)
        result = await mcp_server.call_tool('read_data', {
            'game_code': game_code,
            'user_token': "Bearer " + context.context.token,
            'query': query.model_dump() if hasattr(query, "model_dump") else query
        })

        # Game configuration
        mcp_game_name = ""
        mcp_game_type = ""
        if context.context.dashboard_game_code_and_filters:
            for game_name, game_info in context.context.dashboard_game_code_and_filters.items():
                if isinstance(game_info, dict) and game_info.get("game_code") == game_code:
                    mcp_game_name = game_info.get("game_name", "")
                    mcp_game_type = game_info.get("game_type", "")
                    break
        try:
            # Unwrap CallToolResult and extract data
            result_data = _auto_unwrap_result(result)

            # Validate result_data
            if result_data is None:
                return _handle_mcp_error("Failed to parse response from MCP server", start_time, result=result)

            if not isinstance(result_data, dict):
                return _handle_mcp_error("Unexpected response format from MCP server", start_time,
                                          result_data_type=type(result_data), result_data=result_data)

            # Check for API error response
            if result_data.get("code") != 0:
                error_msg = result_data.get("msg", "Unknown error")
                return _handle_mcp_error(error_msg, start_time, log_level="warning")

            # Extract and validate data
            query_metadata = result_data.get("query", {})
            data_rows = result_data.get("data", [])

            if data_rows is None:
                return _handle_mcp_error("No data field in MCP server response", start_time, result_data=result_data)

            if not isinstance(data_rows, list):
                return _handle_mcp_error("Invalid data format in MCP server response", start_time,
                                         data_rows_type=type(data_rows), data_rows=data_rows)

            if len(data_rows) == 0:
                logger.info(f"【MCP Info】-【dashboard_mcp_read_data_tool】: Query returned empty data. Query: {query}")
                return f"Querying metrics for {mcp_game_name}, the results is {result_data}"[:8000000]

        except Exception as e:
            logger.error(f"【MCP Error】-【dashboard_mcp_read_data_tool】: Exception during result processing: {str(e)}")
            logger.error(f"【MCP Error】-【dashboard_mcp_read_data_tool】: Exception traceback: {traceback.format_exc()}")
            logger.error(f"【MCP Error】-【dashboard_mcp_read_data_tool】: Raw result: {result}")
            return _handle_mcp_error(f"No data returned from MCP server: {str(e)}", start_time, raw_result=result)

        # Extract metrics and time dimensions
        metrics = query_metadata.get("measures", [])
        time_dimensions = query_metadata.get("timeDimensions", [])

        time_column_name = time_dimensions[0].get(
            "dimension") if time_dimensions else None
        granularity = time_dimensions[0].get(
            "granularity") if time_dimensions else None


        sorted_data = sort_mcp_query_data(data_rows, time_column_name)

        cover_url = context.context.game_icon_mapping.get(game_code, "")
        url_map = gl.get_value("rb_url_map_json", expected_type=dict) or {}
        references_list = []
        dashboard_name = "经分" if context.context.language.lower() == "chinese" else "Dashboard"
        for metric in metrics:
            url_pattern = f"v2/dashboard/game/{game_code}{DASHBOARD_METRIC_URL_BY_TYPE_MCP.get(mcp_game_type.lower(), {}).get(metric.split('.')[-1], '/overview/daily')}"
            url_pattern_for_mobile = "v2/dashboard/game/{game_code}" + \
                f"{DASHBOARD_METRIC_URL_BY_TYPE_MCP.get(mcp_game_type.lower(), {}).get(metric.split('.')[-1], '/overview/daily')}"
            type_string = "m_mobile_url" if mcp_game_type.lower() == "mobile" else "pc_mobile_url"
            mobile_url_pattern = url_map.get(url_pattern_for_mobile, {})
            mobile_url_pattern = {} if mobile_url_pattern == "" else mobile_url_pattern
            mobile_url = mobile_url_pattern.get(
                type_string, "").format(game_code=game_code)

            references_list.append(ReferenceItem(
                title=f"{mcp_game_name} - {metric.split('.')[-1]} -{dashboard_name}",
                url=url_pattern,
                mobile_url=mobile_url,
                image_url=cover_url,
                type="databrain",
                name=f"{mcp_game_name} - {metric.split('.')[-1]} - {dashboard_name}",
                favicon=cover_url
            ))

        context.context.references.extend(references_list)

        # Get metric map: build by current game_type first, then overlay MCP/static map and describe_data map
        metric_map_to_use = {}
        for metric in metrics:
            metric_code = metric.split('.')[-1]
            metric_map_to_use[metric_code] = DASHBOARD_MCP_METRIC_MAP_BY_NAME.get(metric_code) or get_dashboard_metric_info(metric_code, mcp_game_type)

        if game_code and context.context.dashboard_inner_vars.get("mcp_metric_maps") and game_code in context.context.dashboard_inner_vars["mcp_metric_maps"]:
            stored_metric_map = context.context.dashboard_inner_vars["mcp_metric_maps"][game_code]
            metric_map_to_use = {**metric_map_to_use, **stored_metric_map}
            logger.info(f"[Dashboard Tools] Using stored metric map for game_code: {game_code} with {len(stored_metric_map)} metrics")

        # bi data for MCP: commented out
        # bi_data, bi_data_id = get_mcp_bi_data(sorted_data, metrics, mcp_game_name, mcp_game_type,
        #                                       metric_map_to_use, time_column_name, granularity, is_english)
        # if len(sorted_data) < 2:
        #     bi_data_id = ""
        # if bi_data:
        #     context.context.data.append(bi_data)

        data_csv, description_str = convert_to_csv(sorted_data, metrics)

        result_data = {
            "game_name": mcp_game_name,
            "data_id": "",
            "references": references_list,
            "data": data_csv
        }

        logger.info(
            f"【Functool Return】-【dashboard_metrics_query_tool】: Get data for game {mcp_game_name} with data: {{'game_name': {mcp_game_name}, 'references': {references_list}, 'data': {data_csv} }}.")

        log_metrics("dashboard_mcp_read_data_tool", "0",
                    round((time.time() - start_time) * 1000, 2))
        if result_data:
            add_sensitive_dashboard_data(context.context, [game_code])
        return f"Querying metrics for {mcp_game_name}, the results is {result_data}. 【要求：数据没有代表chart的data_id，请使用 markdown table 输出展示数据】"[:8000000]

    except Exception as e:
        logger.warning(
            f"Functool Return】-【dashboard_mcp_read_data_tool】: Error message is {e}.")
        logger.error(traceback.format_exc())
        log_metrics("dashboard_mcp_read_data_tool", "0",
                    round((time.time() - start_time) * 1000, 2))
        return f"【Functool Return】-【dashboard_mcp_read_data_tool】: call failed with error: {e}. Please check the error, correct your input (game_code, query structure) and retry with correct input."


