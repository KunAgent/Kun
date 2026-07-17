#!/usr/bin/env python3
"""daily_resume_pick.py — 定时简历搜推「自托闭环」选人脚本（方案 B · 仅粗筛）

设计目标（为什么有这个脚本）：
  定时任务要的是「能稳定跑完」，不是「搜得最全最准」。zhaopin-operations /
  zhaopin-social-operations 这两个搜简历 skill 的 SOP 很重（校招两轮 + 逐份点开
  简历详情精读），定时无人值守时链路过长，经常半路被调度器 cancel / internal error。

  本脚本把定时搜推做成一条「短链路、自托闭环」：
    搜一次 → 用搜索结果里【直接带的字段】粗筛打分排序 → 取 Top N。
  全程【不点开任何一份简历详情】，不翻页、不二次扩搜。链路从「重得跑不完」变成
  「线性几秒完成」。需要逐份精读时，请走交互式的 zhaopin-* skill，不要走本脚本。

边界（必须遵守）：
  - 本脚本只做「粗筛选人 + 出表数据」，不做面试/面评/约面。
  - 只搜 1 轮、只用搜索返回字段打分，不调用任何「详情/精读」接口。
  - 候选人姓名可展示；手机/邮箱/身份证等敏感字段一律不输出。

用法：
  python3 daily_resume_pick.py \
      --type campus|social \
      --params <搜索参数 json 文件> \
      --top-n 10 \
      [--mcporter /opt/homebrew/bin/mcporter] \
      [--skill-dir <对应搜简历 skill 目录>] \
      [--input <已有的 candidates.jsonl，跳过搜索直接粗筛>]

输出（stdout，纯 JSON）：
  {"status":"ok","total":N,"picked":K,"rows":[{...}], "type":"campus"}
  rows 每项含：name / school_or_company / education / major / position / score / rid / link
退出码：0 成功（含 picked=0）；1 业务错误；2 鉴权/搜索失败需人工
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

_TAG_RE = re.compile(r"<[^>]+>")


def clean(v):
    """去掉搜索接口返回的高亮 HTML 标签（如 <span style=...>...</span>），并反转义常见实体。"""
    if not isinstance(v, str):
        return v
    s = _TAG_RE.sub("", v)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        s = s.replace(a, b)
    return s.strip()

CAMPUS_API = "recruit.campus-resume-search.post_v1_resume_search"
SOCIAL_API = "recruit.social-resume.post_api_resume_query_query"

CAMPUS_LINK = "https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}&from=recruit-mcp"
SOCIAL_LINK = "https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP"

# 顶尖院校兜底名单（当 schoolLevelTag 缺失时用学校名判梯队）
TOP_SCHOOLS = {
    "清华大学", "北京大学", "浙江大学", "上海交通大学", "复旦大学", "南京大学",
    "中国科学技术大学", "西安交通大学", "哈尔滨工业大学", "华中科技大学",
    "武汉大学", "中山大学", "北京航空航天大学", "同济大学", "东南大学",
}


def find_mcporter() -> str:
    for p in ("/opt/homebrew/bin/mcporter", "/usr/local/bin/mcporter"):
        if os.path.exists(p):
            return p
    return "mcporter"


def _extract_resumes(raw: dict) -> tuple:
    """从 recruit-mcp CallAPI 原始返回里抽出简历列表，兼容校招/社招两种结构。
    校招：data.data.list（mcporter_call.py 也会转成 JSONL）
    社招：data.data.resumes
    返回 (resumes:list, meta:dict)。
    """
    inner = raw.get("data", {}) or {}
    inner_status = inner.get("status")
    inner_msg = inner.get("message", "") or inner.get("msg", "")
    # 401 / 面试官权限
    if inner_status == 401:
        return [], {"error": "NO_INTERVIEWER_PERMISSION",
                    "error_detail": f"招聘平台返回 401: {inner_msg}。请到 hrright.woa.com 申请面试官权限。"}
    dd = inner.get("data", {}) or {}
    if isinstance(dd, dict):
        # 社招优先 resumes，校招用 list
        for key in ("resumes", "list"):
            lst = dd.get(key)
            if isinstance(lst, list):
                total = dd.get("totalCount") or dd.get("total") or len(lst)
                return lst, {"total": total}
    return [], {"total": 0, "message": inner_msg}


def run_search(skill_dir: str, mcporter: str, api_id: str, params: dict) -> tuple:
    """直接用 mcporter CLI 调 recruit-mcp CallAPI 搜一次（不进任何 skill SOP）。
    stdout 直接写临时文件避免缓冲截断。兼容校招/社招两种返回结构。
    返回 (resumes:list, meta:dict)。"""
    workspace = os.environ.get("MCPORTER_WORKSPACE") or os.path.expanduser("~/.box/Workspace")
    params_str = json.dumps(params, ensure_ascii=False)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".raw.json", delete=False, encoding="utf-8") as tmp:
        raw_path = tmp.name
    try:
        cmd = [mcporter, "call", "recruit-mcp", "CallAPI",
               f"apiId={api_id}", f"params={params_str}"]
        cwd = workspace if os.path.isdir(workspace) else None
        with open(raw_path, "w", encoding="utf-8") as out:
            proc = subprocess.run(cmd, stdout=out, stderr=subprocess.PIPE,
                                  text=True, timeout=180, cwd=cwd)
        content = open(raw_path, encoding="utf-8").read().strip()
        if not content:
            return [], {"error": "search produced no output", "stderr": proc.stderr[-500:]}
        try:
            raw = json.loads(content)
        except json.JSONDecodeError as e:
            return [], {"error": f"JSON parse failed: {e}", "stderr": proc.stderr[-300:]}
        return _extract_resumes(raw)
    finally:
        try:
            os.unlink(raw_path)
        except OSError:
            pass


def field(r: dict, *keys, default=""):
    for k in keys:
        v = r.get(k)
        if v not in (None, "", []):
            return clean(v) if isinstance(v, str) else v
    return default


def score_campus(r: dict) -> int:
    """校招粗筛打分：只用搜索返回字段，不点详情。"""
    s = 0
    tags = str(field(r, "schoolLevelTag"))
    school = str(field(r, "school"))
    if any(x in tags for x in ("C9", "985")) or school in TOP_SCHOOLS:
        s += 40
    elif "211" in tags:
        s += 28
    else:
        s += 18
    rank = str(field(r, "rankLevelTxt"))
    if "前5%" in rank or "前10%" in rank:
        s += 25
    elif "前" in rank:
        s += 15
    if field(r, "skillTag") or field(r, "highlightTags") or field(r, "otherHighlight"):
        s += 20
    if field(r, "projectList") or field(r, "workExperienceList"):
        s += 15
    return s


def score_social(r: dict) -> int:
    """社招粗筛打分：只用搜索返回字段（学校梯队 + 现司 + 高亮命中 + 年限），不点详情。
    社招真实字段：lastEduSchool / lastEduLevel / lastEduMajorName /
                  lastEmployerName / lastEmployerTitle / workYearsNumber / highLightOthers
    """
    s = 0
    # 学校梯队（社招学校在 lastEduSchool）
    school = str(field(r, "lastEduSchool", "school"))
    tags = str(field(r, "schoolLevelTags", "schoolLevelTag"))
    if any(x in tags for x in ("C9", "985")) or school in TOP_SCHOOLS:
        s += 25
    elif "211" in tags:
        s += 18
    else:
        s += 10
    # 现司 + 现职位（有 = 信息完整）
    if field(r, "lastEmployerName"):
        s += 12
    if field(r, "lastEmployerTitle"):
        s += 8
    # 高亮命中（searchKey 命中越多越相关）
    hl = field(r, "highLightOthers", default=[])
    if isinstance(hl, list):
        s += min(len(hl), 6) * 6
    # 工作年限（社招看 workYearsNumber）
    yrs = field(r, "workYearsNumber", "workYears", default=0)
    try:
        s += min(int(float(yrs)), 10)
    except (TypeError, ValueError):
        pass
    return s


def row_campus(r: dict, score: int) -> dict:
    rid = field(r, "rid", "RID", "id")
    return {
        "name": field(r, "name"),
        "school_or_company": field(r, "school", default="-"),
        "education": field(r, "educationTxt", default="-"),
        "major": field(r, "speciality", default="-"),
        "position": field(r, "stationTxt", default="-"),
        "score": score,
        "rid": rid,
        "link": CAMPUS_LINK.format(rid=rid),
    }


def row_social(r: dict, score: int) -> dict:
    rid = field(r, "rid", "RID", "id")
    return {
        "name": field(r, "name"),
        "school_or_company": field(r, "lastEmployerName", default="-"),  # 现司
        "education": field(r, "lastEduLevel", "educationTxt", "degree", default="-"),
        "major": field(r, "lastEduMajorName", default="-"),  # 专业
        "position": field(r, "lastEmployerTitle", default="-"),  # 现职位
        "work_years": field(r, "workYearsText", default=""),
        "school": field(r, "lastEduSchool", default="-"),
        "score": score,
        "rid": rid,
        "link": SOCIAL_LINK.format(rid=rid),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", required=True, choices=["campus", "social"])
    ap.add_argument("--params", help="搜索参数 JSON 文件（搜索模式必填）")
    ap.add_argument("--input", help="已有 candidates.jsonl（跳过搜索，直接粗筛）")
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--mcporter", default=None)
    ap.add_argument("--skill-dir", default=None,
                    help="对应搜简历 skill 目录；默认按 type 推断 zhaopin-operations/zhaopin-social-operations")
    args = ap.parse_args()

    top_n = max(1, min(args.top_n, 10))  # 企微卡片长度上限，硬顶 10
    is_campus = args.type == "campus"
    api_id = CAMPUS_API if is_campus else SOCIAL_API
    scorer = score_campus if is_campus else score_social
    rower = row_campus if is_campus else row_social

    # 获取候选池
    if args.input:
        lines = [l for l in open(args.input, encoding="utf-8") if l.strip()]
        resumes = []
        for l in lines:
            obj = json.loads(l)
            if "_meta" in obj:
                continue
            resumes.append(obj)
        meta = {"total": len(resumes), "source": "input"}
    else:
        if not args.params:
            print(json.dumps({"status": "error", "msg": "需要 --params 或 --input"}, ensure_ascii=False))
            sys.exit(1)
        mcporter = args.mcporter or find_mcporter()
        skill_dir = args.skill_dir
        if not skill_dir:
            base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            skill_dir = os.path.join(base, "zhaopin-operations" if is_campus else "zhaopin-social-operations")
        params = json.load(open(args.params, encoding="utf-8"))
        resumes, meta = run_search(skill_dir, mcporter, api_id, params)
        if meta.get("error") == "NO_INTERVIEWER_PERMISSION":
            print(json.dumps({"status": "need_auth", "msg": meta.get("error_detail", "面试官权限不足")}, ensure_ascii=False))
            sys.exit(2)
        if meta.get("error"):
            print(json.dumps({"status": "error", "msg": meta.get("error"), "meta": meta}, ensure_ascii=False))
            sys.exit(2)

    # 粗筛排序 + 取 Top N（全程不点详情）
    scored = sorted(resumes, key=scorer, reverse=True)
    picked = scored[:top_n]
    rows = [rower(r, scorer(r)) for r in picked]

    print(json.dumps({
        "status": "ok",
        "type": args.type,
        "total": len(resumes),
        "picked": len(rows),
        "rows": rows,
    }, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
