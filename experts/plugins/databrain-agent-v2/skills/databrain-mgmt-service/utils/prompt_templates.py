from __future__ import annotations
from datetime import datetime, timezone, timedelta
import re
from loguru import logger
from typing import Dict, List

from utils.context import GameContext

import copy


# 提取时间范围信息
def time_extraction_rules():
    now = datetime.now(timezone.utc)
    last_day_of_last_month = now.replace(day=1) - timedelta(days=1)

    current_date = now.strftime("%Y-%m-%d")
    yesterday_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    #current_month = now.strftime("%Y-%m")
    launch_date = "2000-01-01"
    # 默认起始日：上个月底
    #default_end_date = last_day_of_last_month.strftime("%Y-%m")
    # 默认起始日：上个月所在年份的1月1日
    default_start_date = last_day_of_last_month.replace(month=1, day=1).strftime("%Y-%m")

    rules = f"""
    # 时间参数提取规则：请根据用户问题提取 start_date 和 end_date。当前日期为：{current_date}

    ## Rule 1. 显式时间段（特定年份、月份或区间）：
      -- 触发条件：当用户询问某年、某月或某段时间内的表现时，提取该周期的起始和结束。
      -- 规则：start_date 取该周期第一天，end_date 取该周期最后一天。其中1,3,5,7,8,10,12月最后一天为31日；4,6,9,11月最后一天为30日；闰年2月最后一天是29日，平年2月最后一天是28日。
      -- 闰年判断规则：若年份能被4整除且不能被100整除，或能被400整除，则为闰年（如2020，2024）；否则为平年（如 2025, 2026, 2027年）
      -- 年份简写识别： “25年”等同于“2025年”。
      -- 示例：
        1) "25年收入最高的游戏" -> start_date: 2025-01-01, end_date: 2025-12-31
        2) "2025年5月到11月收入" -> start_date: 2025-05-01, end_date: 2025-11-30

    ## Rule 2. 截止时间/全生命周期（严格关键词触发）
      -- [强制门槛]：仅当用户【显式】使用以下关键词之一时触发：["截止", "上线至今", "以来", "历史", "since launch", "all-time"]。
      -- [严禁行为]：严禁根据指标含义（如：KPI、目标值、总下载、研发费）猜测触发。如果没有上述硬关键词，禁止进入此规则。
      -- 规则：start_date 统一设为默认值 {launch_date}，end_date 取指定时间的期末。
      -- 示例：
        1) "截止到25年的总收入" -> start_date: {launch_date}, end_date: 2025-12-31
        2) "DE Studio上线以来的营收" -> start_date: {launch_date}, end_date: {current_date}

    ## Rule 3. 缺省时间处理（默认兜底规则）：
      -- 触发条件：如果用户问题没有明确指定时间，或者仅询问“XX的[指标]是多少”
      -- 适用范围：包含收入、利润、KPI目标、成本、费用、DAU等所有指标，必须视为查询当前年度的表现（YTD）。
      -- 规则：
        1. end_date 设置为昨天: {yesterday_date}。
        2. start_date 设置为上个月所在年份的1月1日: {default_start_date}。
      -- 示例
        1) "DE的收入是多少" -> start_date: {default_start_date}, end_date: {yesterday_date}
        2) "what is the revenue of DE studio" -> start_date: {default_start_date}, end_date: {yesterday_date}

    ## Rule 4. 冲突与优先级判断（Critical）：
      -- **关键词绝对优先**：若无 Rule 2 明确列出的关键词，【绝对禁止】将 start_date 设为 {launch_date}。
      -- **指标中立原则**：无论查询什么指标（不论是KPI,目标值,收入(Revenue),还是研发费用(R&D Cost)或用户量），只要没有命中Rule 2 明确列出的关键词，一律执行 Rule 3。
      -- **默认优先**：对于普通查询，优先匹配 Rule 3。
    ## Rule 5. 空结果处理（新增核心部分）：当查询工具返回结果为空（No Data / Null / Empty）时，请严格执行以下判断逻辑：
      ### 场景 A：用户明确指定了时间（Rule 1）
        - 回复逻辑：告知用户没有查询到start_date和end_date期间的数据，提示用户换个时间范围查询看看。
      ### 场景 B：使用了缺省时间处理（Rule 2 & 3）且无数据（Critical）
        -- 回复模板：必须包含以下三个要素：
          1. 披露时间范围：如果start_date不等于{launch_date}，明确告知用户刚才查询的start_date和end_date；如果start_date={launch_date}，提示用户查询时间范围是截止到end_date。
          2. 陈述事实：在该时间范围内未找到数据。
          3. 引导追问：引导用户指定具体的时间范围。
        -- 标准回复示例（User: "查询Wardogs研发费" -> Tool: Empty）："我为您查询了 2026年1月1日 至 2026年1月31日的研发费用，但未发现相关记录。提示：指定期望的查询时间，回答会更精确。"
"""

    return rules


# 数值展示格式
def financial_number_formatting_rules(is_chinese: bool):
    """
    Generate financial number formatting rules based on user's language.
    Returns different versions for Chinese and other languages.
    
    Args:
        language: User's language from context (e.g., "chinese", "english", etc.)
    """

    if is_chinese:
        # Chinese version - 中文版本
        return """
    ## 输出一致性
      - 始终保留数据中提供的货币符号（例如：$、¥、€）。
      
    ## 图表和可视化规则
    如果输出包含图表（表格、折线图、柱状图等），请确保以下内容：
    1. **数据完整性：** 始终对 "data" 系列使用原始数值，以便图表正确缩放。
    2. **工具提示和标签格式化：**
      - 将相同的中文单位规则（万 美元/亿 美元）应用于 **工具提示** 和 **Y轴标签**。
    
    3. **中文图表配置：**
      - Y轴：使用单位如 `万 美元`、`亿 美元`。
"""
    else:
        # English/Other languages version - 英文/其他语言版本
        return """
    ## Output Consistency
      - Always keep the currency symbol (e.g., $, ¥, €) as provided in the data.

    ## Charting & Visualization Rules
    If the output includes charts (table, Line, Bar, etc.), ensure the following:
    1. **Data Integrity:** Always use raw numeric values for the "data" series so the chart scales correctly.
    2. **Tooltip & Label Formatting:**
      - Apply the same unit rules to **Tooltips** and **Y-Axis labels**.
    3. **International Chart Config:**
      - Y-Axis: Use units like `K`, `M`, `B`.
"""
