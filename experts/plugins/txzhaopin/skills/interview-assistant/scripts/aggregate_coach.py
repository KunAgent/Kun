#!/usr/bin/env python3
"""
聚合某面试官的多场复盘评估，输出趋势分析数据（JSON）供 LLM 撰写成长报告。

输入：
  --interviewer-login   被评估面试官的 SSO loginName
  [--limit N]           最近 N 场（默认 5）
  [--evaluator-login]   过滤评估发起人（默认全部，不限自评/他评）
  [--scope self|all]    self=只看自评 / all=全部（含他评，默认）

输出（stdout，单行 JSON）：
{
  "interviewer_login": "...",
  "scope": "all",
  "n_evaluations": 4,
  "date_range": ["2026-04-15", "2026-06-08"],
  "evaluations": [...],         # 详细 N 条记录
  "trends": {                   # 5 维分档计数
    "question_effectiveness": {"优":1,"良":2,"中":1,"弱":0,"latest":"良","arrow":"↑"},
    ...
  },
  "behavior_norm_pass_rate": {  # 4 项达标率
    "opening": 1.0,
    "atmosphere": 0.5,
    ...
  },
  "persistent_weak": ["follow_up_depth"],   # 连续 ≥3 次「中」或「弱」
  "improved": ["question_effectiveness"],   # 早期「中」最近「良」+
  "warning_low_data": false                 # 是否数据不足（<3 条）
}

退出码：
  0  成功
  4  目录为空 / 找不到该面试官的任何记录
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ARCHIVE_ROOT = Path.home() / ".workbuddy" / "skills" / "interview-assistant" / "coach-archive"

GRADE_TO_NUM = {"优": 4, "良": 3, "中": 2, "弱": 1}
NUM_TO_GRADE = {v: k for k, v in GRADE_TO_NUM.items()}

DIMS = [
    "question_effectiveness",
    "question_targeting",
    "follow_up_completeness",
    "follow_up_depth",
    "follow_up_flexibility",
]
NORMS = ["opening", "atmosphere", "closing", "time_management"]


def load_records(login: str, scope: str, evaluator_filter: str | None) -> list[dict]:
    """读取该面试官全部记录，按面试日期倒序"""
    base = ARCHIVE_ROOT / login
    if not base.exists():
        return []
    records = []
    for month_dir in base.iterdir():
        if not month_dir.is_dir():
            continue
        for f in month_dir.glob("*.json"):
            try:
                with f.open(encoding="utf-8") as fh:
                    rec = json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue
            if scope == "self" and not rec.get("is_self_eval", False):
                continue
            if evaluator_filter and rec.get("evaluator_login") != evaluator_filter:
                continue
            records.append(rec)
    records.sort(key=lambda r: r.get("interview_date", ""), reverse=True)
    return records


def compute_trends(recs: list[dict]) -> dict:
    """计算 5 维趋势（按时间顺序，最早→最新）"""
    if not recs:
        return {}
    chronological = sorted(recs, key=lambda r: r.get("interview_date", ""))
    out = {}
    for dim in DIMS:
        grades = [r["scores"].get(dim) for r in chronological
                  if r.get("scores", {}).get(dim) in GRADE_TO_NUM]
        if not grades:
            continue
        counter = Counter(grades)
        nums = [GRADE_TO_NUM[g] for g in grades]
        latest = grades[-1]
        # 趋势箭头：比较前半均值 vs 后半均值
        if len(nums) >= 2:
            mid = len(nums) // 2
            early = sum(nums[:mid or 1]) / (mid or 1)
            late = sum(nums[mid:]) / max(len(nums) - mid, 1)
            if late - early > 0.5:
                arrow = "↑"
            elif late - early < -0.5:
                arrow = "↓"
            else:
                arrow = "→"
        else:
            arrow = "→"
        out[dim] = {
            "优": counter.get("优", 0),
            "良": counter.get("良", 0),
            "中": counter.get("中", 0),
            "弱": counter.get("弱", 0),
            "latest": latest,
            "arrow": arrow,
        }
    return out


def compute_norm_pass_rate(recs: list[dict]) -> dict:
    """4 项行为规范达标率"""
    out = {}
    for n in NORMS:
        passes = 0
        total = 0
        for r in recs:
            v = r.get("behavior_norm", {}).get(n)
            if v is None:
                continue
            total += 1
            if v in ("达标", "✅", "pass", True):
                passes += 1
        out[n] = round(passes / total, 2) if total else None
    return out


def find_persistent_weak(trends: dict) -> list[str]:
    """连续 ≥3 次中/弱的维度"""
    out = []
    for dim, t in trends.items():
        if (t["中"] + t["弱"]) >= 3:
            out.append(dim)
    return out


def find_improved(recs: list[dict]) -> list[str]:
    """早期「中」最近「良」或「优」"""
    if len(recs) < 4:
        return []
    chronological = sorted(recs, key=lambda r: r.get("interview_date", ""))
    early_half = chronological[: len(chronological) // 2]
    late_half = chronological[len(chronological) // 2 :]
    out = []
    for dim in DIMS:
        early = [r["scores"].get(dim) for r in early_half if r.get("scores", {}).get(dim)]
        late = [r["scores"].get(dim) for r in late_half if r.get("scores", {}).get(dim)]
        if not early or not late:
            continue
        early_avg = sum(GRADE_TO_NUM.get(g, 0) for g in early) / len(early)
        late_avg = sum(GRADE_TO_NUM.get(g, 0) for g in late) / len(late)
        if early_avg <= 2.5 and late_avg >= 3:  # 早期 中 → 后期 良+
            out.append(dim)
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="聚合面试官多场复盘评估")
    p.add_argument("--interviewer-login", required=True)
    p.add_argument("--limit", type=int, default=5,
                   help="最近 N 场（默认 5；建议 3-5 场，>10 场会触发降级提醒）")
    p.add_argument("--scope", choices=["self", "all"], default="all")
    p.add_argument("--evaluator-login", default=None,
                   help="过滤评估发起人 loginName")
    args = p.parse_args()

    recs = load_records(args.interviewer_login, args.scope, args.evaluator_login)
    if not recs:
        print(json.dumps({
            "interviewer_login": args.interviewer_login,
            "scope": args.scope,
            "n_evaluations": 0,
            "warning_low_data": True,
            "message": "未找到该面试官的复盘评估记录，请先用 E 类目做单场复盘累积数据"
        }, ensure_ascii=False))
        return 4

    recs = recs[: args.limit]
    dates = [r.get("interview_date", "") for r in recs if r.get("interview_date")]
    out = {
        "interviewer_login": args.interviewer_login,
        "scope": args.scope,
        "n_evaluations": len(recs),
        "warning_low_data": len(recs) < 3,
        "date_range": [min(dates), max(dates)] if dates else [],
        "evaluations": [
            {
                "trace_id": r.get("trace_id"),
                "candidate_name": r.get("candidate_name", ""),
                "interview_date": r.get("interview_date", ""),
                "is_self_eval": r.get("is_self_eval", False),
                "evaluator_login": r.get("evaluator_login"),
                "scores": r.get("scores", {}),
                "metrics": r.get("metrics", {}),
                "improvements": r.get("improvements", []),
            }
            for r in recs
        ],
        "trends": compute_trends(recs),
        "behavior_norm_pass_rate": compute_norm_pass_rate(recs),
        "persistent_weak": find_persistent_weak(compute_trends(recs)),
        "improved": find_improved(recs),
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
