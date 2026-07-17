"""now_beijing.py — Canonical UTC+8 (Beijing) today provider for opinion-metrics SKILL.

WHY THIS EXISTS
---------------
舆情数据全栈口径都是 **UTC+8（北京时间）**。react_agent_service 已在 system prompt
顶部注入 UTC+8 `当前时间`，**应优先用它**作为 `today`；本脚本仅作**兜底**（上下文
缺该字段时才调用）。BigQuery 服务端的 `CURRENT_TIMESTAMP()` / `CURRENT_DATE()` /
`CURRENT_DATETIME()` 走 UTC 服务时钟，与业务北京时间错位最多 8 小时（实测 NIKKE
近 5 天声量偏差 23%），故一律禁用。

本脚本是 SKILL 的 UTC+8 today **兜底**来源：
  • 用 `ZoneInfo("Asia/Shanghai")` 直接算（标准库，主机时区无关）
  • 与 react_agent_service 进程时钟完全脱钩
  • 与 BigQuery 服务时钟完全脱钩

CONTRACT
--------
Always emit a single JSON object to stdout (UTF-8) with EXACTLY these keys:
  - today      (str): "YYYY-MM-DD" — current date in UTC+8 (Asia/Shanghai)
  - timezone   (str): always "UTC+8 (Asia/Shanghai)"
  - note       (str): usage guidance for downstream LLM

USAGE
-----
Fallback only — call this when the injected `当前时间` is unavailable:

    $ python scripts/now_beijing.py
    {
      "today": "2026-05-30",
      "timezone": "UTC+8 (Asia/Shanghai)",
      "note": "..."
    }

Then plug `today` directly into TIMESTAMP('YYYY-MM-DD') literals — DO NOT add
the `'Asia/Shanghai'` timezone parameter (data is already stored as Beijing-time
literals; adding the parameter causes a 8h offset error).

See also: SKILL.md Hard Constraints (顶部红字铁律) and Phase 2 时间映射表.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

_BEIJING_TZ = ZoneInfo("Asia/Shanghai")

_NOTE = (
    "舆情数据时区为 UTC+8（北京时间）。**凡是涉及『当前时间 / 今天 / 最近 / 本周 / 本月』"
    "等相对时间的 query，一律以本脚本返回的 today 作为『当前日期』**，再按下述口径算窗口"
    "（端点均含两端，BETWEEN 闭区间）：\n"
    "  • 今天                     = date = today\n"
    "  • 昨天                     = date = today-1\n"
    "  • 最近 N 天 / 近 N 天（含今天） = BETWEEN today-(N-1) AND today\n"
    "  • 本周（ISO 周一起算，截止 today） = BETWEEN 本周一 AND today\n"
    "  • 本月（截止 today）        = BETWEEN 本月 1 号 AND today\n"
    "  • 上月（完整上月）          = BETWEEN 上月 1 号 AND 上月最后一天\n"
    "SQL 中 TIMESTAMP('YYYY-MM-DD') / DATE('YYYY-MM-DD') / DATETIME('YYYY-MM-DD') 字面量，"
    "以及 DATE(comment_time) 切日，均**不加** 'Asia/Shanghai' 参数"
    "（物理表数据已按北京时间字面量灌库，加了反而 -8h 错位）。\n"
    "**禁止**使用 CURRENT_TIMESTAMP() / CURRENT_DATE() / CURRENT_DATETIME() —— "
    "BQ 默认走 UTC 服务时钟，与业务北京时间错位最多 8h（实测 NIKKE 近 5 天声量偏差 23%）。"
)


def main() -> int:
    today = datetime.now(_BEIJING_TZ).date()
    out = {
        "today": today.strftime("%Y-%m-%d"),
        "timezone": "UTC+8 (Asia/Shanghai)",
        "note": _NOTE,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    _ = sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
