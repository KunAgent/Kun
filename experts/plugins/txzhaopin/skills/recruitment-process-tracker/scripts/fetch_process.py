#!/usr/bin/env python3
"""
fetch_process.py — 招聘流程跟踪一站式拉取 / 解析 / 渲染（社招专用）

用途：
    替代 agent 把"mcporter call + 解码 + 拼接渲染"塞进 LLM 上下文的旧做法。
    脚本输出已经是给用户看的最终 Markdown 表格 + PII 水印 + 智能洞察。

底层接口：
    recruit.social-todo-center.post_api_process_get_list
    （社招流程跟踪 - 招聘经理获取负责的社招流程数据列表）
    ⚠️ 仅社招，校招不走此接口。

用法：
    # 默认：拉当前登录人作为招聘经理负责的全部流程
    python3 fetch_process.py

    # ⭐ 查指定招聘经理（需要对应跨人查询权限；不传 hrs 即使有权限也只能看到自己）
    python3 fetch_process.py --hrs <招聘经理英文名>
    python3 fetch_process.py --hrs <英文名A>,<英文名B>

    # 按候选人姓名模糊
    python3 fetch_process.py --candidate "<候选人姓名>"

    # 模糊关键字（候选人/岗位/部门任意维度）
    python3 fetch_process.py --keyword "产品策划"

    # 申请单号
    python3 fetch_process.py --apply-no APPLY-2026-001

    # 按状态大类（statusCode）
    python3 fetch_process.py --status-code Interviewing
    python3 fetch_process.py --status-code Offering
    # 可选值：All / Resume_Screening / Interviewing / Offering / Offer_Toning /
    #         Eevaluation / Onboarding / Onboard / Ending

    # 面试安排子状态（仅 statusCode=Interviewing 有效）
    python3 fetch_process.py --status-code Interviewing --interview-status wait_arrangement
    # 可选值：wait_arrangement / interview_arrangement / had_arrangement /
    #         hold_interview / pass_interview

    # 部门 ID
    python3 fetch_process.py --dept 10000

    # 岗位 ID
    python3 fetch_process.py --post 100000

    # 面试官英文名
    python3 fetch_process.py --interviewers <英文名A>,<英文名B>

    # 时间区间（应聘时间，格式：YYYY-MM-DD,YYYY-MM-DD）
    python3 fetch_process.py --apply-time "2026-05-01,2026-05-31"

    # 排序
    python3 fetch_process.py --order-field lastUpdateTime --asc

    # 输出原始 JSON（便于调试）
    python3 fetch_process.py --format json

    # 组合：查指定招聘经理在面试阶段的流程（需要对应权限）
    python3 fetch_process.py --hrs <英文名> --status-code Interviewing

依赖：
    mcporter 已配置 recruit-mcp（含 TAIHU_TOKEN + ZHAOPIN_TOKEN）
    或 CodeBuddy 已注入 recruit-mcp（~/.codebuddy/mcp.json）

退出码：
    0 - 成功
    2 - 参数错误
    3 - mcporter 调用失败 / 鉴权失败
    4 - 接口返回 error / 字段解析失败
    5 - 403 权限不足（非招聘经理 / 没有对应跨人查询权限）

v1.1.0 - 2026-06-02
    - 按官方 schema 修正字段名（stepName / totalElapsedDay / stateName / postName / deptName）
    - 加 --hrs / --hr-ids 支持跨人查询（需对应权限）
    - 加 --status-code / --interview-status / --keyword / --apply-no / --interviewers / --apply-time / --order-field
    - 列表加"招聘 HR"列，处理链接直接用接口返回的 url 字段
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# ============================================================================
# 配置
# ============================================================================

API_ID = "recruit.social-todo-center.post_api_process_get_list"

# 字段名探测顺序（官方 schema 为准，保留 fallback 兼容历史命名）
NAME_FIELDS = ["candidateName", "title", "name", "personName"]
RID_FIELDS = ["resumeId", "rid", "candidateRid", "RID"]
EID_FIELDS = ["candidateId", "employeeId"]
STEP_FIELDS = ["stepName", "currentStep", "step"]
ELAPSED_NOW_FIELDS = ["elapsedDay", "currentElapsedDay"]
ELAPSED_SUM_FIELDS = ["totalElapsedDay", "elapsedDaySum"]
STATUS_NAME_FIELDS = ["stateName", "statusName", "status"]
DEPT_FIELDS = ["deptName", "departmentName", "postDeptName"]
POST_FIELDS = ["postName", "recruitPostName", "mainPostName", "position"]
HR_FIELDS = ["hr", "creator"]
URL_FIELDS = ["url", "pcUrl"]

# ============================================================================
# 工具函数
# ============================================================================


def get_first(d: dict, keys: list[str], default: Any = "") -> Any:
    """按字段名优先级探测，返回第一个非空值。"""
    for k in keys:
        if k in d and d[k] not in (None, "", [], 0):
            return d[k]
    return default


def pii_mask(name: str) -> str:
    """PII 水印：中文姓名脱敏。
    - 2 字：王明 → 王*
    - 3 字：王梦琴 → 王*琴
    - 4+ 字：欧阳明月 → 欧**月
    """
    if not name or not isinstance(name, str):
        return name or ""
    n = len(name)
    if n <= 1:
        return name
    if n == 2:
        return name[0] + "*"
    if n == 3:
        return name[0] + "*" + name[2]
    return name[0] + "*" * (n - 2) + name[-1]


def get_staff_name() -> str:
    """从环境变量拿当前登录人英文名。"""
    return os.environ.get("USER", "current-user")


def parse_time_range(s: str) -> str:
    """把 'YYYY-MM-DD,YYYY-MM-DD' 转成 '起始时间戳-结束时间戳'（毫秒）。
    也支持已经是时间戳格式（直接透传）。
    """
    if not s:
        return ""
    if "-" in s and "," not in s and s.count("-") <= 1:
        # 已经是 'startMs-endMs' 格式
        return s
    parts = s.split(",")
    if len(parts) != 2:
        print(f"ERROR: --apply-time 格式应为 'YYYY-MM-DD,YYYY-MM-DD'，实际：{s}", file=sys.stderr)
        sys.exit(2)
    try:
        start = int(datetime.strptime(parts[0].strip(), "%Y-%m-%d").timestamp() * 1000)
        # 结束时间设为当天 23:59:59
        end_dt = datetime.strptime(parts[1].strip(), "%Y-%m-%d")
        end = int(end_dt.timestamp() * 1000) + 86399000
    except ValueError as e:
        print(f"ERROR: 时间格式错误 {e}", file=sys.stderr)
        sys.exit(2)
    return f"{start}-{end}"


# ============================================================================
# MCP 调用
# ============================================================================


def call_mcp(params: dict) -> dict:
    """调 recruit-mcp。优先用 mcporter；若 mcporter 不在则报错。"""
    tmp_dir = Path(os.environ.get("TMP_DIR", "/tmp"))
    tmp_dir.mkdir(parents=True, exist_ok=True)
    out_file = tmp_dir / "process_get_list.json"

    cmd = [
        "mcporter", "call", "recruit-mcp", "CallAPI",
        f"apiId={API_ID}",
        f"params={json.dumps(params, ensure_ascii=False)}",
    ]

    try:
        with open(out_file, "wb") as f:
            result = subprocess.run(
                cmd, stdout=f, stderr=subprocess.PIPE, timeout=30,
            )
    except FileNotFoundError:
        print(
            "ERROR: 找不到 mcporter 命令。本 skill 通过 mcporter 调 recruit-mcp。\n"
            "如果你是 CodeBuddy 用户且已通过 userConfig 表单接入 recruit-mcp，\n"
            "请确认 ~/.codebuddy/mcp.json 里有 recruit-mcp 段；\n"
            "如还需 mcporter 命令行支持，按招活官方指南安装：\n"
            "  https://zhaopin.woa.com/mcp/pages/user-guide.html",
            file=sys.stderr,
        )
        sys.exit(3)
    except subprocess.TimeoutExpired:
        print("ERROR: mcporter 调用超时（30s）", file=sys.stderr)
        sys.exit(3)

    if result.returncode != 0:
        print(f"ERROR: mcporter exit {result.returncode}", file=sys.stderr)
        print(result.stderr.decode("utf-8", errors="ignore"), file=sys.stderr)
        sys.exit(3)

    raw = out_file.read_bytes()
    try:
        text = raw.decode("utf-8", errors="ignore")
        m = re.search(r"\{[\s\S]+\}", text)
        if not m:
            print("ERROR: mcporter 返回不是 JSON", file=sys.stderr)
            print(text[:500], file=sys.stderr)
            sys.exit(4)
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        print(f"ERROR: JSON 解析失败 {e}", file=sys.stderr)
        sys.exit(4)

    return data


# ============================================================================
# 渲染
# ============================================================================


def detect_status_emoji(status: str) -> str:
    if "面试" in status:
        return "🟦"
    if "录用" in status or "offer" in status.lower():
        return "🟩"
    if "入职" in status:
        return "🟪"
    if "推荐" in status or "评估" in status or "筛" in status:
        return "⬜"
    if "淘汰" in status or "结束" in status or "放弃" in status:
        return "🟥"
    if "测评" in status or "背调" in status:
        return "🟨"
    return "⚪"


def render_resume_link(row: dict) -> str:
    """优先用接口返回的 url 字段；fallback 拼 zhaopin.woa.com URL。"""
    url = get_first(row, URL_FIELDS)
    if url:
        return f"[处理]({url})"
    eid = get_first(row, EID_FIELDS)
    if eid:
        return f"[详情](https://zhaopin.woa.com/resume/resume_detail?employeeId={eid})"
    return "—"


def render_table(rows: list[dict], staff_name: str, hrs_filter: list[str] | None = None) -> str:
    """渲染默认场景的 Markdown 表格。"""
    n = len(rows)
    if hrs_filter:
        title_who = "招聘经理：" + ", ".join(hrs_filter)
    else:
        title_who = f"当前登录人：{staff_name}"
    lines = [f"## 📊 招聘流程（共 {n} 条 · {title_who}）\n"]

    if n == 0:
        if hrs_filter:
            lines.append(f"未查到 {', '.join(hrs_filter)} 名下的进行中社招流程。\n")
            lines.append("可能原因：")
            lines.append("- 该招聘经理英文名拼写错误")
            lines.append("- 你的账号没有跨人查询权限（不传 `--hrs` 别人会被忽略或返回空，请确认是否有对应权限）")
            lines.append("- 该招聘经理确实没有进行中流程")
        else:
            lines.append("当前没有你负责的进行中社招流程。\n")
            lines.append("可能原因：")
            lines.append("- 你不是任何岗位的招聘经理（本接口仅查招聘经理身份）")
            lines.append("- 流程已全部走完（已入职 / 已淘汰）")
            lines.append("- Token 过期或权限不足（如收到 403，需要招聘经理权限）")
        return "\n".join(lines)

    lines.append("| # | 候选人 | 招聘 HR | 当前环节 | 环节耗时 | 总耗时 | 状态 | 部门 | 岗位 | 处理链接 |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")

    for i, row in enumerate(rows, 1):
        name = pii_mask(get_first(row, NAME_FIELDS))
        hr = get_first(row, HR_FIELDS, "—")
        step = get_first(row, STEP_FIELDS, "—")
        elapsed_now = get_first(row, ELAPSED_NOW_FIELDS, 0)
        elapsed_sum = get_first(row, ELAPSED_SUM_FIELDS, 0)
        status = get_first(row, STATUS_NAME_FIELDS, "—")
        dept = get_first(row, DEPT_FIELDS, "—")
        post = get_first(row, POST_FIELDS, "—")
        link = render_resume_link(row)

        elapsed_now_str = f"{elapsed_now} 天"
        try:
            if float(elapsed_now) > 5:
                elapsed_now_str += " ⚠️"
        except (TypeError, ValueError):
            pass

        emoji = detect_status_emoji(status)

        lines.append(
            f"| {i} | {name} | {hr} | {step} | {elapsed_now_str} | {elapsed_sum} 天 | "
            f"{emoji} {status} | {dept} | {post} | {link} |"
        )

    return "\n".join(lines)


def render_insights(rows: list[dict]) -> str:
    """智能洞察。"""
    if not rows:
        return ""

    slow = []
    for r in rows:
        try:
            d = float(get_first(r, ELAPSED_NOW_FIELDS, 0))
            if d > 5:
                slow.append((pii_mask(get_first(r, NAME_FIELDS)),
                             get_first(r, STEP_FIELDS), d))
        except (TypeError, ValueError):
            continue

    slow.sort(key=lambda x: -x[2])

    status_count: dict[str, int] = {}
    for r in rows:
        s = get_first(r, STATUS_NAME_FIELDS, "—")
        status_count[s] = status_count.get(s, 0) + 1

    lines = ["", "💡 **洞察**：", ""]

    if slow:
        top = slow[:3]
        slow_str = " / ".join(f"{n}（{step} {d:.1f}天）" for n, step, d in top)
        lines.append(f"- 偏慢环节：{len(slow)} 个流程当前环节耗时 > 5 天 — {slow_str}")

    if status_count:
        dist = " / ".join(f"{k} {v}" for k, v in sorted(
            status_count.items(), key=lambda x: -x[1]))
        lines.append(f"- 状态分布：{dist}")

    if slow:
        top1 = slow[0]
        lines.append(f"- 推进建议：可以重点关注 **{top1[0]}**（{top1[1]} 已 {top1[2]:.1f} 天），建议确认面试官档期 / 推 HR 跟进")

    if not slow and not status_count:
        return ""

    lines.append("")
    lines.append("下一步可以问：")
    lines.append("- 「只看面试中」/「只看 offer 阶段」 → 加 status-code")
    lines.append("- 「只看 <某 hr 英文名> 负责的」 → 加 hrs（需要对应跨人查询权限才有效）")
    lines.append("- 「查 xxx 现在到哪一步」 → 按候选人精确查")

    return "\n".join(lines)


def render_single_candidate(row: dict) -> str:
    """单条候选人详情视图（按候选人查命中 1 条时使用）。"""
    name = pii_mask(get_first(row, NAME_FIELDS))
    lines = [f"## 📋 {name} 的招聘流程\n"]
    lines.append("| 项 | 值 |")
    lines.append("|---|---|")
    lines.append(f"| 候选人 | {name}（PII 水印）|")
    lines.append(f"| 招聘 HR | {get_first(row, HR_FIELDS, '—')} |")
    lines.append(f"| 岗位 | {get_first(row, POST_FIELDS, '—')} |")
    lines.append(f"| 部门 | {get_first(row, DEPT_FIELDS, '—')} |")
    lines.append(f"| 当前环节 | {get_first(row, STEP_FIELDS, '—')} |")
    lines.append(f"| 环节耗时 | {get_first(row, ELAPSED_NOW_FIELDS, 0)} 天 |")
    lines.append(f"| 总耗时 | {get_first(row, ELAPSED_SUM_FIELDS, 0)} 天 |")
    lines.append(f"| 状态 | {get_first(row, STATUS_NAME_FIELDS, '—')} |")
    create_time = row.get("createTime", "")
    if create_time:
        lines.append(f"| 创建时间 | {create_time} |")
    last_update = row.get("lastUpdateTime", "")
    if last_update:
        lines.append(f"| 最后更新 | {last_update} |")
    lines.append(f"| 处理链接 | {render_resume_link(row)} |")

    try:
        d = float(get_first(row, ELAPSED_NOW_FIELDS, 0))
        if d > 5:
            step = get_first(row, STEP_FIELDS, "当前环节")
            lines.append(f"\n💡 **当前阻塞点**：{step} 已等 {d:.1f} 天未推进，建议主动跟进 / 改走简历页手工操作。")
    except (TypeError, ValueError):
        pass

    return "\n".join(lines)


# ============================================================================
# 主入口
# ============================================================================


def main():
    parser = argparse.ArgumentParser(description="招聘流程跟踪（社招）")

    # 招聘经理过滤（需对应跨人查询权限）
    parser.add_argument("--hrs", help="招聘 HR 英文名列表（逗号分隔），如 --hrs <英文名A>,<英文名B>。⚠️ 查别人必须传，不传则查自己；且需要对应跨人查询权限")
    parser.add_argument("--hr-ids", help="招聘 HR ID 列表（逗号分隔）")

    # 候选人维度
    parser.add_argument("--candidate", help="候选人姓名（模糊匹配）")
    parser.add_argument("--keyword", help="模糊关键字（候选人/岗位/部门任意维度）")
    parser.add_argument("--apply-no", help="申请单号")

    # 状态/环节
    parser.add_argument("--status-code", help="状态大类，可选：All/Resume_Screening/Interviewing/Offering/Offer_Toning/Eevaluation/Onboarding/Onboard/Ending")
    parser.add_argument("--interview-status", help="面试安排状态（仅 status-code=Interviewing 有效）：wait_arrangement/interview_arrangement/had_arrangement/hold_interview/pass_interview")
    parser.add_argument("--step-code", help="环节 Code（与 status-code 联动，详见 references/api-spec.md）")

    # 组织
    parser.add_argument("--dept", type=int, help="部门 ID")
    parser.add_argument("--post", type=int, help="岗位 ID")

    # 人员
    parser.add_argument("--interviewers", help="面试官英文名列表（逗号分隔）")
    parser.add_argument("--creators", help="申请人英文名列表（逗号分隔）")
    parser.add_argument("--process-staffs", help="当前处理人英文名列表（逗号分隔）——查某人此刻手上压着的待办，催办常用")
    parser.add_argument("--owner-staff-id", type=int, help="待办所有人/审批人的员工 Id")

    # 时间
    parser.add_argument("--apply-time", help="应聘时间区间，格式：YYYY-MM-DD,YYYY-MM-DD")
    parser.add_argument("--interview-time", help="面试时间区间，格式：YYYY-MM-DD,YYYY-MM-DD")

    # 排序与分页
    parser.add_argument("--order-field", default="lastUpdateTime",
                        choices=["createTime", "lastUpdateTime", "arriveTime"],
                        help="排序字段（默认 lastUpdateTime）")
    parser.add_argument("--asc", action="store_true", help="升序（默认降序）")
    parser.add_argument("--page-size", type=int, default=50, help="每页条数（默认 50）")
    parser.add_argument("--page", type=int, default=1, help="页码（默认 1）")

    # 完成度
    parser.add_argument("--done", choices=["true", "false"], help="已办（true）/ 待办（false）/ 不传则全部")

    # 输出
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")

    args = parser.parse_args()

    params: dict[str, Any] = {
        "currentPage": args.page,
        "pageSize": args.page_size,
        "orderField": args.order_field,
        "isDesc": not args.asc,
    }

    # 🔴 关键：接口必须有 statusCode 锚点才返回数据（实测 n=5 全 null 调用都返 0）
    # 默认补 statusCode=All（"全部"），让接口走"查我能看到的所有流程"路径
    if not args.status_code:
        params["statusCode"] = "All"
    else:
        params["statusCode"] = args.status_code

    # done 默认走"待办/进行中"（false），与浏览器页面默认行为对齐
    if args.done is None:
        params["done"] = False
    else:
        params["done"] = (args.done == "true")

    # 招聘经理
    hrs_filter = None
    if args.hrs:
        hrs_filter = [s.strip() for s in args.hrs.split(",") if s.strip()]
        params["hrs"] = hrs_filter
    if args.hr_ids:
        params["hrIds"] = [int(s.strip()) for s in args.hr_ids.split(",") if s.strip()]

    # 候选人
    if args.candidate:
        params["candidate"] = args.candidate
    if args.keyword:
        params["fuzzyQuery"] = args.keyword
    if args.apply_no:
        params["applyNo"] = args.apply_no

    # 状态/环节（statusCode 已在上面默认补 "All"，此处只处理子状态）
    if args.interview_status:
        params["interviewStatus"] = args.interview_status
    if args.step_code:
        params["stepCode"] = args.step_code

    # 组织
    if args.dept:
        params["deptIds"] = [args.dept]
    if args.post:
        params["postIds"] = [args.post]

    # 人员
    if args.interviewers:
        params["interviewers"] = [s.strip() for s in args.interviewers.split(",") if s.strip()]
    if args.creators:
        params["creators"] = [s.strip() for s in args.creators.split(",") if s.strip()]
    if args.process_staffs:
        params["currentProcessStaffs"] = [s.strip() for s in args.process_staffs.split(",") if s.strip()]
    if args.owner_staff_id:
        params["ownerStaffId"] = args.owner_staff_id

    # 时间
    if args.apply_time:
        params["applyTime"] = parse_time_range(args.apply_time)
    if args.interview_time:
        params["interviewTime"] = parse_time_range(args.interview_time)

    # done 已在上方 default false 兜底处理，此处不再覆盖

    resp = call_mcp(params)

    # 🔴 mcporter 返回是双层嵌套：{ status, data: { code, message, data: { total, rows } } }
    # 先剥外层 mcporter wrapper（status / data），再剥业务 wrapper（code / data）
    if isinstance(resp.get("status"), int) and isinstance(resp.get("data"), dict):
        # 外层是 mcporter wrapper，下沉一层
        resp = resp["data"]

    # 鉴权 / 业务错误处理
    code = str(resp.get("code", ""))
    if code in ("401", "Unauthorized"):
        print("ERROR: 401 Unauthorized — 太湖 Token 过期", file=sys.stderr)
        sys.exit(3)
    if code in ("403", "Forbidden"):
        print(
            "ERROR: 403 Forbidden — 招活 Token 无对应权限。\n"
            "请确认你的账号是否有「招聘经理」或「跨人查询」对应权限——本接口仅对持有相应权限的账号开放。\n"
            "如果你只是面试官，请改用 interview-assistant 查面试待办；\n"
            "如果你确认应该有权限但仍 403，请联系 HR 业务运维确认权限配置。\n"
            "⚠️ 不需要重新申请 Token——这是角色权限问题，不是 Token 问题。",
            file=sys.stderr,
        )
        sys.exit(5)
    if code not in ("200", "0", ""):
        msg = resp.get("message") or resp.get("msg", "")
        print(f"ERROR: code={code} msg={msg}", file=sys.stderr)
        sys.exit(4)

    data = resp.get("data", {})
    if isinstance(data, dict):
        rows = data.get("rows", []) or data.get("list", [])
    elif isinstance(data, list):
        rows = data
    else:
        rows = []

    if args.format == "json":
        print(json.dumps({"rows": rows, "total": len(rows)},
                         ensure_ascii=False, indent=2))
        return

    staff = get_staff_name()

    # 单候选人查询命中 1 条 → 详细视图
    if (args.candidate or args.keyword) and len(rows) == 1:
        print(render_single_candidate(rows[0]))
        return

    # 命中多条或默认场景 → 表格 + 洞察
    print(render_table(rows, staff, hrs_filter))
    if rows:
        print(render_insights(rows))


if __name__ == "__main__":
    main()
