from __future__ import annotations
from run_context_wrapper import RunContextWrapper
from loguru import logger
import time
import traceback
from typing import List
from dateutil import parser
import uuid
from pydantic import BaseModel, Field

from utils.cls import log_metrics
from utils.context import GameContext
from utils.constants import ToolName
from utils.tool_common import get_tool_enabled, function_tool
from utils.helper import default_tool_error_function
from utils.databrain_api import async_send_request_with_token
from utils.update_input import update_input
from utils.databrain_api import MGMT_TOP_MODULE_API
from utils.sensitive_data import set_sensitive_data_flag
from utils.mgmt_reference_utils import append_mgmt_reference_for_module
from utils.mgmt_topn_formatters import process_topn_rankings
from utils.util import is_chinese_language


order_metric_map = {
    "gross_revenue_actual": [
        "gross_revenue_actual",  # default value，按照实际收入进行排序
        "growth",  # 按照实际收入的增长率进行排序
        "growth_rate",  # 按照实际收入的增长率进行排序
        "mom",  # 按照实际收入的环比进行排序
        "yoy",  # 按照实际收入的同比进行排序
    ],
    "gross_revenue_forecast": [
        "gross_revenue_forecast",  # default value，按照预测收入进行排序
        "neutral",  # 按照中性预测的收入进行排序
        "business_team",  # 按照业务团队预测的收入进行排序
    ],
    "gross_revenue_kpi": [
        "gross_revenue_kpi",  # default value，按照收入KPI进行排序
        "complete",  # 按照收入KPI的完成率进行排序
    ],
    "net_profit_actual": [
        "net_profit_actual",  # default value，按照实际利润进行排序
        "growth",  # 按照实际利润的增长率进行排序
        "growth_rate",  # 按照实际利润的增长率进行排序
    ],
    "net_profit_forecast": [
        "net_profit_forecast",  # default value，按照预测利润进行排序
        "neutral",  # 按照中性预测的利润进行排序
        "business_team",  # 按照业务团队预测的利润进行排序
    ],
    "net_profit_kpi": [
        "net_profit_kpi",  # default value，按照利润KPI进行排序
        "complete",  # 按照利润KPI的完成率进行排序
    ],
    "milestone_headcount": [
        "milestone_headcount",  # default value，按照当前里程碑的计划人力排序
        "next_milestone_headcount",  # 按照下一个里程碑的计划人力进行排序
    ],
}


TOPN_MODULE_SELECTION_RULES = (
    "TopN tool module selection rules: "
    "1. If the query only compares and ranks studios (游戏工作室) to get top N, use module='studio'. "
    "Example: '2025年10月收入最高的10个studio(游戏工作室)'. "
    "2. If the query compares and ranks projects/games, use module='project'. "
    "3. When module='project' and the user explicitly asks to distinguish publishing mode, use data_source to filter: "
    "data_source='studio' for IEGG studio 工作室发行, data_source='publishing' for 发行项目或IEGG publishing自主发行, data_source='dev' for 在研项目/游戏. "
)


def _format_api_date_range(start_date: str, end_date: str, granularity: str) -> tuple[str, str]:
    start_dt = parser.parse(start_date)
    end_dt = parser.parse(end_date)
    if str(granularity or "").lower() == "yearly":
        start_dt = start_dt.replace(month=1, day=1)
        end_dt = end_dt.replace(month=12, day=31)
    return start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")


class OrderMetric(BaseModel):
    """Metric item for TopN queries."""
    order_metric: str = Field(..., description="The metric code/name used to order")
    order_by: str = Field(..., description="A string dimension used to order by, 每个指标order_metric支持不同的order by，默认order_by=order_metric")
    order: str = Field(..., description="Sort order: 'asc' for ascending or 'desc' for descending")


def sanitize_order_metric(order_metric_obj: OrderMetric) -> OrderMetric:
    """LLM 传参兜底：修正 order_metric / order_by 的非法组合。

    当 LLM 生成的 tool-call 参数存在逻辑矛盾时，自动纠正为合法值，
    避免下游 TopN API 因无效参数返回空结果或报错。

    纠正规则:
        1) order_by == "complete" 时，"complete" 仅在 *_kpi 指标下有效：
           - gross_revenue_actual / gross_revenue_forecast → gross_revenue_kpi
           - net_profit_actual   / net_profit_forecast     → net_profit_kpi
        2) 若 order_by 不在 order_metric_map[order_metric] 的合法列表中，
           回退为 order_by = order_metric（即按指标自身值排序）。

    Args:
        order_metric_obj: LLM 生成的原始排序指标对象，可能包含不合法的字段组合。

    Returns:
        修正后的同一 OrderMetric 对象（原地修改并返回）。
    """
    order_metric = order_metric_obj.order_metric
    order_by = order_metric_obj.order_by

    # Rule 1: "complete" is only valid under *_kpi metrics; remap actual/forecast → kpi
    if order_by == "complete":
        if order_metric in ("gross_revenue_actual", "gross_revenue_forecast"):
            order_metric = "gross_revenue_kpi"
        elif order_metric in ("net_profit_actual", "net_profit_forecast"):
            order_metric = "net_profit_kpi"

    # Rule 2: order_by must be a valid option for the (possibly rewritten) order_metric
    valid_order_bys = order_metric_map.get(order_metric, [])
    if order_by not in valid_order_bys:
        order_by = order_metric

    # Apply changes
    order_metric_obj.order_metric = order_metric
    order_metric_obj.order_by = order_by

    logger.info(
        f"[sanitize_order_metric]: order_metric={order_metric_obj.order_metric}, "
        f"order_by={order_metric_obj.order_by}, order={order_metric_obj.order}"
    )
    return order_metric_obj


# 榜单API
# 获取指定模块下各指标的Top N排名数据，支持工作室和项目两个维度的排名查询
# 查询多个指标, 返回多个榜单。意思是会为每个指标返回排序的数据，不会把多个指标叠加在一起进行排序
async def call_topN_api(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    order_metrics: list[OrderMetric],
    query_metrics: list[str],
    module: str = "studio",  # 模块名称，studio=工作室, project=项目
    granularity: str = "monthly",  # 数据粒度，monthly=月度, yearly=年度
    top_num: int = 1,
    studio_ids: list[str] = [],  # studio id (module = "studio"时必填)
    combine_ids: list[str] = [],  # combine id (module = "project"时必填)
    data_source: str | None = None,  # only works when module="project": studio/publishing/dev (mapped to filters.data_sources)
    language: str = "en",  # 语言设置，支持 "zh"（中文）或 "en"（英文），默认为 "en"
):

    # 设置 filters
    filter_dict = {}
    if len(studio_ids) > 0:
        filter_dict["studio_id"] = studio_ids
    if len(combine_ids) > 0:
        filter_dict["combine_id"] = combine_ids
    if module == "project" and data_source:
        # Optional filter only for project rankings:
        # - empty -> all projects
        # - "studio" -> IEGG studio 工作室发行 projects
        # - "publishing" -> 发行项目/游戏, 或IEGG publishing 自主发行 projects
        # - "dev" -> 在研项目/游戏
        # Backend expects a LIST field: filters.data_sources = ["studio"|"publishing"|"dev"]
        filter_dict["data_sources"] = [data_source]

    # Convert Pydantic models to dicts for API call
    metrics_dict = [{"metric": m.order_metric, "order_metric": m.order_by, "order": m.order, "other_metrics": query_metrics} for m in order_metrics]
    api_start_date, api_end_date = _format_api_date_range(start_date, end_date, granularity)
    
    data = {
        "start_date": api_start_date,
        "end_date": api_end_date,
        "metrics": metrics_dict,
        "module": module,
        "granularity": granularity,
        "top_num": top_num,
        "filters": filter_dict,
        "language": language,
    }

    print(f"\033[93m[Tool call]-[call_topN_api]: Calling API with data: {data}\033[0m")

    response = await async_send_request_with_token(MGMT_TOP_MODULE_API, data, context.context.token, MGMT_TOP_MODULE_API, "POST", 1, context.context.message_id)

    response_json = response.json()
    code = response_json.get("code", -1)

    # handle api outputs
    if code == 0:
        logger.info(f"[Tool return]-[call_topN_api]: response_json['data']: {response_json['data']}. ")
        return response_json["data"]
    else:
        raise response_json.get("msg", "Unknown error. ")

@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.MgmtTopNTool.value),
    readable_name_map={
        "English": "MGMT TopN Query Tool",
        "Chinese": "MGMT TopN查询工具",
    }
)

async def mgmt_topn_query_tool(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    order_metric_obj: OrderMetric,  # {"order_metric": "gross_revenue_actual", "order_by": "gross_revenue_actual", "order": "desc"}, {"order_metric": "gross_revenue_kpi", "order_by": "complete", "order": "desc"}
    query_metrics: list[str],
    module: str,  # only support studio or project
    top_num: int = 10,
    data_source: str | None = None,  # only valid when module="project": studio/publishing/dev
) -> str:
    """这个tool可以根据收入/利润/headcount等指标对游戏工作室(studio)和项目(project)进行排序，返回top_num个studio或project，同时也可以返回相关排序指标的数据和其它指标的数据。
    This tool is used when the user query includes any top N studio or project request for specific metric info,
    比如2025年10月收入最高的10个studio(游戏工作室),
    比如2025年techland工作室KPI完成率最高的2个project(项目或游戏).
    也用于“各个/每个/所有/全部 studio(project)”这类泛查询：先用本tool取Top10收敛范围，再用mgmt_metrics_query_tool查详细指标。
    如果query里比较排序的对象不是游戏工作室(studio)和项目(project)，则不应该调用这个tool
    
    Args:
        start_date (str): The start date to query. Format: YYYY-MM-DD.
        end_date (str): The end date to query. Format: YYYY-MM-DD.
        order_metric_obj (OrderMetric): OrderMetric should have "order_metric" (str), "order_by" (str, order_metric itself or "complete" or "growth" or other string) and "order" (str, "asc" or "desc"). e.g. {"order_metric": "gross_revenue_actual", "order_by": "gross_revenue_actual", "order": "desc"}, {"order_metric": "gross_revenue_kpi", "order_by": "complete", "order": "desc"}
        query_metrics (List[str]): List of metric_codes to query. **MUST ONLY use metric_codes from the supported list in this tool description. Any unsupported metric codes will cause the query to fail.**
        module (str): only support studio or project.
        top_num (int): Number of result to retrieve. Defaults to 1
        data_source (str|None): Optional, ONLY used when module="project".
            - empty/None: all projects (default)
            - "studio": IEGG studio 工作室发行的 projects
            - "publishing": 发行项目/游戏, 或IEGG publishing 自主发行的 projects
            - "dev": 正在研发中的project/项目/游戏
            If module != "project", data_source must be empty and will be ignored.

        强调一下，order_metric_obj是一个dict，必须包含order_metric、order_by和order三个字段。order_by的取值必须来自是order_metric_map里的有效值，
            1. 一般来说，每个指标都支持它自己作为order_by，即order_by=order_metric. 如果没有特殊说明，order_by的默认值就是指标order_metric本身。比如用户问题是"2025年实际利润最好的2个工作室"，则order_metric="net_profit_actual", order_by="net_profit_actual"
            2. order_by="growth"表示增长率，通常用于收入、利润、成本等指标，比如用户问题是"25年收入增长率最高的2个工作室"，则order_metric="gross_revenue_actual", order_by="growth"
            3. order_by="complete", 表示利润或收入的完成率，此时order_metric只可以取"net_profit_kpi" or "gross_revenue_kpi", 比如用户问题是"2025年哪个工作室的利润完成率表现最好"，则order_metric="net_profit_kpi", order_by="complete"

        module seletional rules:
            1、如果query只希望针对studio(游戏工作室)进行对比排序后取top n，则module="studio". 比如query为"2025年10月收入最高的10个studio(游戏工作室)"
            2、如果query针对某个具体studio(游戏工作室)下的project(项目或游戏)，希望对比排序后取top n，则module="project". 比如query为"2025年techland工作室KPI完成率最高的2个project(项目或游戏)"
            3、当 module="project" 时，如用户明确要区分发行方式，可用 data_source 进一步过滤：
               - data_source="studio"：IEGG studio 工作室发行
               - data_source="publishing"：发行项目/游戏，或IEGG publishing 自主发行
               - data_source="dev"：在研项目/游戏
    """

    logger.info(
        f"[Functool Call]-[mgmt_topn_query_tool]: start_date={start_date}, end_date={end_date}, order_metric_obj={order_metric_obj}, query_metrics={query_metrics}, module={module}, top_num={top_num}, data_source={data_source}."
    )

    start_time = time.time()
    message = ""
    data_results = []
    unit_info: list[str] = []
    # Human-friendly metric display (code + name) for tool output header.
    order_metric_obj_display = str(order_metric_obj)
    query_metrics_display = list(query_metrics or [])
    combine_ids = []
    studio_ids = []

    try:
        # LLM 传参兜底：纠正 order_metric / order_by 非法组合
        order_metric_obj = sanitize_order_metric(order_metric_obj)

        order_metrics = []
        order_metrics.append(order_metric_obj)
        # Convert Pydantic models to dicts for update_input
        order_metrics_dict = [{"order_metric": m.order_metric, "order_by": m.order_by, "order": m.order} for m in order_metrics]

        # Allow future dates when planned/scheduled metrics are involved.
        # TopN API may support future-dated KPI/forecast/calendar/milestone buckets.
        allow_future_metric_date = False
        try:
            om = str(getattr(order_metric_obj, "order_metric", "") or "").lower()
            if any(keyword in om for keyword in ["kpi", "forecast", "calendar", "milestone"]):
                allow_future_metric_date = True
            else:
                for m in (query_metrics or []):
                    ml = str(m or "").lower()
                    if any(keyword in ml for keyword in ["kpi", "forecast", "calendar", "milestone"]):
                        allow_future_metric_date = True
                        break
        except Exception:
            allow_future_metric_date = False

        # update_input to validate and update parameters
        update_list, order_metrics_dict, start_date, end_date, module, retry_info_list = update_input(
            order_metrics_dict,
            start_date,
            end_date,
            context.context.user_input,
            module,
            allow_future_start_date=allow_future_metric_date,
            allow_future_end_date=allow_future_metric_date,
        )
        message += "".join(update_list)

        normalized_module = str(module or "").strip()
        if normalized_module == "all_studio":
            module = "studio"
            message += "Module 'all_studio' is normalized to 'studio'. "
        elif normalized_module not in {"studio", "project"}:
            retry_msg = (
                f"Invalid parameter: module='{normalized_module}' is not supported by mgmt_topn_query_tool. "
                "Please retry with module='studio' or module='project'. "
                f"{TOPN_MODULE_SELECTION_RULES}"
            )
            logger.warning(f"[Functool Warning]-[mgmt_topn_query_tool]: {retry_msg}")
            message += retry_msg
            return message
        
        # Check for retry info
        if retry_info_list:
            logger.warning(f"[Functool Warning]-[mgmt_topn_query_tool]: {retry_info_list}")
            message += "".join(retry_info_list)
            return message
        
        # Convert back to Pydantic models
        order_metrics = [OrderMetric(**m) for m in order_metrics_dict]

        # Normalize/validate data_source (ONLY works when module="project")
        _ds = (data_source or "").strip().lower()
        if module != "project":
            # For non-project modules, enforce "empty" by ignoring any provided value.
            if _ds:
                logger.warning(
                    f"[Functool Warning]-[mgmt_topn_query_tool]: data_source is only valid when module='project'. Ignoring data_source='{_ds}' for module='{module}'."
                )
            _ds = ""
        else:
            if _ds and _ds not in {"studio", "publishing", "dev"}:
                _msg = (
                    "Invalid parameter: data_source must be empty or one of ['studio','publishing','dev'] "
                    "when module='project'. "
                )
                logger.warning(f"[Functool Warning]-[mgmt_topn_query_tool]: {_msg} Got data_source='{_ds}'.")
                message += _msg
                return message

        # get language from game context
        # - api_language: normalized for backend API
        # - display_language: raw context language used to decide formatting units
        display_language = context.context.language or "en"
        api_language = "zh" if is_chinese_language(display_language) else "en"
        
        # Get IDs based on module name
        # For "project" module, use combine_ids; for "studio" module, use studio_ids
        if module == "project":
            # Use combine_ids from context mapping keys (all project IDs)
            combine_id_to_name = getattr(context.context, "combine_id_to_name", {}) or {}
            if isinstance(combine_id_to_name, dict):
                combine_ids = [str(k) for k in combine_id_to_name.keys() if str(k).strip()]
        elif module == "studio":
            # Use studio_ids from context mapping keys (all studio IDs)
            studio_id_to_name = getattr(context.context, "studio_id_to_name", {}) or {}
            if isinstance(studio_id_to_name, dict):
                studio_ids = [str(k) for k in studio_id_to_name.keys() if str(k).strip()]

        # Check if metrics are supported, if not, add to retry_info_list
        # Metric map should be loaded in agent's dynamic_instructions
        metric_by_code = context.context.mgmt_info.get("metric_by_code", {})
        if not metric_by_code:
            logger.warning("[Functool Warning]-[mgmt_topn_query_tool]: Metric map not found in context. It should be loaded in agent's dynamic_instructions.")

        def _metric_display(metric_code: str) -> str:
            code = str(metric_code or "").strip()
            if not code:
                return code
            try:
                mi = metric_by_code.get(code)
                if isinstance(mi, dict):
                    nm = str(mi.get("metric_name") or "").strip()
                    if nm:
                        return f"{code}({nm})"
            except Exception:
                pass
            return code

        # Precompute display strings for the user-facing tool header (no need to rename result keys).
        try:
            _m = (order_metrics[0] if isinstance(order_metrics, list) and order_metrics else order_metric_obj)
            order_metric_obj_display = (
                f"order_metric='{_metric_display(getattr(_m, 'order_metric', ''))}' "
                f"order_by='{_metric_display(getattr(_m, 'order_by', ''))}' "
                f"order='{str(getattr(_m, 'order', '') or '')}'"
            )
        except Exception:
            order_metric_obj_display = str(order_metric_obj)

        try:
            query_metrics_display = [_metric_display(x) for x in (query_metrics or [])]
        except Exception:
            query_metrics_display = list(query_metrics or [])

        # Helper function to extract IDs from topN API results and add to context
        def extract_ids_from_results(result_data, module_type):
            """Extract IDs from topN API results and add to context for later use"""
            if not result_data or "rankings" not in result_data:
                return
            
            extracted_ids = []
            extracted_name_by_id: dict[str, str] = {}
            for metric_name, metric_data in result_data["rankings"].items():
                if "items" in metric_data:
                    for item in metric_data["items"]:
                        item_id = item.get("id", "")
                        if item_id and item_id.strip() and item_id not in extracted_ids:
                            extracted_ids.append(item_id)
                        try:
                            _id = str(item_id or "").strip()
                            _nm = str(item.get("name") or item.get("title") or item.get("studio_name") or item.get("project_name") or "").strip()
                            if _id and _nm and _id not in extracted_name_by_id:
                                extracted_name_by_id[_id] = _nm
                        except Exception:
                            pass
            
            # Add extracted IDs to context based on module type
            if module_type == "studio":
                # IDs are studio_ids; store in studio_id_to_name (keys are the ID list)
                current_name_map = getattr(context.context, "studio_id_to_name", {}) or {}
                if not isinstance(current_name_map, dict):
                    current_name_map = {}

                # Normalize existing keys
                normalized_map: dict[str, str] = {}
                for k, v in current_name_map.items():
                    _sid = str(k or "").strip()
                    if not _sid:
                        continue
                    normalized_map[_sid] = str(v or "")

                # Add extracted IDs with best-effort names
                for extracted_id in extracted_ids:
                    _sid = str(extracted_id or "").strip()
                    if not _sid:
                        continue
                    if _sid not in normalized_map:
                        normalized_map[_sid] = ""
                    _name = str(extracted_name_by_id.get(_sid, "") or "").strip()
                    if _name and not str(normalized_map.get(_sid, "") or "").strip():
                        normalized_map[_sid] = _name

                context.context.studio_id_to_name = normalized_map
            elif module_type == "project":
                # IDs are combine_ids
                current_map = getattr(context.context, "combine_id_to_name", {}) or {}
                if not isinstance(current_map, dict):
                    current_map = {}
                for extracted_id in extracted_ids:
                    eid = str(extracted_id or "").strip()
                    if eid:
                        if eid not in current_map:
                            current_map[eid] = ""
                        # Best-effort id -> name mapping (if backend returns it)
                        _name = str(extracted_name_by_id.get(eid, "") or "").strip()
                        if _name and not str(current_map.get(eid, "") or "").strip():
                            current_map[eid] = _name
                context.context.combine_id_to_name = current_map

        # 区分metric时间粒度，分别请求后端api
        monthly_metrics = [m for m in query_metrics if "monthly" in metric_by_code.get(m).get("granularity", [])]
        yearly_metrics = [m for m in query_metrics if "yearly" in metric_by_code.get(m).get("granularity", [])]

        if len(monthly_metrics) > 0:
            res_monthly = await call_topN_api(
                context,
                start_date,
                end_date,
                order_metrics,
                monthly_metrics,
                module,
                "monthly",
                top_num,
                studio_ids,
                combine_ids,
                _ds or None,
                api_language,
            )
            # Extract IDs from results and add to context
            extract_ids_from_results(res_monthly, module)
            data_results.append(res_monthly)
        if len(yearly_metrics) > 0:
            res_yearly = await call_topN_api(
                context,
                start_date,
                end_date,
                order_metrics,
                yearly_metrics,
                module,
                "yearly",
                top_num,
                studio_ids,
                combine_ids,
                _ds or None,
                api_language,
            )
            # Extract IDs from results and add to context
            extract_ids_from_results(res_yearly, module)
            data_results.append(res_yearly)

        # set sensitive data flag, used for web tips
        if data_results:
            context.context.topn_tool_called = True
            set_sensitive_data_flag(context.context)
            append_mgmt_reference_for_module(context, "business")
            # Transform TopN results for display:
            # - scale percent metrics (ratio -> 0-100),
            # - format numbers (K/M/G vs 万/亿, percent as 'xx.xx%'),
            # - rename metric codes to metric_names (incl. *_growth_rate / *_mom / *_yoy suffixes),
            # - collect unit_info for metrics with a declared unit.
            data_results, unit_info = process_topn_rankings(
                data_results,
                language=display_language,
                metric_by_code=metric_by_code,
                digits=2,
            )

        #logger.info(f"[Functool Return]-[mgmt_topn_query_tool]: Get data with results: {data_results}.")

    except Exception as e:
        logger.warning(f"[mgmt_topn_query_tool Exception]: error msg = {str(e)}, traceback = {traceback.format_exc()}")
        message += f"Encounter error in retrieving MGMT data: {str(e)}. \n"

    log_metrics("mgmt_topn_query_tool", "0", round((time.time() - start_time) * 1000, 2))

    # User-facing hint for generic "each/all studio/project" queries narrowed to Top10
    try:
        _uq = str(getattr(context.context, "user_input", "") or "")
        _rq = str(getattr(getattr(context.context, "planner_context", None), "rephrased_question", "") or "")
        _text = f"{_uq}\n{_rq}".lower()
        _each_all_terms = ["各个", "每个", "所有", "全部", "all ", "each ", "every ", "per "]
        _hit_each_all = any(t in _text for t in _each_all_terms)
        if _hit_each_all and module in ["studio", "project"] and int(top_num) == 10:
            if is_chinese_language(context.context.language):
                message += "提示：本次仅展示Top10；如需更多数据，请指定具体工作室/项目（游戏）再查询。 "
            else:
                message += "Note: only Top10 is shown. For more data, please query a specific studio/project (game). "
    except Exception:
        pass

    unit_info_str = "".join(unit_info) if unit_info else ""
    logger.info(f"[Functool Return]-[mgmt_topn_query_tool]: start_date={start_date}, end_date={end_date}, order_metric_obj={order_metric_obj}, query_metrics={query_metrics}, module={module}, combine_ids={combine_ids}, studio_ids={studio_ids}, top_num={top_num}, data_results={data_results}, unit_info={unit_info}, message={message}.")
    return f"[mgmt_topn_query_tool]Querying top {top_num} for order_metric_obj({order_metric_obj_display}) and query_metrics({query_metrics_display}) from {start_date} to {end_date}, the results is {data_results}. {unit_info_str}{message}"[:8000000]
