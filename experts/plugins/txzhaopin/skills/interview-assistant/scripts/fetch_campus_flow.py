#!/usr/bin/env python3
"""
fetch_campus_flow.py — 校招全环节「待办 / 已办」一站式拉取 + 渲染（v1.0 · 2026-06-17）

背景：
    interview-assistant 原本校招只接了「面试待办」一个接口（get_campus_interview_todo_list）。
    本脚本补齐校招四大环节 × 待办/已办，覆盖招聘经理在校招里的完整事项流。
    与 fetch_todos.py 的分工：
      - fetch_todos.py  → 面试「待办」双查（校招+社招），是「今天我要面谁」的高频入口
      - fetch_campus_flow.py（本脚本）→ 校招四环节的待办/已办全量，是「我名下校招事项还有哪些 / 已处理哪些」

覆盖的 7 个校招接口（recruit.campus-center-front.*）：
    面试 todo  : get_campus_interview_todo_list   （与 fetch_todos.py 同源，这里也支持以便统一查）
    面试 done  : get_campus_interview_done_list
    考核 todo  : get_assess_todo_list             （校招实习生考核）
    考核 done  : get_assess_done_list
    录用 todo  : get_campus_offer_todo_list
    录用 done  : get_campus_offer_done_list
    评估 done  : post_v1_evaluation_doneList       （配 post_v1_evaluation_todoList=评估待办，T.md 已在用）

用法：
    # 默认：四环节 × 待办，合并渲染（招聘经理「我还有哪些校招事项」）
    python3 fetch_campus_flow.py

    # 看已办（我已经处理过的）
    python3 fetch_campus_flow.py --done

    # 待办+已办都看
    python3 fetch_campus_flow.py --both-status

    # 只看某个环节：interview / assess / offer / evaluation
    python3 fetch_campus_flow.py --stage interview
    python3 fetch_campus_flow.py --stage offer --done

    # 原始 JSON（程序处理）
    python3 fetch_campus_flow.py --format json

依赖：
    mcporter 已配置 recruit-mcp（含 TAIHU_TOKEN + ZHAOPIN_TOKEN）

退出码：
    0 成功 / 2 参数错误 / 3 mcporter 调用失败 / 4 解析失败
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

CAMPUS_RESUME_URL = "https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}"

# 环节 → {todo 接口, done 接口, 中文名, emoji}
STAGE_APIS = {
    "interview": {
        "todo": "recruit.campus-center-front.get_campus_interview_todo_list",
        "done": "recruit.campus-center-front.get_campus_interview_done_list",
        "label": "面试",
        "emoji": "🎤",
    },
    "assess": {
        "todo": "recruit.campus-center-front.get_assess_todo_list",
        "done": "recruit.campus-center-front.get_assess_done_list",
        "label": "实习生考核",
        "emoji": "📝",
    },
    "offer": {
        "todo": "recruit.campus-center-front.get_campus_offer_todo_list",
        "done": "recruit.campus-center-front.get_campus_offer_done_list",
        "label": "录用",
        "emoji": "📨",
    },
    "evaluation": {
        # 评估待办接口 T.md 已用 post_v1_evaluation_todoList；本脚本补 done
        "todo": "recruit.campus-center-front.post_v1_evaluation_todoList",
        "done": "recruit.campus-center-front.post_v1_evaluation_doneList",
        "label": "评估",
        "emoji": "📊",
    },
}

STAGE_ORDER = ["interview", "assess", "offer", "evaluation"]

# 🔴 实测校准（2026-06-17）：campus-center-front 的 list 接口虽然名字带 get_ 前缀，
# 但底层全是 POST，且接受分页/筛选 body（pageIndex/pageSize/orderBy/direction/keyword/
# currentStep/recruitType/recruitYear/resultStatus 等）。统一按 POST 带分页处理。
# 响应实测为三层 data：data.data.data.list（mcporter 外层 data + 业务 data + 业务 data）。

# 🔴 字段映射按 4 个环节各自实测响应校准（2026-06-17，逐接口实跑确认）：
#   - 面试 interview : name/resumeRid/speciality/stepName/resultTxt/rankTxt/interviewTimeStr/pcUrl(小写)
#   - 录用 offer     : name/resumeId(无rid)/stepName/stateName/curHandleStatus/PCUrl(大写)/diffData
#   - 考核 assess    : name/resumeId/positionName/departmentName/educationName/stepName/assessResultName/assessStateName/curStaffName/diffDay(无URL)
#   - 评估 evaluation: name/rid/speciality/stationTxt/statusTxt/assessmentStatusTxt/diffTimeTxt(无URL)
# 用「全变体并集」+ first_nonempty 顺序探测，一套字段表覆盖四环节。
NAME_FIELDS = ["name", "candidateName", "personName", "userName", "title", "stuName"]
RID_FIELDS = ["resumeRid", "rid", "candidateRid"]   # ⚠️ resumeId 是数字内部 id，不是 rid，排除
SCHOOL_FIELDS = ["school", "schoolName", "graduateSchool"]
SPEC_FIELDS = ["speciality", "specialty", "major", "majorTxt"]
POST_FIELDS = ["positionTxt", "stationWithSubDirection", "stationTxt", "positionName",
               "positionFullTitle", "postName"]
DEPT_FIELDS = ["departmentFullName", "departmentTxt", "departmentName", "fullOrgName",
               "deptName", "bgName"]
STEP_FIELDS = ["stepName", "currentStepName", "curStepName", "stepTxt", "nodeName"]
# 结果/状态：面试 resultTxt、录用 stateName/curHandleStatus、考核 assessResultName/assessStateName、评估 statusTxt
STATE_FIELDS = ["resultTxt", "currentResultTxt", "statusTxt", "assessResultName",
                "assessStateName", "stateName", "curHandleStatus", "msgReplyTxt", "stateTxt"]
# 评级/等级/测评灯：面试 rankTxt、考核 assessLevelName、评估 assessmentStatusTxt
RANK_FIELDS = ["rankTxt", "rankName", "assessLevelName", "assessmentStatusTxt"]
TIME_FIELDS = ["interviewTimeStr", "interviewTimeTxt", "endTimeTxt", "processTimeTxt",
               "createTimeTxt", "updateTimeTxt", "operateTime", "doneTime"]
# 耗时（天）：面试无、录用 diffData、考核 diffDay、评估 diffTimeTxt
COST_FIELDS = ["diffData", "diffDay", "diffTimeTxt", "stepDiffDay"]
URL_FIELDS = ["pcUrl", "PCUrl"]   # 面试小写 pcUrl / 录用大写 PCUrl；考核与评估无 URL


def _salvage_json(text: str) -> dict | None:
    """mcporter 在大 payload + 候选人评语含未转义控制字符时，stdout 可能产出
    非严格 JSON（Unterminated string）。这里做两级救援：
      ① 用 strict=False 容忍控制字符；
      ② 仍失败 → 截到最后一个完整的 list 元素 '}' 处，补齐 list/data 闭合再解析。
    救援成功返回 dict，否则 None。"""
    try:
        return json.loads(text, strict=False)
    except json.JSONDecodeError:
        pass
    # 截断救援：找到 "list": [ 之后，保留到最后一个 "}," 边界
    idx = text.find('"list"')
    if idx == -1:
        return None
    arr_start = text.find("[", idx)
    if arr_start == -1:
        return None
    last_obj_end = text.rfind("},", arr_start)
    if last_obj_end == -1:
        last_obj_end = text.rfind("}", arr_start)
        if last_obj_end == -1:
            return None
        salvaged = text[arr_start:last_obj_end + 1] + "]"
    else:
        salvaged = text[arr_start:last_obj_end + 1] + "]"
    try:
        rows = json.loads(salvaged, strict=False)
        if isinstance(rows, list):
            # 包成与真实结构一致的三层 data，供 extract_rows 命中
            return {"data": {"data": {"data": {"list": rows, "total": len(rows)}}}}
    except json.JSONDecodeError:
        return None
    return None


def mcporter_call(api_id: str, params: dict | None = None) -> dict:
    cmd = ["mcporter", "call", "recruit-mcp", "CallAPI", f"apiId={api_id}"]
    if params is not None:
        cmd.append("params=" + json.dumps(params, ensure_ascii=False))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(f"mcporter call failed ({api_id}, exit {proc.returncode}):\n{proc.stderr}\n")
        sys.exit(3)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        salvaged = _salvage_json(proc.stdout)
        if salvaged is not None:
            sys.stderr.write(f"[warn] {api_id} 响应 JSON 异常已救援解析（可能丢尾部若干条）: {e}\n")
            return salvaged
        sys.stderr.write(f"parse JSON failed ({api_id}): {e}\nhead: {proc.stdout[:400]}\n")
        sys.exit(4)


def dig(obj, *path):
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def extract_rows(raw: dict) -> list:
    """兼容多层包裹挖出列表。
    🔴 实测层级（mcporter 外层 data 之内）：
      - 面试/录用/考核：三层 data.data.data.list
      - 评估 post_v1_evaluation_*：两层 data.data.list
    优先三层，兜底两层。"""
    for path in [
        ("data", "data", "data", "list"),   # 面试/录用/考核
        ("data", "data", "list"),           # 评估
        ("data", "list"),
        ("data", "data", "data", "rows"),
        ("data", "data", "rows"),
    ]:
        v = dig(raw, *path)
        if isinstance(v, list):
            return v
    return []


def extract_total(raw: dict) -> int:
    """挖出总数 total，路径与 list 同层。"""
    for path in [
        ("data", "data", "data", "total"),
        ("data", "data", "total"),
        ("data", "total"),
    ]:
        v = dig(raw, *path)
        if isinstance(v, int):
            return v
    return -1


def first_nonempty(obj: dict, fields: list[str]):
    if not isinstance(obj, dict):
        return None
    for f in fields:
        v = obj.get(f)
        if v not in (None, "", "*****", "-"):
            return v
    return None


def _form_txt(form_id) -> str:
    return {1: "现场", 2: "电话", 3: "面呗", 4: "腾讯会议",
            5: "web版面呗", 6: "牛客网"}.get(form_id or 0, "—")


def normalize(row: dict, stage: str) -> dict:
    """把一条原始记录归一化。校招面试接口的候选人可能在 personList[] 子结构，
    由 fetch_rows() 负责展开后再传进来；这里只处理已经是「单候选人」的 row。"""
    rid = first_nonempty(row, RID_FIELDS) or ""
    # 简历链接：优先用接口直出的 pcUrl（带 traceId 的详情页），否则用 rid 拼简历页
    url = first_nonempty(row, URL_FIELDS) or (CAMPUS_RESUME_URL.format(rid=rid) if rid else "—")
    cost = first_nonempty(row, COST_FIELDS)
    cost_txt = "—"
    if cost not in (None, "", "—"):
        cost_txt = f"{cost}天" if str(cost).isdigit() else str(cost)
    return {
        "stage": STAGE_APIS[stage]["label"],
        "name": first_nonempty(row, NAME_FIELDS) or "—",
        "school": first_nonempty(row, SCHOOL_FIELDS) or "—",
        "spec": first_nonempty(row, SPEC_FIELDS) or "—",
        "post": first_nonempty(row, POST_FIELDS) or "—",
        "dept": first_nonempty(row, DEPT_FIELDS) or "—",
        "step": first_nonempty(row, STEP_FIELDS) or "—",
        "state": first_nonempty(row, STATE_FIELDS) or "—",
        "rank": first_nonempty(row, RANK_FIELDS) or "—",
        "time": first_nonempty(row, TIME_FIELDS) or "—",
        "cost": cost_txt,
        "form": _form_txt(row.get("interviewForm")) if stage == "interview" else "—",
        "rid": rid,
        "url": url,
        "raw": row,
    }


def fetch_rows(stage: str, status: str) -> list[dict]:
    """拉取某环节某状态的列表并归一化。status ∈ {'todo','done'}。
    🔴 实测：campus-center-front 接口全是 POST 且接受分页 body（即使名字带 get_）。"""
    api = STAGE_APIS[stage][status]
    # pageSize 取 15：校招面试评语很长，pageSize 过大时 mcporter stdout 易被截断成非法 JSON
    # （已有 _salvage_json 兜底，但小页能直接规避）。15 条足够「我名下事项一屏概览」。
    params = {"pageIndex": 1, "pageSize": 15, "orderBy": "interviewTime", "direction": "DESC"}
    raw = mcporter_call(api, params)
    rows = extract_rows(raw)
    fetch_rows.last_total = extract_total(raw)  # 旁路记录总数，供渲染用

    out: list[dict] = []
    for r in rows:
        # 校招面试接口：每条是「面试时段」，候选人在 personList[] 子数组 → 展开
        persons = r.get("personList") if isinstance(r, dict) else None
        if isinstance(persons, list) and persons:
            slot_time = r.get("interviewTime") or r.get("interviewTimeStr") or ""
            for p in persons:
                if slot_time and not first_nonempty(p, TIME_FIELDS):
                    p = {**p, "interviewTimeStr": slot_time}
                out.append(normalize(p, stage))
        else:
            out.append(normalize(r, stage))
    return out


def render_table(stage: str, status: str, rows: list[dict], total: int = -1) -> str:
    meta = STAGE_APIS[stage]
    status_cn = "待办" if status == "todo" else "已办"
    cnt = f"{len(rows)} 条" + (f" / 共 {total}" if total > len(rows) else "")
    head = f"### {meta['emoji']} 校招{meta['label']}·{status_cn}（{cnt}）"
    if not rows:
        return f"{head}\n_暂无_"
    lines = [head, "",
             "| # | 候选人 | 学校 | 岗位 | 环节 | 结果/状态 | 评级/测评 | 耗时 | 时间 | 详情 |",
             "|:--:|---|---|---|---|---|---|:--:|---|---|"]
    for i, r in enumerate(rows, 1):
        link = f"[详情]({r['url']})" if r["url"] != "—" else "—"
        lines.append(f"| {i} | {r['name']} | {r['school']} | {r['post']} | "
                     f"{r['step']} | {r['state']} | {r['rank']} | {r['cost']} | {r['time']} | {link} |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="校招全环节 待办/已办 拉取+渲染")
    ap.add_argument("--stage", choices=STAGE_ORDER + ["all"], default="all",
                    help="环节：interview/assess/offer/evaluation/all（默认 all）")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--done", action="store_true", help="只看已办（默认看待办）")
    g.add_argument("--both-status", action="store_true", help="待办+已办都看")
    ap.add_argument("--format", choices=["markdown", "json"], default="markdown")
    args = ap.parse_args()

    stages = STAGE_ORDER if args.stage == "all" else [args.stage]
    if args.both_status:
        statuses = ["todo", "done"]
    elif args.done:
        statuses = ["done"]
    else:
        statuses = ["todo"]

    result: dict = {}
    totals: dict = {}
    for st in stages:
        for status in statuses:
            fetch_rows.last_total = -1
            try:
                rows = fetch_rows(st, status)
            except SystemExit:
                raise
            except Exception as e:
                sys.stderr.write(f"⚠️ {st}/{status} 拉取失败（非致命）: {e}\n")
                rows = []
            result.setdefault(st, {})[status] = rows
            totals[(st, status)] = getattr(fetch_rows, "last_total", -1)

    if args.format == "json":
        payload = {
            st: {status: [{k: v for k, v in r.items() if k != "raw"} for r in rows]
                 for status, rows in by_status.items()}
            for st, by_status in result.items()
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    # markdown
    shown = sum(len(rows) for by in result.values() for rows in by.values())
    blocks = [f"📋 **校招事项**（{'待办+已办' if args.both_status else ('已办' if args.done else '待办')}）· 本页 {shown} 条"]
    for st in stages:
        for status in statuses:
            rows = result.get(st, {}).get(status, [])
            blocks.append(render_table(st, status, rows, totals.get((st, status), -1)))
    print("\n\n".join(blocks))


if __name__ == "__main__":
    main()
