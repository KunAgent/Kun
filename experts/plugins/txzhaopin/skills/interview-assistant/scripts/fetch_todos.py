#!/usr/bin/env python3
"""
fetch_todos.py - 校招 + 社招面试待办一站式拉取 / 解析 / 合并 / 渲染（替代 LLM token 处理）

用途：
    替代 agent 把"两次 mcporter call + 解码 + 拼接渲染"塞进 LLM 上下文的旧做法。
    脚本输出已经是给用户看的最终 Markdown 表格 + 候选人姓名/岗位/状态/简历链接齐全。

用法：
    # 默认：双查（校招 + 社招），渲染合并 Markdown
    python3 fetch_todos.py

    # 只查社招
    python3 fetch_todos.py --type social

    # 只查校招
    python3 fetch_todos.py --type campus

    # 顶部概览（用 get_top_count，无 token 也轻量）
    python3 fetch_todos.py --top-only

    # 想拿到原始 JSON 用于程序处理
    python3 fetch_todos.py --format json

输出（默认 markdown）：
    📋 待办概览：社招 N / 校招 M / 紧急 K

    ## 🟦 社招待办（N 条）
    | # | 候选人 | 岗位 | 部门 | 环节 | 状态 | 地点 | 剩余 | 简历 |
    ...

    ## 🟧 校招待办（M 条）
    | # | 候选人 | 学校 | 岗位 | 面试时间 | 状态 | 简历 |
    ...

依赖：
    mcporter 已配置 recruit-mcp（含 TAIHU_TOKEN + ZHAOPIN_TOKEN）

退出码：
    0 - 成功
    2 - 参数错误
    3 - mcporter 调用失败 / 鉴权失败
    4 - 接口返回 error / 字段解析失败

v1.0 - 2026-05-27
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# ============================================================================
# 配置
# ============================================================================

CAMPUS_RESUME_URL = "https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}"
SOCIAL_RESUME_URL_BY_RID = "https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP"
SOCIAL_RESUME_URL_BY_EID = "https://zhaopin.woa.com/resume/resume_detail?employeeId={eid}"

TOP_COUNT_API = "recruit.social-todo-center.get_api_trace_get_top_count"
SOCIAL_LIST_API = "recruit.social-todo-center.get_api_trace_get_list"
CAMPUS_LIST_API = "recruit.campus-center-front.get_campus_interview_todo_list"

# 候选人姓名常见字段名（按优先级探测）
# 社招接口实测：title 字段才是候选人姓名（不是 name/candidateName）
NAME_FIELDS = [
    "title", "candidateName", "candidate_name", "personName", "person_name",
    "userName", "user_name", "name", "subject",
]
RID_FIELDS = ["rid", "RID", "candidateRid", "candidate_rid", "resumeId", "resume_id"]
EID_FIELDS = ["employeeId", "employee_id"]
# 岗位：实测社招用 recruitPostName，校招可能是 postName / stationTxt
POST_FIELDS = ["recruitPostName", "postName", "post_name", "position", "positionName", "stationTxt", "jobName", "mainPostName"]
DEPT_FIELDS = ["departmentName", "deptName", "dept_name", "department", "iDeptTxt"]
# 环节：社招实测 step / currentStep / stepCode，校招另说
STEP_FIELDS = ["step", "currentStep", "stepName", "step_name", "stepCode", "step_txt", "stage", "round"]
# 状态：社招实测 stateName="面试中" + stepCate="待处理"，需要拼起来
STATE_FIELDS = ["stateName", "statusText", "status_text", "stateText", "state", "status", "statusName"]
SUBSTATE_FIELDS = ["stepCate", "moreStatus"]
LOCATION_FIELDS = ["location", "city", "workCity", "interviewCity"]
# 剩余时间：社招实测 remainDays="23小时"
REMAIN_FIELDS = ["remainDays", "remainTime", "remain_time", "deadline", "expireTime", "expire_time"]
INTERVIEW_TIME_FIELDS = [
    "interviewTime", "interview_time", "startTime", "start_time",
    "expectedTime", "expected_time", "scheduleTime",
]

# 待办置顶到顶级 / 嵌套到 candidate 子对象 / 嵌套到 person 子对象 - 三种结构都兼容
NESTED_CANDIDATE_KEYS = ["candidate", "person", "applicant", "user", "resume"]


# ============================================================================
# 通用工具
# ============================================================================

def first_nonempty(obj: dict, fields: list[str]) -> Any:
    """从 obj 里按 fields 顺序取第一个非空值；支持嵌套到 candidate/person/... 子对象。"""
    if not isinstance(obj, dict):
        return None
    # 1) 顶层探测
    for f in fields:
        v = obj.get(f)
        if v not in (None, "", "*****"):
            return v
    # 2) 嵌套子对象探测
    for nest_key in NESTED_CANDIDATE_KEYS:
        sub = obj.get(nest_key)
        if isinstance(sub, dict):
            for f in fields:
                v = sub.get(f)
                if v not in (None, "", "*****"):
                    return v
    return None


def mcporter_call(api_id: str, params: dict | None = None) -> dict:
    """调 mcporter call recruit-mcp CallAPI，返回 JSON dict。"""
    cmd = ["mcporter", "call", "recruit-mcp", "CallAPI", f"apiId={api_id}"]
    if params is not None:
        cmd.append("params=" + json.dumps(params, ensure_ascii=False))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(f"mcporter call failed (exit {proc.returncode}):\n{proc.stderr}\n")
        sys.exit(3)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"failed to parse mcporter response as JSON: {e}\nstdout head: {proc.stdout[:500]}\n")
        sys.exit(4)


def dig(obj: Any, *path) -> Any:
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def extract_rows(raw: dict) -> list[dict]:
    """从 mcporter 返回里挖出 rows / list / data 列表，兼容多层包裹。"""
    for path in [
        ("data", "data", "rows"),     # 社招实测路径（两层 data）
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


def extract_data_obj(raw: dict) -> dict:
    """从 mcporter 返回里挖出 data 对象（用于 top_count 等非列表场景）。"""
    for path in [
        ("data", "data"),   # 实测路径（两层 data）
        ("data",),
    ]:
        v = dig(raw, *path)
        if isinstance(v, dict) and v:
            return v
    return {}


# ============================================================================
# 顶部概览
# ============================================================================

def fetch_top_count() -> dict:
    raw = mcporter_call(TOP_COUNT_API)
    data = extract_data_obj(raw)
    return {
        "total":          data.get("totalTrace", -1),
        "social":         data.get("socialTrace", -1),
        "campus":         data.get("campusTrace", -1),
        "urgent":         data.get("urgentTrace", -1),
        "sensitive":      data.get("sensitiveCount", -1),
        "non_post":       data.get("nonPostCount", -1),
        "resource":       data.get("resourceManageCount", -1),
        "follow_post_social":  data.get("followPostSocialTrace", -1),
        "follow_post_campus":  data.get("followPostCampusTrace", -1),
        "follow_dept_social":  data.get("followDeptSocialTrace", -1),
        "follow_dept_campus":  data.get("followDeptCampusTrace", -1),
    }


def render_top_count(c: dict) -> str:
    def show(v: int) -> str:
        return "—" if v == -1 else str(v)
    lines = [
        f"📋 **待办概览**：社招 **{show(c['social'])}** / 校招 **{show(c['campus'])}** / 紧急 **{show(c['urgent'])}**",
    ]
    if c["follow_post_social"] != -1 or c["follow_post_campus"] != -1:
        lines.append(f"- 关注岗位：社招 {show(c['follow_post_social'])} / 校招 {show(c['follow_post_campus'])}")
    if c["follow_dept_social"] != -1 or c["follow_dept_campus"] != -1:
        lines.append(f"- 关注部门：社招 {show(c['follow_dept_social'])} / 校招 {show(c['follow_dept_campus'])}")
    if c["sensitive"] != -1:
        lines.append(f"- 保密流程：{show(c['sensitive'])}")
    return "\n".join(lines)


# ============================================================================
# 社招待办
# ============================================================================

def fetch_social_list(resolve_rid: bool = True) -> list[dict]:
    params = {
        "flowId": "3",
        "extType": "interview",
        "done": "false",
        "type": "trace",
        "pageNum": 1,
        "pageSize": 50,
    }
    raw = mcporter_call(SOCIAL_LIST_API, params)
    rows = extract_rows(raw)
    items = [normalize_social(r) for r in rows]
    # 社招 todo 接口不返回 rid（只有 employeeId），但 post_order_add / 简历详情都要 rid
    # → 自动按 email 反查 rid，写回每条记录
    if resolve_rid:
        for it in items:
            if it.get("rid"):
                continue
            email = it.get("email")
            if email:
                it["rid"] = lookup_rid_by_email(email)
                if it["rid"]:
                    # rid 拿到后顺手把 URL 也升级为 rid 版（更标准）
                    it["url"] = SOCIAL_RESUME_URL_BY_RID.format(rid=it["rid"])
    return items


def lookup_rid_by_email(email: str) -> str | None:
    """通过社招简历搜索接口反查 rid（按邮箱过滤）。失败/歧义返回 None。"""
    if not email or "@" not in email:
        return None
    try:
        raw = mcporter_call(
            "recruit.social-resume.post_api_resume_query_query",
            {"email": email, "from": 0, "size": 3, "diggerSearchId": "mcp-recruit-rid-resolve"},
        )
    except SystemExit:
        return None
    except Exception:
        return None
    cur = raw
    for k in ("data", "data", "resumes"):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    if not isinstance(cur, list) or not cur:
        return None
    if len(cur) > 1:
        return None  # 多匹配不返回，避免错
    return cur[0].get("rid")


def normalize_social(row: dict) -> dict:
    name  = first_nonempty(row, NAME_FIELDS) or "—"
    rid   = first_nonempty(row, RID_FIELDS)
    eid   = first_nonempty(row, EID_FIELDS)
    email = row.get("emailAddress") or row.get("email")
    # 简历 URL 优先用 resumeUrl（接口直出）→ employeeId → rid
    url = row.get("resumeUrl") or "—"
    if url == "—":
        if eid:
            url = SOCIAL_RESUME_URL_BY_EID.format(eid=eid)
        elif rid:
            url = SOCIAL_RESUME_URL_BY_RID.format(rid=rid)
    # 状态：实测 stateName='面试中' + stepCate='待处理' → "🟡 待处理/面试中"
    state_main = first_nonempty(row, STATE_FIELDS) or ""
    state_sub  = first_nonempty(row, SUBSTATE_FIELDS) or ""
    if state_main and state_sub and state_main != state_sub:
        state = f"🟡 {state_sub}/{state_main}"
    else:
        state = f"🟡 {state_main or state_sub or '—'}"
    return {
        "type":     "社招",
        "name":     name,
        "post":     first_nonempty(row, POST_FIELDS) or "—",
        "dept":     first_nonempty(row, DEPT_FIELDS) or "—",
        "step":     first_nonempty(row, STEP_FIELDS) or "—",
        "state":    state,
        "location": first_nonempty(row, LOCATION_FIELDS) or "—",
        "remain":   first_nonempty(row, REMAIN_FIELDS) or "—",
        "rid":      rid,   # 通常为空，由 fetch_social_list() 后填
        "eid":      eid,
        "email":    email,
        "url":      url,
        "raw":      row,
    }


# ============================================================================
# 校招待办
# ============================================================================

def fetch_campus_list() -> list[dict]:
    params = {
        "pageIndex": 1,
        "pageSize": 50,
        "orderBy": "interviewTime",
        "direction": "DESC",
    }
    raw = mcporter_call(CAMPUS_LIST_API, params)
    rows = extract_rows(raw)
    # 校招结构特殊：每行顶层是"面试时段"，候选人在 personList[] 里。展开一对一。
    expanded: list[dict] = []
    for slot in rows:
        persons = slot.get("personList") or []
        if not persons:
            continue
        slot_time = slot.get("interviewTime") or slot.get("interviewTimeStr") or "—"
        slot_order_id = slot.get("orderId", 0)
        for p in persons:
            expanded.append(normalize_campus(p, slot_time, slot_order_id))
    return expanded


def normalize_campus(p: dict, fallback_time: str, order_id: int) -> dict:
    name = p.get("name") or "—"
    rid  = p.get("resumeRid") or p.get("rid") or ""
    return {
        "type":      "校招",
        "name":      name,
        "school":    p.get("school") or "—",
        "post":      p.get("positionTxt") or p.get("positionFullTitle") or "—",
        "dept":      p.get("departmentTxt") or "—",
        "interview": p.get("interviewTimeTxt") or p.get("interviewTimeStr") or fallback_time,
        "step":      p.get("stepName") or "—",
        "state":     p.get("resultTxt") or p.get("msgReplyTxt") or "—",
        "form":      _campus_form_txt(p.get("interviewForm")),
        "meeting":   p.get("meetingCode") or "",
        "rid":       rid,
        "order_id":  order_id,
        "url":       CAMPUS_RESUME_URL.format(rid=rid) if rid else "—",
        "raw":       p,
    }


def _campus_form_txt(form_id: int | None) -> str:
    return {
        1: "现场", 2: "电话", 3: "面呗",
        4: "腾讯会议", 5: "web版面呗", 6: "牛客网",
    }.get(form_id or 0, "—")


# ============================================================================
# 渲染
# ============================================================================

def render_social_table(rows: list[dict]) -> str:
    if not rows:
        return "## 🟦 社招待办（0 条）\n_暂无社招面试待办_"
    lines = [f"## 🟦 社招待办（{len(rows)} 条）", "",
             "| # | 候选人 | 岗位 | 部门 | 环节 | 状态 | 地点 | 剩余 | 简历 |",
             "|:--:|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        link = f"[查看]({r['url']})" if r["url"] != "—" else "—"
        lines.append(f"| {i} | {r['name']} | {r['post']} | {r['dept']} | {r['step']} | {r['state']} | {r['location']} | {r['remain']} | {link} |")
    # 在表格后附 rid 索引（供 agent 后续调 post_order_add / S-Pre 资格判定时用）
    rid_index = []
    for i, r in enumerate(rows, 1):
        if r.get("rid"):
            rid_index.append(f"  - [{i}] {r['name']} → rid=`{r['rid']}` · email=`{r.get('email','—')}`")
    if rid_index:
        lines.append("")
        lines.append("**🔑 候选人 RID 索引**（agent 调下单 / 资格判定时直接用）：")
        lines.extend(rid_index)
    else:
        lines.append("")
        lines.append("⚠️ 未能反查到任何候选人 rid——下单前请用 `resolve_social_rid.py --email <邮箱>` 单独查。")
    return "\n".join(lines)


def render_campus_table(rows: list[dict]) -> str:
    if not rows:
        return "## 🟧 校招待办（0 条）\n_暂无校招面试待办_"
    lines = [f"## 🟧 校招待办（{len(rows)} 条）", "",
             "| # | 候选人 | 学校 | 岗位 | 环节 | 时间 | 形式 | 状态 | 简历 |",
             "|:--:|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        link = f"[查看]({r['url']})" if r["url"] != "—" else "—"
        form = r.get("form", "—")
        lines.append(f"| {i} | {r['name']} | {r['school']} | {r['post']} | {r['step']} | {r['interview']} | {form} | {r['state']} | {link} |")
    return "\n".join(lines)


# ============================================================================
# main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="校招+社招面试待办一站式拉取/渲染")
    parser.add_argument("--type", choices=["both", "campus", "social"], default="both",
                        help="拉哪边：both（默认）/ campus / social")
    parser.add_argument("--top-only", action="store_true",
                        help="只出顶部概览，不拉详情列表（最省 token）")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown",
                        help="输出格式：markdown（默认，给用户看）/ json（程序处理）")
    parser.add_argument("--no-top", action="store_true",
                        help="跳过顶部概览，只出详情列表")
    args = parser.parse_args()

    # 1) 顶部概览
    top = None
    if not args.no_top:
        try:
            top = fetch_top_count()
        except SystemExit:
            raise
        except Exception as e:
            sys.stderr.write(f"⚠️ top_count failed (non-fatal): {e}\n")

    # 2) 列表
    social_rows: list[dict] = []
    campus_rows: list[dict] = []
    if not args.top_only:
        if args.type in ("both", "social"):
            try:
                social_rows = fetch_social_list()
            except SystemExit:
                raise
            except Exception as e:
                sys.stderr.write(f"⚠️ social list failed: {e}\n")
        if args.type in ("both", "campus"):
            try:
                campus_rows = fetch_campus_list()
            except SystemExit:
                raise
            except Exception as e:
                sys.stderr.write(f"⚠️ campus list failed: {e}\n")

    # 3) 输出
    if args.format == "json":
        payload = {
            "top": top,
            "social": [{k: v for k, v in r.items() if k != "raw"} for r in social_rows],
            "campus": [{k: v for k, v in r.items() if k != "raw"} for r in campus_rows],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    # markdown
    blocks = []
    if top:
        blocks.append(render_top_count(top))
    if args.top_only:
        print("\n\n".join(blocks))
        return
    if args.type in ("both", "social"):
        blocks.append(render_social_table(social_rows))
    if args.type in ("both", "campus"):
        blocks.append(render_campus_table(campus_rows))
    print("\n\n".join(blocks))


if __name__ == "__main__":
    main()
