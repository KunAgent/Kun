#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
保温状态批量分析脚本
=================================================
用于对 hr-ai-data starrocks_query 返回的候选人明细做风险分级、待办派生、
以及"需要关注"清单提取。与前端 dataLayer.js 的计算逻辑保持一致。

用法：
    # 从 JSON 文件分析
    python analyze_warming_status.py --input candidates.json --output analyzed.json

    # stdin/stdout
    cat candidates.json | python analyze_warming_status.py > analyzed.json

    # 直接打印摘要
    python analyze_warming_status.py --input candidates.json --summary

输入：candidates.json 是 list[dict]，每个 dict 至少包含以下字段：
    resume_id, name, sign_status, tripartite_status,
    expect_entry_date, is_entry, entry_status,
    tutor_name_en, lead_name_en,
    signed_time, destroy_time,
    cm_feedback, cm_fb_result, suggestion,
    (可选) first_contact_time, welcome_material_sent_time, last_interaction_time,
    (可选) mentor_bindtime

输出：每条记录额外挂载以下派生字段：
    is_signed_pool, is_break_contract, days_to_entry,
    mentor_bound, leader_bound, first_contact_done, welcome_material_sent,
    days_since_last_interaction,
    risk_level (high/medium/low/lost),
    todo_type (break_contract/urgent_followup/assign_mentor/confirm_leader/
               first_contact/send_material/pre_entry/routine),
    warming_stage, warming_progress,
    suggested_action
"""

import argparse
import json
import sys
from datetime import date, datetime
from typing import Any, Dict, List, Optional

SAFE_TRIPARTITE = {"三方已签约", "三方文件接收", "三方文件回寄", "已签署"}
IN_PROGRESS_TRIPARTITE = {"三方信息收集", "三方信息确认", "三方文件提交", "处理中"}


def parse_date(value: Any) -> Optional[date]:
    """健壮日期解析：支持 str、datetime、None；无法解析返回 None。"""
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%Y%m%d"):
            try:
                return datetime.strptime(value[: len(fmt) + 2].strip(), fmt).date()
            except ValueError:
                continue
    return None


def days_between(later: Optional[date], earlier: Optional[date]) -> Optional[int]:
    if not later or not earlier:
        return None
    return (later - earlier).days


def is_nonempty_str(val: Any) -> bool:
    return isinstance(val, str) and val.strip() != ""


def derive_risk_level(r: Dict[str, Any]) -> str:
    if r["is_break_contract"]:
        return "lost"
    if is_nonempty_str(r.get("cm_fb_result")):
        return "high"
    if is_nonempty_str(r.get("suggestion")):
        return "high"
    if is_nonempty_str(r.get("cm_feedback")):
        return "medium"
    dsi = r.get("days_since_last_interaction")
    if dsi is not None and dsi >= 14:
        return "medium"
    return "low"


def derive_todo_type(r: Dict[str, Any]) -> str:
    if r["is_break_contract"]:
        return "break_contract"
    if r["risk_level"] == "high":
        return "urgent_followup"
    if not r["mentor_bound"]:
        return "assign_mentor"
    if not r["leader_bound"]:
        return "confirm_leader"
    if r["mentor_bound"] and not r["first_contact_done"]:
        return "first_contact"
    if r["first_contact_done"] and not r["welcome_material_sent"]:
        return "send_material"
    dte = r.get("days_to_entry")
    if dte is not None and 0 < dte <= 30:
        return "pre_entry"
    return "routine"


def derive_warming_stage(r: Dict[str, Any]) -> str:
    if r["is_break_contract"]:
        return "已毁约"
    if r.get("is_entry") == "是":
        return "已入职"
    if r["welcome_material_sent"]:
        return "资料已发送"
    if r["first_contact_done"]:
        return "首次沟通完成"
    if r["mentor_bound"]:
        return "导师已绑定"
    tri = r.get("tripartite_status")
    if tri in SAFE_TRIPARTITE:
        return "已交三方"
    if tri in IN_PROGRESS_TRIPARTITE:
        return "三方处理中"
    return "已签约"


def derive_warming_progress(r: Dict[str, Any]) -> int:
    if r["is_break_contract"]:
        return 0
    score = 0
    if r.get("sign_status") == "已签":
        score += 15
    if r.get("tripartite_status") in SAFE_TRIPARTITE:
        score += 15
    if r["mentor_bound"]:
        score += 20
    if r["first_contact_done"]:
        score += 20
    if r["welcome_material_sent"]:
        score += 15
    if r["leader_bound"]:
        score += 15
    return min(100, score)


def derive_suggested_action(r: Dict[str, Any]) -> str:
    todo = r["todo_type"]
    if todo == "break_contract":
        return "已毁约，进入复盘而非保温"
    if todo == "urgent_followup":
        return "招聘经理亲自 1v1 电话沟通，了解真实顾虑"
    if todo == "assign_mentor":
        return "立即指派导师，并同步介绍给候选人"
    if todo == "confirm_leader":
        return "与部门负责人对齐直接上级人选"
    if todo == "first_contact":
        return "督促导师完成首次沟通（文字或语音）"
    if todo == "send_material":
        return "让导师发送欢迎包与团队资料"
    if todo == "pre_entry":
        return "入职倒计时，确认住宿、工卡、入职日等事项"
    dsi = r.get("days_since_last_interaction")
    if dsi is not None and dsi >= 5:
        return "建议发起新一轮互动"
    return "保持日常关怀即可"


def compute_scene_fields(r: Dict[str, Any], today: date) -> Dict[str, Any]:
    """给一条候选人记录挂载所有派生字段，返回新 dict。"""
    out = dict(r)
    sign_status = r.get("sign_status")
    out["is_signed_pool"] = sign_status in ("已签", "毁约")
    out["is_break_contract"] = sign_status == "毁约"

    expect_entry = parse_date(r.get("expect_entry_date"))
    out["days_to_entry"] = days_between(expect_entry, today)

    # 导师/上级绑定：兼容 mentor_bindtime 或直接 tutor_name_en 不为空
    mentor_time = parse_date(r.get("mentor_bindtime"))
    out["mentor_bound"] = bool(mentor_time) or is_nonempty_str(r.get("tutor_name_en"))
    out["leader_bound"] = is_nonempty_str(r.get("lead_name_en"))
    out["first_contact_done"] = bool(parse_date(r.get("first_contact_time")))
    out["welcome_material_sent"] = bool(parse_date(r.get("welcome_material_sent_time")))

    last_inter = parse_date(r.get("last_interaction_time"))
    if last_inter:
        out["days_since_last_interaction"] = (today - last_inter).days
    else:
        out["days_since_last_interaction"] = None

    out["risk_level"] = derive_risk_level(out)
    out["todo_type"] = derive_todo_type(out)
    out["warming_stage"] = derive_warming_stage(out)
    out["warming_progress"] = derive_warming_progress(out)
    out["suggested_action"] = derive_suggested_action(out)

    return out


def build_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """基于已挂派生字段的记录计算整体摘要。"""
    pool = [r for r in records if r.get("is_signed_pool")]
    signed = [r for r in pool if r.get("sign_status") == "已签"]
    broken = [r for r in pool if r.get("is_break_contract")]

    def pct(num: int, den: int) -> str:
        return f"{(num / den * 100):.1f}%" if den else "0.0%"

    # L1 红灯清单
    l1 = []
    for r in signed:
        dte = r.get("days_to_entry")
        if dte is not None and 0 < dte <= 30 and not r["mentor_bound"]:
            l1.append({"reason": "30 天内入职且未分配导师", "record": r})
        elif dte is not None and 0 < dte <= 30 and not r["first_contact_done"]:
            l1.append({"reason": "30 天内入职且首次沟通未完成", "record": r})
        elif is_nonempty_str(r.get("cm_fb_result")) or is_nonempty_str(r.get("suggestion")):
            l1.append({"reason": "有风险反馈", "record": r})
        elif r.get("days_since_last_interaction") is not None and r["days_since_last_interaction"] >= 21:
            l1.append({"reason": "超过 21 天未互动", "record": r})

    # L2 黄灯
    l2_no_mentor = [r for r in signed if not r["mentor_bound"] and not any(x["record"]["resume_id"] == r["resume_id"] for x in l1)]
    l2_no_first = [r for r in signed if r["mentor_bound"] and not r["first_contact_done"] and not any(x["record"]["resume_id"] == r["resume_id"] for x in l1)]
    l2_no_material = [r for r in signed if r["first_contact_done"] and not r["welcome_material_sent"] and not any(x["record"]["resume_id"] == r["resume_id"] for x in l1)]

    return {
        "total_pool": len(pool),
        "signed_count": len(signed),
        "broken_count": len(broken),
        "break_rate": pct(len(broken), len(pool)),
        "mentor_bound_rate": pct(sum(1 for r in signed if r["mentor_bound"]), len(signed)),
        "leader_bound_rate": pct(sum(1 for r in signed if r["leader_bound"]), len(signed)),
        "first_contact_rate": pct(sum(1 for r in signed if r["first_contact_done"]), len(signed)),
        "material_sent_rate": pct(sum(1 for r in signed if r["welcome_material_sent"]), len(signed)),
        "no_mentor_count": sum(1 for r in signed if not r["mentor_bound"]),
        "no_leader_count": sum(1 for r in signed if not r["leader_bound"]),
        "high_risk_count": sum(1 for r in signed if r["risk_level"] == "high"),
        "pre_entry_30d_count": sum(
            1 for r in signed if r.get("days_to_entry") is not None and 0 < r["days_to_entry"] <= 30
        ),
        "l1_count": len(l1),
        "l1_items": [
            {
                "reason": item["reason"],
                "resume_id": item["record"].get("resume_id"),
                "name": item["record"].get("name"),
                "days_to_entry": item["record"].get("days_to_entry"),
                "position_name_cn": item["record"].get("position_name_cn"),
            }
            for item in l1
        ],
        "l2_count": len(l2_no_mentor) + len(l2_no_first) + len(l2_no_material),
        "l2_breakdown": {
            "no_mentor": len(l2_no_mentor),
            "first_contact_pending": len(l2_no_first),
            "material_pending": len(l2_no_material),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="保温状态批量分析")
    parser.add_argument("--input", "-i", help="输入 JSON 文件；不提供则从 stdin 读")
    parser.add_argument("--output", "-o", help="输出 JSON 文件；不提供则打到 stdout")
    parser.add_argument("--summary", action="store_true", help="只输出 summary，不输出明细")
    parser.add_argument("--today", help="指定今日日期 YYYY-MM-DD，默认为系统今日")
    args = parser.parse_args()

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            records = json.load(f)
    else:
        records = json.load(sys.stdin)

    if not isinstance(records, list):
        sys.stderr.write("输入必须是 JSON 数组\n")
        sys.exit(1)

    today = parse_date(args.today) if args.today else date.today()
    assert today is not None, "无效的 --today 参数"

    analyzed = [compute_scene_fields(r, today) for r in records]
    summary = build_summary(analyzed)

    result = summary if args.summary else {"summary": summary, "records": analyzed}

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"已写出 {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
