from __future__ import annotations
from run_context_wrapper import RunContextWrapper
from loguru import logger
import time
import traceback
import uuid
import copy
from typing import List, Optional

from typing import Any
from dateutil import parser

from utils.cls import log_metrics
from utils.context import GameContext
from utils.constants import ToolName, ChatSource
from utils.tool_common import get_tool_enabled, function_tool
from utils.helper import default_tool_error_function
from utils.databrain_api import async_send_request_with_token
from utils.update_input import update_input, categorize_metrics_by_granularity_and_chart
from utils.databrain_api import MGMT_METRIC_CHART_API, MGMT_METRIC_VALUE_API
from utils.sensitive_data import set_sensitive_data_flag
from utils.bidata import MGMT_SYSTEM_NAME
from utils.mgmt_reference_utils import append_mgmt_reference_for_module
from utils.mgmt_metrics_dataframe_utils import (
    json_to_csv_string,
    rename_csv_headers_robust,
    count_valid_res,
)
from utils.mgmt_metrics_result_utils import (
    normalize_entity_key,
    make_name_id_label,
    rename_description_keys,
    merge_results_by_entity_key,
)
from utils.mgmt_metrics_formatters import (
    format_csv_numbers,
    get_percent_metrics,
    infer_percent_metrics_from_records,
    scale_percent_metrics_in_records,
)


class MgmtException(Exception):
    """Custom exception for MGMT agent."""
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def _format_api_date_range(start_date: str, end_date: str, granularity: str) -> tuple[str, str]:
    start_dt = parser.parse(start_date)
    end_dt = parser.parse(end_date)
    if str(granularity or "").lower() == "yearly":
        start_dt = start_dt.replace(month=1, day=1)
        end_dt = end_dt.replace(month=12, day=31)
    return start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")


'''
有两个可以用来查询指标的Mgmt后端api，入参基本一样，输出结果格式一个有BiData，一个没有，
1) call_metric_value_api，基本可以查所有数值类型的指标，但返回结果的格式不是BiData。另外，支持group by date，不传表示聚合
2) call_metric_chart_api，返回结果的格式是BiData，只能查询部分指标，也就是产品期望输出图形趋势的那部分指标
'''
async def call_metric_value_api(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    metrics: list[str],
    module: str = "business",  # 模块: business,all_studio,studio,publishing,project
    granularity: str = "monthly",  # 时间粒度: monthly,yearly
    language: str = "en",  # 语言设置，支持 "zh"（中文）或 "en"（英文），默认为 "en"
    studio_id: str | None = None,  # studio id (module = "studio"时必填)
    combine_id: str | None = None,  # combine id (module = "project"时必填)
) -> Any | None:

    # 设置 filters
    filter_dict = {}
    if studio_id != None and studio_id != "":
        filter_dict["studio_id"] = str(studio_id)  # API expects a string, single ID only
    if combine_id != None and combine_id != "":
        filter_dict["combine_id"] = str(combine_id)  # API expects a string, single ID only

    # 设置 group_by: monthly/yearly 都保留时间维度，后续才能生成对应粒度的 describe data
    group_by_list = ["date"] if granularity in ["monthly", "yearly"] else []
    api_start_date, api_end_date = _format_api_date_range(start_date, end_date, granularity)

    data = {
        "start_date": api_start_date,
        "end_date": api_end_date,
        "metrics": metrics,
        "module": module,
        "granularity": granularity,
        "filters": filter_dict,
        "language": language,
        "group_by": group_by_list,
    }

    logger.info(f"[API call]-[call_metric_value_api]: data: {data}. ")
    print(f"\033[93m[API call]-[call_metric_value_api]: Calling API with data: {data}\033[0m")

    response = await async_send_request_with_token(MGMT_METRIC_VALUE_API, data, context.context.token, MGMT_METRIC_VALUE_API, "POST", 1, context.context.message_id)

    response_json = response.json()
    code = response_json.get("code", -1)

    # handle api outputs
    if code == 0:
        logger.info(f"[API return success]-[call_metric_value_api]: response_json['data']: {response_json['data']}. ")
        return response_json["data"]
    else:
        logger.warning(f"[API return failed]-[call_metric_value_api]: {response_json['msg']}. ")
        return None

# 返回结果的格式是BiData，只能查询部分指标，也就是产品期望输出图形趋势的那部分指标
async def call_metric_chart_api(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    metrics: list[str],
    module: str = "business",  # 模块: business,all_studio,studio,publishing,project
    granularity: str = "monthly",  # 时间粒度: monthly,yearly
    language: str = "en",  # 语言设置，支持 "zh"（中文）或 "en"（英文），默认为 "en"
    studio_id: str | None = None,  # studio id (module = "studio"时必填)
    combine_id: str | None = None,  # combine id (module = "project"时必填)
) -> Any | None:

    # 设置 filters
    filter_dict = {}
    if studio_id != None and studio_id != "":
        filter_dict["studio_id"] = str(studio_id)  # API expects a string, single ID only
    if combine_id != None and combine_id != "":
        filter_dict["combine_id"] = str(combine_id)  # API expects a string, single ID only

    api_start_date, api_end_date = _format_api_date_range(start_date, end_date, granularity)

    data = {
        "start_date": api_start_date,
        "end_date": api_end_date,
        "metrics": metrics,
        "module": module,
        "granularity": granularity,
        "filters": filter_dict,
        "language": language,
    }

    logger.info(f"[API call]-[call_metric_chart_api]: data: {data}. ")
    print(f"\033[93m[API call]-[call_metric_chart_api]: Calling API with data: {data}\033[0m")

    response = await async_send_request_with_token(MGMT_METRIC_CHART_API, data, context.context.token, MGMT_METRIC_CHART_API, "POST", 1, context.context.message_id)

    response_json = response.json()
    code = response_json.get("code", -1)

    # handle api outputs
    if code == 0:
        logger.info(f"[API return success]-[call_metric_chart_api]: response_json['data']: {response_json['data']}. ")
        return response_json["data"]
    else:
        logger.warning(f"[API return failed]-[call_metric_chart_api]: {response_json['msg']}. ")
        return None

# call api获取数据
# 数据格式转换
# bidata处理
async def call_api_and_handle_data(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    metrics: list[str],
    module: str = "business",  # 模块: business,all_studio,studio,publishing,project
    granularity: str = "monthly",  # 时间粒度: monthly,yearly
    if_chart: bool = False,  # 是否为产品指定的图表展示的指标
    language: str = "en",  # 语言设置，支持 "zh"（中文）或 "en"（英文），默认为 "en"
    studio_id: str | None = None,  # studio id (module = "studio"时必填)
    combine_id: str | None = None,  # combine id (module = "project"时必填)
    metric_by_code: dict[str, Any] | None = None,  # metric map by code for unit info
):

    res_csv = ""
    description_str = ""
    bi_data_id = ""
    unit_info = []
    api_metrics_info: list[dict] = []
    _return_value = None  # 用于 finally 统一打印

    # Display language follows user setting in context (source of truth)
    display_language = context.context.language or language
    percent_metrics = get_percent_metrics(metrics, metric_by_code)

    def _records_with_granularity(records: Any, granularity_value: str) -> Any:
        """Add requested granularity to display records so monthly/yearly rows stay distinguishable after merge."""
        if not isinstance(records, list):
            return records
        annotated_records = []
        for record in records:
            if not isinstance(record, dict):
                annotated_records.append(record)
                continue
            annotated_record = {"granularity": granularity_value}
            annotated_record.update(record)
            if not str(annotated_record.get("granularity") or "").strip():
                annotated_record["granularity"] = granularity_value
            annotated_records.append(annotated_record)
        return annotated_records

    try:
        if if_chart:
            res = await call_metric_chart_api(context, start_date, end_date, metrics, module, granularity, language, studio_id, combine_id)
            if res is None:
                return None

            # IMPORTANT: keep a raw copy for BiData. Any scaling/formatting below is for display only.
            res_raw_for_bidata = copy.deepcopy(res) if isinstance(res, dict) else res
            if isinstance(res, dict):
                api_metrics_info = res.get("metrics_info") or []

            # For chart API, metrics_info may include per-metric unsupported_aggregation.
            # Pass it directly to dataframe describe() filtering.
            unsupported_agg_by_name = {}
            if isinstance(api_metrics_info, list) and api_metrics_info:
                for mi in api_metrics_info:
                    if not isinstance(mi, dict):
                        continue
                    data_key = str(mi.get("data_key") or "").strip()
                    unsupported = mi.get("unsupported_aggregation")
                    if data_key and isinstance(unsupported, list) and unsupported:
                        s = set(unsupported)
                        unsupported_agg_by_name[data_key] = s
                        # Also index by display name if the backend uses it as column key.
                        name = mi.get("name")
                        if isinstance(name, str) and name.strip():
                            unsupported_agg_by_name[name.strip()] = s

            # Include derived percent columns (e.g. *_growth_rate, *_complete_rate) from returned records
            if isinstance(res, dict) and isinstance(res.get("data"), list):
                percent_metrics |= infer_percent_metrics_from_records(res.get("data"), metric_by_code=metric_by_code)
            # Scale percent metrics in the display payload (0-100) before any formatting.
            # Do NOT scale the raw payload stored in BiData.
            if isinstance(res, dict) and isinstance(res.get("data"), list) and percent_metrics:
                scale_percent_metrics_in_records(res["data"], percent_metrics)
            display_records = _records_with_granularity(res.get("data") if isinstance(res, dict) else None, granularity)
            # convert to csv with process_dataframe
            res_csv, description_str = json_to_csv_string(
                display_records,
                metrics=metrics,
                granularity=granularity,
                language=display_language,
                percent_metrics=percent_metrics,
                metric_by_code=metric_by_code,
                unsupported_aggregation_by_name=unsupported_agg_by_name,
            )

            # set bidata
            valid_res_num = count_valid_res(res)
            #print(f"\033[93m[mgmttest call_api_and_handle_data]: res: {res}, valid_res_num: {valid_res_num}\033[0m")
            if res is not None and valid_res_num > 2:
                bi_data_id = "mgmt_agent_" + str(uuid.uuid4())
                bi_data = {"code": 0, "msg": "ok", "ext_info": {}, "system": MGMT_SYSTEM_NAME, "data": res_raw_for_bidata, "data_id": bi_data_id}
                context.context.data.append(bi_data)
        else:
            res = await call_metric_value_api(context, start_date, end_date, metrics, module, granularity, language, studio_id, combine_id)
            if res is None:
                return None

            # Include derived percent columns (e.g. *_growth_rate, *_complete_rate) from returned records
            if isinstance(res, list):
                percent_metrics |= infer_percent_metrics_from_records(res, metric_by_code=metric_by_code)
            # Scale percent metrics in the actual data payload (0-100) before any formatting
            if isinstance(res, list) and percent_metrics:
                scale_percent_metrics_in_records(res, percent_metrics)
            display_records = _records_with_granularity(res, granularity)
            # convert to csv with process_dataframe
            res_csv, description_str = json_to_csv_string(
                display_records,
                metrics=metrics,
                granularity=granularity,
                language=display_language,
                percent_metrics=percent_metrics,
                metric_by_code=metric_by_code,
            )

        # Format CSV numeric values for display based on language and per-column value_type:
        # percent -> 'xx.xx%', numerical -> integer (0 decimals), float/unknown -> 2 decimals.
        res_csv = format_csv_numbers(
            res_csv,
            language=display_language,
            percent_metrics=percent_metrics,
            digits=2,
            metric_by_code=metric_by_code,
        )

        # Generate unit_info similar to dashboard_metrics_query_tool
        if metric_by_code and metrics:
            for metric_code in metrics:
                metric_info = metric_by_code.get(metric_code)
                if metric_info and metric_info.get("unit"):
                    unit = metric_info.get("unit", "")
                    # Only add if unit is not empty and not "-"
                    if unit and unit != "-":
                        # Prefer metric name (指标名) in unit_info
                        _display_name = ""
                        try:
                            _display_name = str(metric_info.get("metric_name") or "").strip()
                        except Exception:
                            _display_name = ""
                        unit_info.append(f"{(_display_name or metric_code)} has unit of {unit}. ")

        # Generate unit_info similar to dashboard_metrics_query_tool
        if metric_by_code and metrics:
            for metric_code in metrics:
                metric_info = metric_by_code.get(metric_code)
                if metric_info and metric_info.get("unit"):
                    unit = metric_info.get("unit", "")
                    # Only add if unit is not empty and not "-"
                    if unit and unit != "-":
                        # Prefer metric name (指标名) in unit_info
                        _display_name = ""
                        try:
                            _display_name = str(metric_info.get("metric_name") or "").strip()
                        except Exception:
                            _display_name = ""
                        unit_info.append(f"{(_display_name or metric_code)} has unit of {unit}. ")

        # Build header rename map.
        # - keys may repeat between metric registry and API-derived fields; API name takes precedence.
        metric_names_map: dict[str, str] = {}

        def _set_metric_name(key: str, name: str, *, prefer: bool = False):
            k = (key or "").strip()
            n = (name or "").strip()
            if not k or not n:
                return
            if k not in metric_names_map:
                metric_names_map[k] = n
            else:
                if prefer:
                    metric_names_map[k] = n

        # 1) Registry names (requested metrics)
        if metric_by_code and metrics:
            for metric_code in metrics:
                metric_info = metric_by_code.get(metric_code)
                if not isinstance(metric_info, dict):
                    continue
                metric_name = str(metric_info.get("metric_name") or "").strip()
                if metric_name:
                    _set_metric_name(metric_code, metric_name, prefer=False)

        # 2) API-returned names for chart responses (covers derived columns like *_growth_rate/*_mom/*_yoy)
        if if_chart and isinstance(api_metrics_info, list) and api_metrics_info:
            for mi in api_metrics_info:
                if not isinstance(mi, dict):
                    continue
                data_key = str(mi.get("data_key") or "").strip()
                name = str(mi.get("name") or "").strip()
                if data_key and name:
                    _set_metric_name(data_key, name, prefer=True)

        # replace metric name
        res_csv = rename_csv_headers_robust(res_csv, metric_names_map)

        # Rename describe keys to metric_name + agg suffix (指标名 + 聚合形式)
        description_str = rename_description_keys(description_str, metric_names_map)

        _return_value = {"data": res_csv, "description": description_str, "data_id": bi_data_id, "unit_info": unit_info}
        return _return_value
    except Exception as e:
        logger.warning(f"[call_api_and_handle_data Exception]: {str(e)}")
        return None
    finally:
        _rv_summary = None
        if _return_value is not None:
            _rv_summary = f"data_id={_return_value.get('data_id', '')}, description={str(_return_value.get('description', ''))[:200]}, unit_info={_return_value.get('unit_info', [])}"
        logger.info(
            f"[call_api_and_handle_data] 入参: start_date={start_date}, end_date={end_date}, "
            f"metrics={metrics}, module={module}, granularity={granularity}, if_chart={if_chart}, "
            f"language={language}, studio_id={studio_id}, combine_id={combine_id} | "
            f"返回: {_rv_summary if _rv_summary else 'None'}"
        )


async def call_api_and_handle_decision_point_data(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    module: str,
    granularity: str,
    language: str,
    studio_id: str | None = None,
    combine_id: str | None = None,
) -> dict[str, Any] | None:
    """
    Special handler ONLY for metric `decision_point`.
    It flattens backend nested response: {items: [{date, decision_point: [...]}]} into a readable CSV.
    """
    try:
        display_language = context.context.language or language
        res = await call_metric_value_api(
            context,
            start_date,
            end_date,
            ["decision_point"],
            module,
            granularity,
            language,
            studio_id,
            combine_id,
        )
        if res is None:
            return None

        import html as _html
        import re as _re
        import pandas as _pd

        def _html_to_text(s: Any, *, limit: int = 4000) -> str:
            if s is None:
                return ""
            try:
                t = str(s)
            except Exception:
                return ""
            if not t:
                return ""
            t = t.replace("\r\n", "\n").replace("\r", "\n")
            t = _re.sub(r"(?is)<\s*br\s*/?\s*>", "\n", t)
            t = _re.sub(r"(?is)</\s*p\s*>", "\n", t)
            t = _re.sub(r"(?is)<\s*/\s*div\s*>", "\n", t)
            t = _re.sub(r"(?is)</\s*li\s*>", "\n", t)
            t = _re.sub(r"(?is)<[^>]+>", "", t)
            t = _html.unescape(t)
            t = _re.sub(r"[ \t]+\n", "\n", t)
            t = _re.sub(r"\n{3,}", "\n\n", t).strip()
            if limit and len(t) > limit:
                t = t[:limit].rstrip() + " ..."
            return t

        items: Any = []
        if isinstance(res, dict):
            items = res.get("items") or []
        elif isinstance(res, list):
            items = res

        rows: list[dict[str, Any]] = []
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                item_date = str(it.get("date") or "").strip()
                dps = it.get("decision_point") or []
                if not isinstance(dps, list):
                    continue
                for dp in dps:
                    if not isinstance(dp, dict):
                        continue
                    dp_date = str(dp.get("date") or "").strip() or item_date
                    rows.append(
                        {
                            "date": dp_date or item_date,
                            "game_id": str(dp.get("game_id") or "").strip(),
                            "name": str(dp.get("name") or "").strip(),
                            "urgency": str(dp.get("urgency") or "").strip(),
                            "status": str(dp.get("status") or "").strip(),
                            "expected_time": str(dp.get("expected_time") or "").strip(),
                            "issue": _html_to_text(dp.get("issue")),
                            "bos": _html_to_text(dp.get("bos")),
                        }
                    )

        res_csv = ""
        if rows:
            df = _pd.DataFrame(rows)
            desired_cols = ["date", "game_id", "name", "urgency", "status", "expected_time", "issue", "bos"]
            df = df.reindex(columns=[c for c in desired_cols if c in df.columns])
            res_csv = df.to_csv(index=False)

        # decision_point has no numeric unit/describe; keep empty.
        return {"data": res_csv, "description": "", "data_id": "", "unit_info": []}
    except Exception as e:
        logger.warning(f"[call_api_and_handle_decision_point_data Exception]: {str(e)}")
        return None


@function_tool(
    failure_error_function=default_tool_error_function,
    is_enabled=get_tool_enabled(ToolName.MgmtMetricsQueryTool.value),
    readable_name_map={
        "English": "MGMT Metrics Query Tool",
        "Chinese": "MGMT指标查询工具",
    }
)

async def mgmt_metrics_query_tool(
    context: RunContextWrapper[GameContext],
    start_date: str,
    end_date: str,
    metrics: list[str],
    module: str,  # 模块（business，all_studio,studio,publishing,project)
) -> str:
    """Query MGMT metrics for IEGG overall/team/single game commercialization and management decisions.

    MGMT主要承载 IEGG整体/团队/单游戏商业化变现相关、管理层决议管理，比如市场花费、收入、利润、预估、KPI、HC等数据
    If no specific time period is provided, the default time range is from January of last month's year to the end of last month.

    **CRITICAL: You MUST ONLY use supported metric_codes listed in the tool description below. Do NOT use any metric codes that are not in the supported list, as this will cause the query to fail.**

    **IMPORTANT: “各个/每个/所有/全部 studio(project)”泛查询**
    - 这类问题不要直接展开查询全部 studio/project（会导致输出过大且耗时）。
    - 应先调用 mgmt_topn_query_tool 取 Top10（top_num=10）收敛范围（默认用 gross_revenue_actual 排序；若用户明确指定指标，则用用户指定指标排序）。
    - 再调用一次本tool查询用户真正关心的 metrics（TopN 的 ID 会自动写入 context，无需手动填入）。

    Args:
        start_date (str): The start date to query. Format: YYYY-MM-DD.
        end_date (str): The end date to query. Format: YYYY-MM-DD.
        metrics (List[str]): List of metric_codes to query. **MUST ONLY use metric_codes from the supported list in this tool description. Any unsupported metric codes will cause the query to fail.**
        module (str): The module to query. Choose from business/all_studio/studio/publishing/project. Module seletional rules see mgmt agent description for more details.
        ** Do NOT manually input any ids like studio_id or combine_id, it will be automatically filled in by the tool based on the module and user query. **
        ** IMPORTANT: TopN Follow-up Questions **
        If the user's question is a follow-up to a topN query (e.g., asking for detailed metrics of studios/projects from a topN result), you should call this tool ONLY ONCE with the correct module parameter. The tool will automatically extract and use the required studio_ids or combine_ids from the context (these IDs are automatically populated by mgmt_topn_query_tool when it extracts results). Do NOT call this tool multiple times for each ID separately.
        Note: The complete list of supported metric_codes is dynamically loaded and appended to this tool description at runtime. See the "SUPPORTED METRIC_CODES" section below.
    """

    logger.info(
        f"[Functool Call]-[mgmt_metrics_query_tool]: metrics={metrics}, start_date={start_date}, end_date={end_date}."
    )

    start_time = time.time()
    message = ""
    data_results = []
    # Initialize variables to avoid "referenced before assignment" errors
    language = "en"  # Default language
    studio_id = None
    combine_id = None
    DECISION_POINT_METRIC_CODE = "decision_point"
    topn_followup = bool(getattr(context.context, "topn_tool_called", False))

    try:
        # Hard-coded module override:
        # If user asks about IEGG Central Publishing, always use project module.
        _uq = context.context.user_input
        _rq = context.context.planner_context.rephrased_question
        _text = f"{_uq}\n{_rq}".lower()
        if any(k in _text for k in ["iegg central publishing", "central publishing", "中央发行"]):
            module = "project"

        # Allow future dates for metrics whose data may be scheduled/planned ahead.
        # For all other metrics, keep the historical-only safeguard (cap to today).
        allow_future_metric_date = False
        try:
            for m in (metrics or []):
                ml = str(m or "").lower()
                if any(keyword in ml for keyword in ["kpi", "forecast", "calendar", "milestone"]):
                    allow_future_metric_date = True
                    break
        except Exception:
            allow_future_metric_date = False

        # TODO: Implement update_input to validate and update parameters
        requested_metrics = list(metrics or [])
        update_list, metrics, start_date, end_date, module, retry_info_list = update_input(
            metrics,
            start_date,
            end_date,
            context.context.user_input,
            module,
            allow_future_start_date=allow_future_metric_date,
            allow_future_end_date=allow_future_metric_date,
        )
        message += "".join(update_list)

        def _is_decision_point_metric(m: Any) -> bool:
            try:
                return str(m or "").strip().lower() == DECISION_POINT_METRIC_CODE
            except Exception:
                return False

        # If decision_point is requested, query it separately (special module rules).
        decision_point_metrics = [m for m in (metrics or []) if _is_decision_point_metric(m)]
        main_metrics = [m for m in (metrics or []) if not _is_decision_point_metric(m)]

        # Determine the effective module for main queries first (may be overridden by TopN follow-up
        # and by missing combine_id when module=project).
        module_main = module

        # If this query is a follow-up to TopN, module is restricted to studio/project based on IDs in context.
        if context.context.topn_tool_called:
            _studio_map = getattr(context.context, "studio_id_to_name", {}) or {}
            if isinstance(_studio_map, dict) and len(_studio_map) > 0:
                module_main = "studio"
            else:
                module_main = "project"

        _combine_id_to_name = getattr(context.context, "combine_id_to_name", {}) or {}
        if not isinstance(_combine_id_to_name, dict):
            _combine_id_to_name = {}
        _studio_id_to_name = getattr(context.context, "studio_id_to_name", {}) or {}
        if not isinstance(_studio_id_to_name, dict):
            _studio_id_to_name = {}

        # Project/studio queries require their corresponding entity IDs.
        # Do not silently fall back to a broader module; that can return plausible but wrong-scope data.
        if module_main == "project":
            _combine_ids_tmp = [str(k) for k in _combine_id_to_name.keys() if str(k).strip()]
            if not _combine_ids_tmp:
                message += "Warning: module=project requires a project ID (combine_id), but no project ID was recognized. Please retry after identifying the target project; the query was not executed. "
                return message
        elif module_main == "studio":
            _studio_ids_tmp = [str(k) for k in _studio_id_to_name.keys() if str(k).strip()]
            if not _studio_ids_tmp:
                message += "Warning: module=studio requires a studio ID (studio_id), but no studio ID was recognized. Please retry after identifying the target studio; the query was not executed. "
                return message

        # Keep original module for main queries; decision_point may use a different module.
        module_for_decision_point: str | None = module_main
        if decision_point_metrics:
            if module_main == "business":
                module_for_decision_point = "publishing"
                message += "提示：只有IEGG自发行业务有项目团队决议相关信息。已将 decision_point 指标按 publishing 模块单独查询。"
            elif module_main == "studio":
                module_for_decision_point = None
                message += "提示：studio发行业务没有项目团队决议信息，decision_point 指标将不会查询。"
            else:
                # publishing / project / all_studio keep module unchanged
                module_for_decision_point = module_main

        # Check if metrics are supported, if not, add to retry_info_list
        # Metric map should be loaded in agent's dynamic_instructions
        metric_by_code = context.context.mgmt_info.get("metric_by_code", {})
        if not metric_by_code:
            logger.warning("[Functool Warning]-[mgmt_metrics_query_tool]: Metric map not found in context. It should be loaded in agent's dynamic_instructions.")

        # IMPORTANT: Always call categorize_metrics_by_granularity_and_chart to validate metrics
        # This function should be called even if metrics is empty or retry_info_list is not empty,
        # as it provides important validation and categorization logic
        # Record the length of update_list before calling categorize_metrics_by_granularity_and_chart
        # to capture any new warnings added during module validation
        update_list_len_before = len(update_list)
        monthly_chart_metrics, monthly_no_chart_metrics, yearly_chart_metrics, yearly_no_chart_metrics, unsupported_metrics, all_supported_metrics, retry_info_list = categorize_metrics_by_granularity_and_chart(
            main_metrics,
            metric_by_code,
            retry_info_list,
            module=module_main,
            update_list=update_list,
        )
        # Add any new warnings from module validation to message
        if len(update_list) > update_list_len_before:
            message += "".join(update_list[update_list_len_before:])

        # Log validation results
        if unsupported_metrics:
            logger.warning(f"[Functool Warning]-[mgmt_metrics_query_tool]: Unsupported metrics: {unsupported_metrics}")

        if retry_info_list:
            logger.warning(f"[Functool Warning]-[mgmt_metrics_query_tool]: {retry_info_list}")
            message += "".join(retry_info_list)
            return message

        # Get language, studio_ids, combine_ids from game context
        if context.context.language:
            language = context.context.language
            if language.lower() == "chinese" or language.lower() == "zh":
                language = "zh"
        else:
            language = "en"

        # Get IDs based on module name
        # For "project" module, use combine_ids; for "studio" module, use studio_ids
        combine_id_to_name = getattr(context.context, "combine_id_to_name", {}) or {}
        if not isinstance(combine_id_to_name, dict):
            combine_id_to_name = {}
        studio_id_to_name = getattr(context.context, "studio_id_to_name", {}) or {}
        if not isinstance(studio_id_to_name, dict):
            studio_id_to_name = {}

        def _get_id_lists_for_module(mod: str) -> tuple[list[str], list[str]]:
            """Return (combine_ids, studio_ids) to use for a given module."""
            _combine_ids: list[str] = []
            _studio_ids: list[str] = []
            if mod == "project":
                _combine_ids = [str(k) for k in (combine_id_to_name or {}).keys() if str(k).strip()]
            elif mod == "studio":
                _studio_ids = [str(k) for k in (studio_id_to_name or {}).keys() if str(k).strip()]
            return _combine_ids, _studio_ids

        combine_ids, studio_ids = _get_id_lists_for_module(module_main)

        #logger.info(f"[mgmt_metrics_query_tool]print module/studio_ids/combine_ids: {module_main}, {studio_ids}, {combine_ids}")

        # Helper function to call API for each ID separately (no merging)
        async def call_api_for_ids(metrics_list, granularity, if_chart, id_list, id_type, module_for_query: str):
            """Call API for each ID separately and add results to data_results with labels"""
            for single_id in id_list:
                try:
                    if id_type == "combine_id":
                        res = await call_api_and_handle_data(context, start_date, end_date, metrics_list, module_for_query, granularity, if_chart, language, None, single_id, metric_by_code)
                        # Add label to identify this result belongs to a specific project

                    else:  # studio_id
                        res = await call_api_and_handle_data(context, start_date, end_date, metrics_list, module_for_query, granularity, if_chart, language, single_id, None, metric_by_code)
                        # Add label to identify this result belongs to a specific company

                    if res is not None:
                        entity_type = "project" if id_type == "combine_id" else "studio"
                        res["entity_type"] = entity_type
                        res["entity_id"] = str(single_id)
                        res["entity_key"] = normalize_entity_key(entity_type, str(single_id))
                        if entity_type == "project":
                            entity_name = str((combine_id_to_name or {}).get(str(single_id), "") or "").strip()
                        else:
                            entity_name = str((studio_id_to_name or {}).get(str(single_id), "") or "").strip()
                        res["name"] = entity_name
                        res["label"] = make_name_id_label(entity_name or entity_type, str(single_id))
                        data_results.append(res)
                except Exception as e:
                    error_msg = f"Failed to query {granularity} {'chart' if if_chart else 'no-chart'} metrics for {id_type}={single_id}: {str(e)}. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

        async def run_categorized_queries(
            *,
            module_for_query: str,
            monthly_chart: list[str],
            monthly_no_chart: list[str],
            yearly_chart: list[str],
            yearly_no_chart: list[str],
        ):
            """Run MGMT backend queries for the categorized metric groups under one module."""
            _combine_ids, _studio_ids = _get_id_lists_for_module(module_for_query)

            # Call the MGMT backend API separately for monthly and yearly metrics, categorized by has_chart
            # If multiple IDs exist, call API multiple times (once per ID) - results are NOT merged
            if monthly_chart:
                try:
                    if _combine_ids:
                        await call_api_for_ids(monthly_chart, "monthly", True, _combine_ids, "combine_id", module_for_query)
                    elif _studio_ids:
                        await call_api_for_ids(monthly_chart, "monthly", True, _studio_ids, "studio_id", module_for_query)
                    else:
                        res_monthly_chart = await call_api_and_handle_data(
                            context, start_date, end_date, monthly_chart, module_for_query, "monthly", True, language, None, None, metric_by_code
                        )
                        if res_monthly_chart is not None:
                            res_monthly_chart["entity_type"] = module_for_query
                            res_monthly_chart["entity_id"] = "all"
                            res_monthly_chart["entity_key"] = normalize_entity_key(module_for_query, "all")
                            res_monthly_chart["name"] = module_for_query
                            res_monthly_chart["label"] = make_name_id_label(module_for_query, "all")
                            data_results.append(res_monthly_chart)
                    logger.info(f"[Functool]-[mgmt_metrics_query_tool]: Successfully queried {len(monthly_chart)} monthly chart metrics for module={module_for_query}.")
                except Exception as e:
                    error_msg = f"Failed to query monthly chart metrics for module={module_for_query}: {str(e)}. Please retry with valid metrics and module combination. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

            if monthly_no_chart:
                try:
                    if _combine_ids:
                        await call_api_for_ids(monthly_no_chart, "monthly", False, _combine_ids, "combine_id", module_for_query)
                    elif _studio_ids:
                        await call_api_for_ids(monthly_no_chart, "monthly", False, _studio_ids, "studio_id", module_for_query)
                    else:
                        res_monthly_no_chart = await call_api_and_handle_data(
                            context, start_date, end_date, monthly_no_chart, module_for_query, "monthly", False, language, None, None, metric_by_code
                        )
                        if res_monthly_no_chart is not None:
                            res_monthly_no_chart["entity_type"] = module_for_query
                            res_monthly_no_chart["entity_id"] = "all"
                            res_monthly_no_chart["entity_key"] = normalize_entity_key(module_for_query, "all")
                            res_monthly_no_chart["name"] = module_for_query
                            res_monthly_no_chart["label"] = make_name_id_label(module_for_query, "all")
                            data_results.append(res_monthly_no_chart)
                    logger.info(f"[Functool]-[mgmt_metrics_query_tool]: Successfully queried {len(monthly_no_chart)} monthly no-chart metrics for module={module_for_query}.")
                except Exception as e:
                    error_msg = f"Failed to query monthly no-chart metrics for module={module_for_query}: {str(e)}. Please retry with valid metrics and module combination. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

            if yearly_chart:
                try:
                    if _combine_ids:
                        await call_api_for_ids(yearly_chart, "yearly", True, _combine_ids, "combine_id", module_for_query)
                    elif _studio_ids:
                        await call_api_for_ids(yearly_chart, "yearly", True, _studio_ids, "studio_id", module_for_query)
                    else:
                        res_yearly_chart = await call_api_and_handle_data(
                            context, start_date, end_date, yearly_chart, module_for_query, "yearly", True, language, None, None, metric_by_code
                        )
                        if res_yearly_chart is not None:
                            res_yearly_chart["entity_type"] = module_for_query
                            res_yearly_chart["entity_id"] = "all"
                            res_yearly_chart["entity_key"] = normalize_entity_key(module_for_query, "all")
                            res_yearly_chart["name"] = module_for_query
                            res_yearly_chart["label"] = make_name_id_label(module_for_query, "all")
                            data_results.append(res_yearly_chart)
                    logger.info(f"[Functool]-[mgmt_metrics_query_tool]: Successfully queried {len(yearly_chart)} yearly chart metrics for module={module_for_query}.")
                except Exception as e:
                    error_msg = f"Failed to query yearly chart metrics for module={module_for_query}: {str(e)}. Please retry with valid metrics and module combination. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

            if yearly_no_chart:
                try:
                    if _combine_ids:
                        await call_api_for_ids(yearly_no_chart, "yearly", False, _combine_ids, "combine_id", module_for_query)
                    elif _studio_ids:
                        await call_api_for_ids(yearly_no_chart, "yearly", False, _studio_ids, "studio_id", module_for_query)
                    else:
                        res_yearly_no_chart = await call_api_and_handle_data(
                            context, start_date, end_date, yearly_no_chart, module_for_query, "yearly", False, language, None, None, metric_by_code
                        )
                        if res_yearly_no_chart is not None:
                            res_yearly_no_chart["entity_type"] = module_for_query
                            res_yearly_no_chart["entity_id"] = "all"
                            res_yearly_no_chart["entity_key"] = normalize_entity_key(module_for_query, "all")
                            res_yearly_no_chart["name"] = module_for_query
                            res_yearly_no_chart["label"] = make_name_id_label(module_for_query, "all")
                            data_results.append(res_yearly_no_chart)
                    logger.info(f"[Functool]-[mgmt_metrics_query_tool]: Successfully queried {len(yearly_no_chart)} yearly no-chart metrics for module={module_for_query}.")
                except Exception as e:
                    error_msg = f"Failed to query yearly no-chart metrics for module={module_for_query}: {str(e)}. Please retry with valid metrics and module combination. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

        async def run_decision_point_queries(
            *,
            module_for_query: str,
            need_monthly: bool,
            need_yearly: bool,
        ):
            """Run decision_point queries with special handler under one module."""
            _combine_ids, _studio_ids = _get_id_lists_for_module(module_for_query)

            async def _call_for_ids(gran: str, id_list: list[str], id_type: str):
                for single_id in id_list:
                    try:
                        if id_type == "combine_id":
                            res = await call_api_and_handle_decision_point_data(
                                context,
                                start_date,
                                end_date,
                                module_for_query,
                                gran,
                                language,
                                None,
                                str(single_id),
                            )
                            entity_type = "project"
                            entity_name = str((combine_id_to_name or {}).get(str(single_id), "") or "").strip()
                        else:
                            res = await call_api_and_handle_decision_point_data(
                                context,
                                start_date,
                                end_date,
                                module_for_query,
                                gran,
                                language,
                                str(single_id),
                                None,
                            )
                            entity_type = "studio"
                            entity_name = str((studio_id_to_name or {}).get(str(single_id), "") or "").strip()

                        if res is not None:
                            res["entity_type"] = entity_type
                            res["entity_id"] = str(single_id)
                            res["entity_key"] = normalize_entity_key(entity_type, str(single_id))
                            res["name"] = entity_name
                            res["label"] = make_name_id_label(entity_name or entity_type, str(single_id))
                            data_results.append(res)
                    except Exception as e:
                        error_msg = f"Failed to query decision_point for {id_type}={single_id}, granularity={gran}, module={module_for_query}: {str(e)}. "
                        logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                        retry_info_list.append(error_msg)

            async def _call_for_all(gran: str):
                try:
                    res = await call_api_and_handle_decision_point_data(
                        context,
                        start_date,
                        end_date,
                        module_for_query,
                        gran,
                        language,
                        None,
                        None,
                    )
                    if res is not None:
                        res["entity_type"] = module_for_query
                        res["entity_id"] = "all"
                        res["entity_key"] = normalize_entity_key(module_for_query, "all")
                        res["name"] = module_for_query
                        res["label"] = make_name_id_label(module_for_query, "all")
                        data_results.append(res)
                except Exception as e:
                    error_msg = f"Failed to query decision_point for module={module_for_query}, granularity={gran}: {str(e)}. "
                    logger.error(f"[Functool Error]-[mgmt_metrics_query_tool]: {error_msg}")
                    retry_info_list.append(error_msg)

            if need_monthly:
                if _combine_ids:
                    await _call_for_ids("monthly", _combine_ids, "combine_id")
                elif _studio_ids:
                    await _call_for_ids("monthly", _studio_ids, "studio_id")
                else:
                    await _call_for_all("monthly")

            if need_yearly:
                if _combine_ids:
                    await _call_for_ids("yearly", _combine_ids, "combine_id")
                elif _studio_ids:
                    await _call_for_ids("yearly", _studio_ids, "studio_id")
                else:
                    await _call_for_all("yearly")

        # Run queries for main metrics under module_main.
        await run_categorized_queries(
            module_for_query=module_main,
            monthly_chart=monthly_chart_metrics,
            monthly_no_chart=monthly_no_chart_metrics,
            yearly_chart=yearly_chart_metrics,
            yearly_no_chart=yearly_no_chart_metrics,
        )

        # Run queries for decision_point metrics separately (if applicable).
        decision_monthly_chart: list[str] = []
        decision_monthly_no_chart: list[str] = []
        decision_yearly_chart: list[str] = []
        decision_yearly_no_chart: list[str] = []
        if decision_point_metrics and module_for_decision_point:
            decision_retry_list: list[str] = []
            update_list_len_before_decision = len(update_list)
            (
                decision_monthly_chart,
                decision_monthly_no_chart,
                decision_yearly_chart,
                decision_yearly_no_chart,
                _decision_unsupported,
                _decision_all_supported,
                decision_retry_list,
            ) = categorize_metrics_by_granularity_and_chart(
                decision_point_metrics,
                metric_by_code,
                decision_retry_list,
                module=module_for_decision_point,
                update_list=update_list,
            )
            if len(update_list) > update_list_len_before_decision:
                message += "".join(update_list[update_list_len_before_decision:])
            if decision_retry_list:
                # Do not block the overall query if only decision_point has issues.
                logger.warning(f"[Functool Warning]-[mgmt_metrics_query_tool]: decision_point retry_info_list: {decision_retry_list}")
                message += "".join(decision_retry_list)
            await run_decision_point_queries(
                module_for_query=module_for_decision_point,
                need_monthly=bool(decision_monthly_chart or decision_monthly_no_chart),
                need_yearly=bool(decision_yearly_chart or decision_yearly_no_chart),
            )

        # Add error messages to message, but don't prevent returning successful data
        if retry_info_list:
            logger.warning(f"[Functool Warning]-[mgmt_metrics_query_tool]: {retry_info_list}")
            message += "".join(retry_info_list)

        # Only return error if no data was successfully retrieved at all
        if not data_results and retry_info_list:
            return message

        # set sensitive data flag, used for web tips
        if data_results:
            set_sensitive_data_flag(context.context)
            append_mgmt_reference_for_module(context, module_main)
            if decision_point_metrics and module_for_decision_point and module_for_decision_point != module_main:
                append_mgmt_reference_for_module(context, module_for_decision_point)

        # Merge monthly/yearly results so each label only has one object
        data_results = merge_results_by_entity_key(data_results)

        # Temporary logic: if this query is a follow-up to TopN, remove all MGMT bidata and do not return any data_id.
        if topn_followup:
            try:
                existing_data = getattr(context.context, "data", None) or []
                if isinstance(existing_data, list):
                    context.context.data = [
                        d
                        for d in existing_data
                        if not (isinstance(d, dict) and d.get("system", "") == MGMT_SYSTEM_NAME)
                    ]
            except Exception:
                pass
            for r in data_results:
                if isinstance(r, dict) and "data_id" in r:
                    r["data_id"] = ""

    except Exception as e:
        logger.warning(f"[mgmt_metrics_query_tool Exception]: error msg = {str(e)}, traceback = {traceback.format_exc()}")
        message += f"Encounter error in retrieving MGMT data: {str(e)}. \n"

    log_metrics("mgmt_metrics_query_tool", "0", round((time.time() - start_time) * 1000, 2))

    # Get IDs for logging
    combine_id_to_name = getattr(context.context, "combine_id_to_name", {}) or {}
    combine_ids_log = [str(k) for k in combine_id_to_name.keys()] if isinstance(combine_id_to_name, dict) else []
    studio_id_to_name = getattr(context.context, "studio_id_to_name", {}) or {}
    studio_ids_log = [str(k) for k in studio_id_to_name.keys()] if isinstance(studio_id_to_name, dict) else []
    combine_id_to_name = combine_id_to_name if isinstance(combine_id_to_name, dict) else {}
    studio_id_to_name = studio_id_to_name if isinstance(studio_id_to_name, dict) else {}

    # Format return message with clearly labeled results
    results_summary = []
    for result in data_results:
        label = result.get("label", "unknown")
        entity_type = str(result.get("entity_type", "") or "").strip()
        entity_id = str(result.get("entity_id", "") or "").strip()
        name = str(result.get("name", "") or "").strip()
        if not name:
            if entity_type == "project" and entity_id:
                name = str(combine_id_to_name.get(entity_id, "") or "").strip()
            elif entity_type == "studio" and entity_id:
                name = str(studio_id_to_name.get(entity_id, "") or "").strip()
        if name:
            result["name"] = name
            result["label"] = make_name_id_label(name, entity_id or "all")
            label = result["label"]
        result_summary = {
            "label": label,
            "name": name,
            "has_data": bool(result.get("data")),
            "has_description": bool(result.get("description")),
            "data_id": "" if topn_followup else result.get("data_id", "")
        }
        results_summary.append(result_summary)

    #print(f"\033[93m[Querying MGMT metrics]: metrics: {metrics}, start_date: {start_date}, end_date: {end_date}, results_summary: {results_summary}, data_results: {data_results}, message: {message}\033[0m")
    _module_for_log = locals().get("module_main", module)
    _metrics_for_log = locals().get("requested_metrics", metrics)

    if context.context.chat_source == ChatSource.Wecom.value:
        bot_data = [{"data": d.get("data", {}), "description": d.get("description", "")} for d in data_results]
        logger.info(f"[Functool Return bot]-[mgmt_metrics_query_tool]: metrics={_metrics_for_log}, start_date={start_date}, end_date={end_date}, module={_module_for_log}, language={language}, studio_ids={studio_ids_log}, combine_ids={combine_ids_log}, results_summary={results_summary},bot_data={bot_data}, data_results={data_results}, message={message}.")
        return f"Querying MGMT metrics: {_metrics_for_log} from {start_date} to {end_date}, module {_module_for_log}, language {language}, Full results: {bot_data}. {message}"[:8000000]

    logger.info(f"[Functool Return]-[mgmt_metrics_query_tool]: metrics={_metrics_for_log}, start_date={start_date}, end_date={end_date}, module={_module_for_log}, language={language}, studio_ids={studio_ids_log}, combine_ids={combine_ids_log}, results_summary={results_summary}, data_results={data_results}, message={message}.")
    return f"Querying MGMT metrics: {_metrics_for_log} from {start_date} to {end_date}, module {_module_for_log}, language {language}, studio_ids {studio_ids_log}, combine_ids {combine_ids_log}. Results are separated by company/project ID. Results summary: {results_summary}. Full results: {data_results}. {message}"[:8000000]

