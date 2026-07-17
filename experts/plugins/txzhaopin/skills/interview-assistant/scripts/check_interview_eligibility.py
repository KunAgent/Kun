#!/usr/bin/env python3
"""
check_interview_eligibility.py - 判断候选人当前能否走 S 模块的"面试安排"

判定规则（v1.1 · 校招 + 社招）：

  【校招】（--type campus，默认）
    - flow_status ∈ {2, 3, 4, 5, 6}（集体面试/初试/复试/GM·面委会·EVP/HR面试）
      → eligible=True，可走 S 模块改时间/取消
    - 其他所有状态（含 0 待筛选 / 1 已锁定 / 8 放弃 / 12-15 录用 / 24-30 offer 等）
      → eligible=False，引导用户去候选人简历详情页

  【社招】（--type social）
    - statusText == "面试中"（**唯一白名单**）
      → eligible=True，可走 S 模块
    - 其他所有 statusText（待筛选/推荐中/已淘汰/已入职/...）
      → eligible=False，引导用户去候选人简历详情页

用法：
    # 方式 A：传 rid，自动调 recruit-mcp 拉简历详情
    python3 check_interview_eligibility.py --type campus --rid <rid>
    python3 check_interview_eligibility.py --type social --rid <rid>

    # 方式 B：已经拉过简历详情 JSON，直接传文件
    python3 check_interview_eligibility.py --type campus --resume-json <file>
    python3 check_interview_eligibility.py --type social --resume-json <file>

    # 方式 C：直接传状态（agent 已知状态时离线判定）
    python3 check_interview_eligibility.py --type campus --flow-status 3
    python3 check_interview_eligibility.py --type social --status-text 面试中

返回结构（stdout JSON）：
    {
      "type": "campus" | "social",
      "eligible": bool,
      "flow_status": int | null,         # 校招：状态码
      "flow_status_text": str | null,    # 校招/社招：状态文字
      "category": str,                   # interviewing / screening / ... / unknown
      "action": str,                     # schedule_change / go_resume_page
      "message": str,                    # 给用户的提示（含简历页链接）
      "resume_url": str | null,
      "candidate_name": str | null
    }

退出码：
    0 - eligible=True，可走 S 模块
    1 - eligible=False，需引导用户去页面
    2 - 输入错误（rid 非法、文件不存在、JSON 解析失败、参数缺失）
    3 - mcporter 调用失败 / 鉴权失败
    4 - 候选人无权访问 / RID 失效 / 字段缺失

v1.1 - 2026-05-27 - 新增社招支持
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

# ============================================================================
# 校招状态表（同步自 zhaopin-operations/filters/flow-status.md）
# ============================================================================

# 校招唯一"可走 S 模块"白名单
CAMPUS_SCHEDULABLE = {2, 3, 4, 5, 6}

CAMPUS_STATUS_META: dict[int, dict[str, str]] = {
    0:  {"text": "待筛选",            "category": "screening"},
    1:  {"text": "已锁定",            "category": "locked_pre_interview"},
    16: {"text": "待分配",            "category": "assigning"},
    17: {"text": "已分配",            "category": "locked_pre_interview"},
    2:  {"text": "集体面试",          "category": "interviewing"},
    3:  {"text": "初试",              "category": "interviewing"},
    4:  {"text": "复试",              "category": "interviewing"},
    5:  {"text": "GM/面委会/EVP面试", "category": "interviewing"},
    6:  {"text": "HR面试",            "category": "interviewing"},
    8:  {"text": "面试流程放弃",      "category": "abandoned"},
    26: {"text": "offer审批中",       "category": "offer"},
    25: {"text": "学生意向确认",      "category": "offer"},
    27: {"text": "offer流程放弃",     "category": "abandoned"},
    28: {"text": "实习生offer确认中", "category": "offer"},
    30: {"text": "毕业生offer确认中", "category": "offer"},
    12: {"text": "实习已录用",        "category": "hired"},
    13: {"text": "实习生考核淘汰",    "category": "abandoned"},
    24: {"text": "录用评估中",        "category": "offer"},
    14: {"text": "实习生考核转推荐",  "category": "hired"},
    15: {"text": "毕业生已录用",      "category": "hired"},
    22: {"text": "已锁定在项目",      "category": "locked_pre_interview"},
    23: {"text": "已锁定在项目面试官", "category": "locked_pre_interview"},
    31: {"text": "入职流程放弃",      "category": "abandoned"},
}

# ============================================================================
# 社招状态规则
# ============================================================================

# 社招唯一"可走 S 模块"白名单 —— 简历 statusText 命中即可
SOCIAL_SCHEDULABLE_TEXTS = {"面试中"}

# ============================================================================
# 提示文案（按 category 归类，校招 + 社招通用）
# ============================================================================

CATEGORY_MESSAGES = {
    "interviewing": (
        "✅ 候选人当前处于「{status_text}」阶段，可以进行面试时间调整/取消等操作。"
    ),
    "screening": (
        "🟡 候选人当前是「{status_text}」状态。请去简历详情页直接发起面试：\n"
        "👉 {resume_url}"
    ),
    "locked_pre_interview": (
        "🟡 候选人当前是「{status_text}」状态，已锁定但**还未发起面试**。\n"
        "请去简历详情页发起面试（需要选择是否保密、回流、面试轮次、面试官、部门、岗位）：\n"
        "👉 {resume_url}"
    ),
    "assigning": (
        "🟡 候选人当前是「{status_text}」状态，等待 HR 分配到具体面试官。分配完成后再回来安排面试。\n"
        "查看简历详情：👉 {resume_url}"
    ),
    "offer": (
        "🚫 候选人当前已进入 Offer 阶段（「{status_text}」），不再适用面试安排。\n"
        "如需查看进度，请打开简历详情页：👉 {resume_url}"
    ),
    "hired": (
        "🚫 候选人已录用（「{status_text}」），无法再安排面试。\n"
        "查看简历详情：👉 {resume_url}"
    ),
    "abandoned": (
        "🟡 候选人之前的流程已终止（「{status_text}」）。\n"
        "如需重新面试，请去简历详情页直接发起：\n"
        "👉 {resume_url}"
    ),
    "social_other": (
        "🟡 候选人当前是「{status_text}」状态，不属于「面试中」。\n"
        "请去简历详情页直接发起面试：\n"
        "👉 {resume_url}"
    ),
    "unknown": (
        "⚠️ 候选人状态未识别（原始值：{status_raw}），请去简历详情页人工确认：👉 {resume_url}"
    ),
}

RESUME_URL_TEMPLATE = "https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP"

# ============================================================================
# 接口配置（按招聘类型分发）
# ============================================================================

API_CONFIG = {
    "campus": {
        "apiId": "recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId",
        # 校招详情：response.data.data.data.resumeInfo
        "json_paths": [
            ["data", "data", "data", "resumeInfo"],
            ["data", "data", "resumeInfo"],
        ],
    },
    "social": {
        "apiId": "recruit.social-resume.get_api_resume_detail_getresume_with_detail",
        # 社招详情：response.data.resume 或 response.data.data.resume
        "json_paths": [
            ["data", "resume"],
            ["data", "data", "resume"],
        ],
    },
}


# ============================================================================
# 通用工具
# ============================================================================

def build_resume_url(rid: str | None) -> str | None:
    return RESUME_URL_TEMPLATE.format(rid=rid) if rid else None


def fetch_resume_json(rid: str, rec_type: str, tmp_dir: Path) -> Path:
    """调 recruit-mcp 拉简历详情，返回原始 JSON 文件路径。"""
    api_id = API_CONFIG[rec_type]["apiId"]
    out_path = tmp_dir / f"resume_{rec_type}_{rid}.json"
    if rec_type == "social":
        params = f'params={{"rid":"{rid}","fromPlace":"MCP"}}'
    else:
        params = f'params={{"rid":"{rid}"}}'
    cmd = ["mcporter", "call", "recruit-mcp", "CallAPI", f"apiId={api_id}", params]
    with out_path.open("w", encoding="utf-8") as f:
        proc = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(f"mcporter call failed (exit {proc.returncode}):\n{proc.stderr}\n")
        sys.exit(3)
    return out_path


def dig(obj: Any, path: list[str]) -> Any:
    cur = obj
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def parse_resume_info(resume_json_path: Path, rec_type: str) -> dict[str, Any]:
    """从 mcporter 返回的 JSON 中提取候选人信息（按 rec_type 分发解析路径）。"""
    try:
        raw = json.loads(resume_json_path.read_text(encoding="utf-8"))
    except Exception as e:
        sys.stderr.write(f"failed to parse JSON: {e}\n")
        sys.exit(2)

    if isinstance(raw, dict) and raw.get("error"):
        msg = raw.get("error", {}).get("message", "")
        if "AUTH" in msg or "permission" in msg.lower():
            sys.stderr.write(f"AUTH failure: {msg}\n")
            sys.exit(3)

    for path in API_CONFIG[rec_type]["json_paths"]:
        info = dig(raw, path)
        if isinstance(info, dict) and info:
            return info

    sys.stderr.write(
        f"resume info not found in response for type={rec_type}; "
        "RID may be invalid or unauthorized\n"
    )
    sys.exit(4)


# ============================================================================
# 校招判定
# ============================================================================

def classify_campus(flow_status: int | None) -> dict[str, str]:
    if flow_status is None:
        return {"text": "未知", "category": "unknown"}
    meta = CAMPUS_STATUS_META.get(flow_status)
    if not meta:
        return {"text": f"未识别({flow_status})", "category": "unknown"}
    return {"text": meta["text"], "category": meta["category"]}


def judge_campus(info: dict[str, Any]) -> tuple[bool, int | None, dict[str, str], str | None]:
    fs_raw = info.get("flowStatus")
    try:
        flow_status = int(fs_raw) if fs_raw is not None else None
    except (TypeError, ValueError):
        flow_status = None
    cls = classify_campus(flow_status)
    eligible = flow_status in CAMPUS_SCHEDULABLE
    name = info.get("name")
    return eligible, flow_status, cls, name


# ============================================================================
# 社招判定
# ============================================================================

def classify_social(status_text: str | None) -> dict[str, str]:
    if status_text is None:
        return {"text": "未知", "category": "unknown"}
    if status_text in SOCIAL_SCHEDULABLE_TEXTS:
        return {"text": status_text, "category": "interviewing"}
    return {"text": status_text, "category": "social_other"}


def judge_social(info: dict[str, Any]) -> tuple[bool, str | None, dict[str, str], str | None]:
    # 社招详情 resume 子对象用 statusText
    status_text = info.get("statusText") or info.get("status_text")
    cls = classify_social(status_text)
    eligible = cls["category"] == "interviewing"
    name = info.get("name") or info.get("Name")
    return eligible, status_text, cls, name


# ============================================================================
# 渲染输出
# ============================================================================

def render_message(category: str, status_text: str, status_raw: Any,
                   resume_url: str | None) -> str:
    template = CATEGORY_MESSAGES.get(category, CATEGORY_MESSAGES["unknown"])
    return template.format(
        status_text=status_text,
        status_raw=status_raw if status_raw is not None else "",
        resume_url=resume_url or "（rid 未知，无法生成链接）",
    )


# ============================================================================
# main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="判断候选人能否直接走 S 模块的面试安排")
    parser.add_argument("--type", choices=["campus", "social"], default="campus",
                        help="招聘类型：campus（校招，默认）/ social（社招）")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--rid", help="候选人 RID（自动调 recruit-mcp 拉详情）")
    src.add_argument("--resume-json", help="已拉好的简历详情 JSON 文件路径")
    src.add_argument("--flow-status", type=int,
                     help="【校招】直接传 flowStatus 数字码（离线判定）")
    src.add_argument("--status-text", type=str,
                     help="【社招】直接传 statusText 文本（离线判定）")
    parser.add_argument("--tmp-dir", default=os.environ.get("TMP_DIR", "/tmp"),
                        help="拉简历时的中转目录，默认 $TMP_DIR 或 /tmp")
    args = parser.parse_args()

    rec_type: str = args.type
    rid: str | None = None
    name: str | None = None

    # 路径 1：离线判定（参数与 type 须匹配）
    if args.flow_status is not None:
        if rec_type != "campus":
            sys.stderr.write("--flow-status 仅适用于 --type campus\n")
            sys.exit(2)
        cls = classify_campus(args.flow_status)
        eligible = args.flow_status in CAMPUS_SCHEDULABLE
        status_value: Any = args.flow_status
        status_text = cls["text"]
        category = cls["category"]
        resume_url = None

    elif args.status_text is not None:
        if rec_type != "social":
            sys.stderr.write("--status-text 仅适用于 --type social\n")
            sys.exit(2)
        cls = classify_social(args.status_text)
        eligible = cls["category"] == "interviewing"
        status_value = args.status_text
        status_text = cls["text"]
        category = cls["category"]
        resume_url = None

    # 路径 2：rid / 已拉 json
    else:
        if args.rid:
            rid = args.rid.strip()
            if not rid or len(rid) < 8:
                sys.stderr.write("invalid rid\n")
                sys.exit(2)
            tmp_dir = Path(args.tmp_dir)
            tmp_dir.mkdir(parents=True, exist_ok=True)
            resume_path = fetch_resume_json(rid, rec_type, tmp_dir)
        else:
            resume_path = Path(args.resume_json)
            if not resume_path.exists():
                sys.stderr.write(f"resume json not found: {resume_path}\n")
                sys.exit(2)

        info = parse_resume_info(resume_path, rec_type)

        if rec_type == "campus":
            eligible, status_value, cls, name = judge_campus(info)
        else:
            eligible, status_value, cls, name = judge_social(info)
        status_text = cls["text"]
        category = cls["category"]

        if not rid:
            rid = info.get("rid") or info.get("RID")
        resume_url = build_resume_url(rid)

    if 'resume_url' not in dir() or resume_url is None:
        resume_url = build_resume_url(rid)

    action = "schedule_change" if eligible else "go_resume_page"
    message = render_message(category, status_text, status_value, resume_url)

    result = {
        "type": rec_type,
        "eligible": eligible,
        "flow_status": status_value if (rec_type == "campus" and isinstance(status_value, int))
                       else None,
        "flow_status_text": status_text,
        "category": category,
        "action": action,
        "message": message,
        "resume_url": resume_url,
        "candidate_name": name,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if eligible else 1)


if __name__ == "__main__":
    main()
