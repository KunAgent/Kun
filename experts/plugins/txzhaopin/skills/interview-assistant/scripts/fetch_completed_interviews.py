#!/usr/bin/env python3
"""
fetch_completed_interviews.py — 拉取当前用户最近 N 场已完成面试（校招 + 社招）

用途：
    为「面试官画像」(I-portrait) 类目提供数据源——列出已完成的面试，
    提取 flowTraceId / 候选人 / 岗位 / 日期等关键信息，供后续逐场拉转写+面评。

用法：
    # 默认拉最近 10 场（校招+社招合并，按时间倒序）
    python3 fetch_completed_interviews.py

    # 指定场数
    python3 fetch_completed_interviews.py --limit 5

    # 只看校招
    python3 fetch_completed_interviews.py --type campus

    # 只看社招
    python3 fetch_completed_interviews.py --type social

    # 输出原始 JSON（用于程序处理）
    python3 fetch_completed_interviews.py --format json

输出（默认 markdown）：
    ## 已完成面试列表
    | # | 类型 | 候选人 | 岗位 | BG | 环节 | 日期 | traceId |
    ...

输出（JSON）：
    {
      "interviews": [
        {
          "type": "campus|social",
          "trace_id": "...",
          "candidate_name": "...",
          "station_txt": "...",
          "bg_txt": "...",
          "step_txt": "...",
          "interview_date": "YYYY-MM-DD",
          "rid": "...",
          "recruit_type": 1|3,
          "raw": {...}
        }
      ],
      "total_campus": N,
      "total_social": M
    }

依赖：
    mcporter 已配置 recruit-mcp（含 TAIHU_TOKEN + ZHAOPIN_TOKEN）

退出码：
    0 - 成功
    1 - 参数错误
    2 - mcporter 调用失败
    3 - 无已完成面试

作者：interview-assistant skill / 2026-06-12 v1.0
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


# ============================================================================
# API 常量
# ============================================================================

SOCIAL_LIST_API = "recruit.social-todo-center.get_api_trace_get_list"
CAMPUS_LIST_API = "recruit.campus-center-front.get_campus_interview_todo_list"
# 🆕 v2.0：校招已完成改用专门的「已办」接口（比 todo+orderStateId 过滤更准，且直接带面评 comment/rankTxt）
CAMPUS_DONE_API = "recruit.campus-center-front.get_campus_interview_done_list"


# ============================================================================
# 通用工具（与 fetch_todos.py 一致）
# ============================================================================

def mcporter_call(api_id: str, params: dict | None = None) -> dict:
    cmd = ["mcporter", "call", "recruit-mcp", "CallAPI", f"apiId={api_id}"]
    if params is not None:
        cmd.append("params=" + json.dumps(params, ensure_ascii=False))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        print(f"❌ mcporter call failed (exit {proc.returncode}): {proc.stderr[:500]}", file=sys.stderr)
        sys.exit(2)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        print(f"❌ JSON parse failed: {e}\nstdout head: {proc.stdout[:500]}", file=sys.stderr)
        sys.exit(2)


def dig(obj: Any, *path) -> Any:
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def extract_rows(raw: dict) -> list[dict]:
    for path in [
        ("data", "data", "rows"),
        ("data", "rows"),
        ("data", "list"),
        ("data", "data", "list"),
        ("data", "data", "data", "list"),
        ("data", "data"),
    ]:
        v = dig(raw, *path)
        if isinstance(v, list):
            return v
    return []


def first_of(obj: dict, *fields: str) -> Any:
    for f in fields:
        v = obj.get(f)
        if v not in (None, "", "*****"):
            return v
    return None


# ============================================================================
# 社招已完成
# ============================================================================

def fetch_social_completed() -> list[dict]:
    """拉社招已完成面试列表（done=true）"""
    params = {
        "flowId": "3",
        "extType": "interview",
        "done": "true",
        "type": "trace",
        "pageNum": 1,
        "pageSize": 50,
    }
    raw = mcporter_call(SOCIAL_LIST_API, params)
    rows = extract_rows(raw)
    items = []
    for r in rows:
        name = first_of(r, "title", "candidateName", "name") or "—"
        trace_id = str(r.get("flowTraceId") or r.get("traceId") or "")
        # 社招日期：尝试多个字段
        date_str = ""
        for dt_field in ("interviewTime", "interviewTimeStr", "startTime", "scheduleTime", "createTime"):
            dt_val = r.get(dt_field)
            if dt_val:
                # 可能是时间戳(ms)或字符串
                if isinstance(dt_val, (int, float)) and dt_val > 1e12:
                    try:
                        date_str = datetime.fromtimestamp(dt_val / 1000).strftime("%Y-%m-%d")
                    except Exception:
                        date_str = str(dt_val)
                else:
                    date_str = str(dt_val)[:10]
                break

        items.append({
            "type": "social",
            "trace_id": trace_id,
            "candidate_name": name,
            "station_txt": first_of(r, "recruitPostName", "postName", "position", "stationTxt") or "",
            "bg_txt": first_of(r, "bgName", "bgTxt", "bg") or "",
            "step_txt": first_of(r, "step", "stepName", "currentStep") or "",
            "interview_date": date_str,
            "rid": first_of(r, "rid", "resumeRid") or "",
            "employee_id": first_of(r, "employeeId") or "",
            "recruit_type": 3,  # 社招
            "raw": r,
        })
    return items


# ============================================================================
# 校招已完成
# ============================================================================

def _extract_rows_deep(raw: dict) -> list:
    """校招已办接口实测是三层 data.data.data.list（与 todo 接口层级不同）。"""
    for path in [("data", "data", "data", "list"),
                 ("data", "data", "list"), ("data", "list")]:
        cur = raw
        ok = True
        for k in path:
            if not isinstance(cur, dict):
                ok = False
                break
            cur = cur.get(k)
        if ok and isinstance(cur, list):
            return cur
    return []


def fetch_campus_completed() -> list[dict]:
    """拉校招已完成面试列表。
    🆕 v2.0：改用专门的「已办」接口 get_campus_interview_done_list。
    优点：① 比 todo+orderStateId 过滤更准；② 每条直接带面评 comment + rankTxt（评级），
    供 I 画像零额外调用就拿到面评。
    实测要点（2026-06-17）：POST 带分页；响应三层 data.data.data.list；
    每条已是「单候选人」（不再是 personList 时段结构）；字段 name/resumeRid/comment/rankTxt/
    interviewTimeStr/stepName/positionTxt/bgName/pcUrl。
    pageSize=15 规避长评语导致的 mcporter stdout 截断。"""
    params = {"pageIndex": 1, "pageSize": 15, "orderBy": "interviewTime", "direction": "DESC"}
    raw = mcporter_call(CAMPUS_DONE_API, params)
    rows = _extract_rows_deep(raw)
    items = []
    for p in rows:
        if not isinstance(p, dict):
            continue
        name = p.get("name") or "—"
        trace_id = str(p.get("flowTraceId") or p.get("traceId") or "")
        rid = p.get("resumeRid") or p.get("rid") or ""
        # 时间：已办接口直接给 interviewTimeStr（yyyy-MM-dd HH:mm）
        ts = p.get("interviewTimeStr") or ""
        date_str = str(ts)[:10] if ts else ""
        items.append({
            "type": "campus",
            "trace_id": trace_id,
            "candidate_name": name,
            "station_txt": p.get("positionTxt") or p.get("stationTxt") or "",
            "bg_txt": p.get("bgName") or p.get("bgTxt") or "",
            "step_txt": p.get("stepName") or p.get("step_txt") or "",
            "interview_date": date_str,
            "rid": str(rid),
            "employee_id": "",
            "recruit_type": 1,  # 校招
            # 🆕 已办接口直出面评，供 I 画像直接用（省一次按 rid 拉简历）
            "eval_comment": p.get("comment") or "",
            "eval_rank": p.get("rankTxt") or "",
            "interview_result": p.get("resultTxt") or "",
            "raw": p,
        })
    return items


# ============================================================================
# 合并 + 去重 + 排序
# ============================================================================

def merge_and_sort(campus: list[dict], social: list[dict], limit: int = 10) -> list[dict]:
    """合并校招社招，按日期倒序，去重（按 trace_id），截断到 limit"""
    seen = set()
    merged = []
    # 先放社招（日期可能更新），再放校招，按日期排序后截断
    all_items = social + campus
    # 按日期排序（倒序，有日期的优先）
    all_items.sort(key=lambda x: x.get("interview_date") or "0000", reverse=True)
    for it in all_items:
        tid = it.get("trace_id")
        if tid and tid in seen:
            continue
        if tid:
            seen.add(tid)
        merged.append(it)
        if len(merged) >= limit:
            break
    return merged


# ============================================================================
# 渲染
# ============================================================================

def render_markdown(items: list[dict], total_campus: int, total_social: int) -> str:
    lines = [
        f"## 已完成面试（校招 {total_campus} / 社招 {total_social}，展示 {len(items)} 场）",
        "",
        "| # | 类型 | 候选人 | 岗位 | BG | 环节 | 日期 | traceId |",
        "|:--:|:--:|---|---|---|---|---|---|",
    ]
    for i, it in enumerate(items, 1):
        type_icon = "🟧校招" if it["type"] == "campus" else "🟦社招"
        # ⚠️ traceId 必须完整展示（复盘 E / 画像 I / 写面评 D 都要用它定位单场，截短会取错场）
        trace_full = it["trace_id"] if it["trace_id"] else "—"
        lines.append(
            f"| {i} | {type_icon} | {it['candidate_name']} | {it['station_txt'] or '—'} | "
            f"{it['bg_txt'] or '—'} | {it['step_txt'] or '—'} | {it['interview_date'] or '—'} | "
            f"`{trace_full}` |"
        )
    return "\n".join(lines)


def render_json(items: list[dict], total_campus: int, total_social: int) -> str:
    # raw 太大，不输出到 JSON（除非调试）
    output_items = []
    for it in items:
        o = {k: v for k, v in it.items() if k != "raw"}
        output_items.append(o)
    return json.dumps({
        "interviews": output_items,
        "total_campus": total_campus,
        "total_social": total_social,
    }, ensure_ascii=False, indent=2)


# ============================================================================
# Main
# ============================================================================

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--limit", type=int, default=10, help="最多返回几场（默认 10）")
    p.add_argument("--type", choices=["campus", "social", "all"], default="all",
                   help="只看校招 / 只看社招 / 都看（默认 all）")
    p.add_argument("--format", choices=["markdown", "json"], default="markdown",
                   help="输出格式（默认 markdown）")
    args = p.parse_args()

    campus_items = []
    social_items = []

    if args.type in ("campus", "all"):
        print("⏳ 拉取校招已完成面试...", file=sys.stderr)
        campus_items = fetch_campus_completed()
        print(f"   校招：{len(campus_items)} 场", file=sys.stderr)

    if args.type in ("social", "all"):
        print("⏳ 拉取社招已完成面试...", file=sys.stderr)
        social_items = fetch_social_completed()
        print(f"   社招：{len(social_items)} 场", file=sys.stderr)

    items = merge_and_sort(campus_items, social_items, limit=args.limit)

    if not items:
        print("⚠️ 未找到已完成的面试记录", file=sys.stderr)
        sys.exit(3)

    if args.format == "json":
        print(render_json(items, len(campus_items), len(social_items)))
    else:
        print(render_markdown(items, len(campus_items), len(social_items)))


if __name__ == "__main__":
    main()
