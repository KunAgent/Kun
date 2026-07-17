#!/usr/bin/env python3
"""
存档单场复盘评估结果到本地

存储路径：
  ~/.workbuddy/skills/interview-assistant/coach-archive/
    └─ <interviewer_login>/        # 被评估的面试官（多人评估同一人时也都汇到这里）
        └─ <YYYYMM>/
            └─ <traceId>.json       # 单场评估
            └─ <traceId>__by-<manager_login>.json   # 招聘经理评估变体（区分自评 vs 他评）

为什么这样分桶：
  - 按面试官分顶层目录 → 取某面试官全部评估只读 1 个目录
  - 月份分桶 → 单文件夹 ≤30 个文件，列目录性能可控
  - 自评 vs 他评分文件名后缀区分 → 同一场面试可能存在多版本评估

用法：
  python3 save_coach_eval.py \\
    --trace-id <TRACE_ID> \\
    --interviewer-login eliozeli \\
    --eval-json '{"scores": {...}, "highlights": [...], ...}' \\
    [--evaluator-login someone-else]   # 招聘经理评估时传

输出：
  存档文件的绝对路径（写到 stdout 一行）

退出码：
  0  成功
  2  参数错误
  3  写入失败
"""
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ARCHIVE_ROOT = Path.home() / ".workbuddy" / "skills" / "interview-assistant" / "coach-archive"


def main() -> int:
    p = argparse.ArgumentParser(description="存档单场复盘评估结果")
    p.add_argument("--trace-id", required=True, help="面试 traceId（来自招活/腾讯会议）")
    p.add_argument("--interviewer-login", required=True,
                   help="**被评估**面试官的 SSO loginName（即作为评估对象的面试官）")
    p.add_argument("--eval-json", required=True,
                   help="评估结果 JSON 字符串，必须包含 scores/highlights/improvements")
    p.add_argument("--evaluator-login", default=None,
                   help="评估发起人 SSO loginName。默认同 interviewer-login（自评）；"
                        "招聘经理评估面试官时传招聘经理的 login")
    p.add_argument("--candidate-name", default="",
                   help="候选人姓名（可脱敏）")
    p.add_argument("--station-txt", default="",
                   help="岗位名 stationTxt")
    p.add_argument("--bg-txt", default="",
                   help="BG 名 bg_txt")
    p.add_argument("--interview-date", default="",
                   help="面试日期 YYYY-MM-DD（不传时用今天）")
    args = p.parse_args()

    # ---- 校验 eval-json ----
    try:
        eval_data = json.loads(args.eval_json)
    except json.JSONDecodeError as e:
        print(f"❌ eval-json 不是合法 JSON: {e}", file=sys.stderr)
        return 2
    required_keys = {"scores", "highlights", "improvements"}
    missing = required_keys - eval_data.keys()
    if missing:
        print(f"❌ eval-json 缺字段: {missing}", file=sys.stderr)
        return 2

    # ---- 决定路径 ----
    interview_date = args.interview_date or datetime.now().strftime("%Y-%m-%d")
    yyyymm = interview_date.replace("-", "")[:6]  # 202606
    target_dir = ARCHIVE_ROOT / args.interviewer_login / yyyymm
    target_dir.mkdir(parents=True, exist_ok=True)

    is_self_eval = (args.evaluator_login is None or
                    args.evaluator_login == args.interviewer_login)
    if is_self_eval:
        filename = f"{args.trace_id}.json"
    else:
        filename = f"{args.trace_id}__by-{args.evaluator_login}.json"
    target_path = target_dir / filename

    # ---- 组装持久化记录 ----
    record = {
        "schema_version": "1.0",
        "trace_id": args.trace_id,
        "interviewer_login": args.interviewer_login,
        "evaluator_login": args.evaluator_login or args.interviewer_login,
        "is_self_eval": is_self_eval,
        "candidate_name": args.candidate_name,
        "station_txt": args.station_txt,
        "bg_txt": args.bg_txt,
        "interview_date": interview_date,
        "evaluated_at": datetime.now().isoformat(timespec="seconds"),
        "scores": eval_data["scores"],          # 5 维 优/良/中/弱
        "highlights": eval_data["highlights"],  # ≥1 条
        "improvements": eval_data["improvements"],  # ≥1 条
        "behavior_norm": eval_data.get("behavior_norm", {}),  # 4 项达标
        "coverage": eval_data.get("coverage", {}),  # 维度覆盖诊断
        "metrics": eval_data.get("metrics", {}),    # bei_ratio / star_completeness / 时长 等
    }

    # ---- 写入 ----
    try:
        with target_path.open("w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
    except OSError as e:
        print(f"❌ 写入失败: {e}", file=sys.stderr)
        return 3

    print(str(target_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
