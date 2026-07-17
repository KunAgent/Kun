from __future__ import annotations

from run_context_wrapper import RunContextWrapper
from loguru import logger
import time
import traceback
from typing import Dict, List, Any, Optional

from utils.cls import log_metrics
from utils.context import GameContext
from utils.constants import ToolName
from utils.databrain_api import async_send_request_with_token
from utils.databrain_api import MGMT_METRIC_MAP_API


# 获取指标详细信息列表，支持全量查询和权限过滤两种模式
# 入参 type：查询类型，1=所有指标，2=用户有权限的指标
async def get_metric_list_for_user(context: RunContextWrapper[GameContext], user_query: str, is_chinese = True, query_mode: int = 2):
    lang = "zh" if is_chinese else "en"

    data = {
        "type": query_mode,
        "language": lang,
    }

    response = await async_send_request_with_token(MGMT_METRIC_MAP_API, data, context.context.token, MGMT_METRIC_MAP_API, "POST", 1, context.context.message_id)

    response_json = response.json()
    code = response_json.get("code", -1)

    # handle api outputs
    if code == 0:
        logger.info(f"[Tool return]-[get_metric_list_for_user]: response_json['data']: {response_json['data']}. ")
        return response_json["data"]
    else:
        raise response_json.get("msg", "Unknown error. ")
    

class MetricRegistry:
    def __init__(self, metrics: List[dict]):
        # 唯一索引：metric_code -> metric dict
        self.by_code: Dict[str, dict] = {}

        for m in metrics:
            code = m.get("metric_code")
            if not code:
                continue
            self.by_code[code] = m

    # 推荐：提供显式 access 方法（比直接 dict 更安全）
    def get(self, metric_code: str) -> Optional[dict]:
        return self.by_code.get(metric_code)


async def load_metric_map_to_context(context: RunContextWrapper[GameContext], user_query: str = "", is_chinese: bool = True, query_mode: int = 2):
    """
    Load metric list and create registry, store by_code structure in context.
    
    Args:
        context: RunContextWrapper with GameContext
        user_query: User query string for metric filtering
        metric_type: Query type, 1=all metrics, 2=user authorized metrics
    
    Returns:
        bool: True if successfully loaded, False otherwise
    """
    # Check if already loaded
    if context.context.mgmt_info is None:
        logger.warning("[Tool Warning]-[load_metric_map_to_context]: context.context.mgmt_info is None")
        return False
    if context.context.mgmt_info.get("metric_by_code"):
        logger.info(f"[Tool]-[load_metric_map_to_context]: Metric map already loaded in context.")
        return True
    
    try:
        metric_list = await get_metric_list_for_user(context, user_query or "", is_chinese, query_mode)
        #print(f"\033[93m[mgmttest load_metric_map_to_context]- : {metric_list}\033[0m")
        metric_registry = MetricRegistry(metric_list)
        context.context.mgmt_info["metric_by_code"] = metric_registry.by_code
        logger.info(f"[Tool]-[load_metric_map_to_context]: Loaded {len(metric_registry.by_code)} metrics into context.")
        return True
    except Exception as e:
        logger.warning(f"[Tool Warning]-[load_metric_map_to_context]: Failed to load metric map: {str(e)}")
        return False


# 获取指标详细信息列表，支持全量查询和权限过滤两种模式
# 入参 type：查询类型，1=所有指标，2=用户有权限的指标
async def get_metric_list_for_user_4test(game_context: GameContext, user_query: str, type: int = 1):
    metric_list = [
        {
            "metric_code": "gross_revenue_actual",
            "metric_desc_en": "Year-to-date (as of month end) actual",
            "metric_desc_cn": "1月到当前月的累计实际流水值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "YTM Actual",
            "metric_name_cn": "截至本月实际值",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "active",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_growth_rate",
            "metric_desc_en": "(year-to-date actual / Last year actual for the same period) -1",
            "metric_desc_cn": "25A相对于2024年同时段累计实际值的增长率",
            "metric_type": "business",
            "value_type": "percent",
            "metric_name_en": "YoY%",
            "metric_name_cn": "去年同期增长率",
            "granularity": [
                "monthly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_iegg",
            "metric_desc_en": "Monthly IEGG revenue (non-cumulative)",
            "metric_desc_cn": "IEGG当月流水，不是每月累加值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Monthly Total Gross Revenue",
            "metric_name_cn": "IEGG整体月流水",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "-",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_iegg_total",
            "metric_desc_en": "IEGG Total Gross Revenue",
            "metric_desc_cn": "IEGG年度总流水",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Total Gross Revenue-IEGG",
            "metric_name_cn": "总流水-IEGG",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_mom",
            "metric_desc_en": "Month-on-Month comparison",
            "metric_desc_cn": "今年上月 跟 今年那月，例：2025-04 VS 2025-05",
            "metric_type": "business",
            "value_type": "float",
            "metric_name_en": "MOM",
            "metric_name_cn": "环比",
            "granularity": [
                "monthly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_publishing",
            "metric_desc_en": "Monthly Publishing revenue (non-cumulative)",
            "metric_desc_cn": "Publishing当月流水，不是每月累加值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Monthly Pulishing Gross Revenue",
            "metric_name_cn": "发行业务月流水",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "-",
            "module": [
                "business",
                "publishing"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_studio",
            "metric_desc_en": "Monthly Studio revenue (non-cumulative)",
            "metric_desc_cn": "Studio当月流水，不是每月累加值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Monthly Studio Gross Revenue",
            "metric_name_cn": "Studio业务月流水",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "-",
            "module": [
                "business",
                "all_studio"
            ]
        },
        {
            "metric_code": "gross_revenue_actual_yoy",
            "metric_desc_en": "Year-on-Year comparison",
            "metric_desc_cn": "去年那月 跟 今年那月，例：2024-05 VS 2025-05",
            "metric_type": "business",
            "value_type": "float",
            "metric_name_en": "YOY",
            "metric_name_cn": "同比",
            "granularity": [
                "monthly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_business_team_forecast",
            "metric_desc_en": "Full-year forecast from business team",
            "metric_desc_cn": "最近一次由业务团队刷新的全年预测值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Full Year Forecast  - Business Team",
            "metric_name_cn": "业务团队预测",
            "granularity": [
                "yearly"
            ],
            "unit": "usd",
            "label": "Forecast",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_forecast",
            "metric_desc_en": "Full-year forecast",
            "metric_desc_cn": "全年预测值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Full Year Forecast",
            "metric_name_cn": "全年预测值",
            "granularity": [
                "yearly"
            ],
            "unit": "usd",
            "label": "Forecast",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_kpi",
            "metric_desc_en": "Full-year KPI",
            "metric_desc_cn": "全年预算值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Full Year KPI",
            "metric_name_cn": "全年目标值",
            "granularity": [
                "yearly"
            ],
            "unit": "usd",
            "label": "KPI,Budget",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_kpi_complete_rate",
            "metric_desc_en": "Year-to-date actual / year-to-date L1 KPI",
            "metric_desc_cn": "25A相对于今年同时段KPI的完成率",
            "metric_type": "business",
            "value_type": "percent",
            "metric_name_en": "%YTM KPI",
            "metric_name_cn": "月KPI完成率",
            "granularity": [
                "monthly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_kpi_iegg",
            "metric_desc_en": "Monthly IEGG monthly revenue KPI (non-cumulative)",
            "metric_desc_cn": "IEGG当月流水KPI，不是每月累加值",
            "metric_type": "business",
            "value_type": "percent",
            "metric_name_en": "Monthly Total Gross Revenue KPI",
            "metric_name_cn": "IEGG整体月流水目标",
            "granularity": [
                "monthly"
            ],
            "unit": "usd",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "-",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_neutral_forecast",
            "metric_desc_en": "Full-year forecast from Finance Team, based on inputs from business teams and Forecast Team.",
            "metric_desc_cn": "最近一次由财务团队基于业务团队和预测团队的输入来刷新的全年预测值，数值上等同于全年预测值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Full Year Neutral Forecast",
            "metric_name_cn": "预测",
            "granularity": [
                "yearly"
            ],
            "unit": "usd",
            "label": "Forecast",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business"
            ]
        },
        {
            "metric_code": "gross_revenue_profit_loss",
            "metric_desc_en": "Year forecast minus Year KPI",
            "metric_desc_cn": "25F减去25B的差值，预测跟KPI之间的差值",
            "metric_type": "business",
            "value_type": "numerical",
            "metric_name_en": "Surplus/Deficit",
            "metric_name_cn": "盈余/赤字",
            "granularity": [
                "yearly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        },
        {
            "metric_code": "gross_revenue_year_kpi_complete_rate",
            "metric_desc_en": "Year-to-date actual / full-year L1 KPI",
            "metric_desc_cn": "25A相对于全年KPI的完成率",
            "metric_type": "business",
            "value_type": "percent",
            "metric_name_en": "%year KPI",
            "metric_name_cn": "年KPI完成率",
            "granularity": [
                "monthly"
            ],
            "unit": "-",
            "label": "actual",
            "active": 1,
            "unsupported_aggregation": "sum, mean, min, max",
            "module": [
                "business",
                "all_studio",
                "studio",
                "publishing",
                "project"
            ]
        }
    ]

    return metric_list
