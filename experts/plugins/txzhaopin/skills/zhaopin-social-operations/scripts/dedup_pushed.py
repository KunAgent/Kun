#!/usr/bin/env python3
"""
跨天去重 — 已推送名单差集过滤（v1.0 · 2026-06-17）

解决的问题：
  定时简历搜索任务每天跑同样的搜索条件，搜出来的候选人池高度重叠，
  导致「每天推送的简历几乎一样」。搜索 skill 本身只做「单次任务内 rid 去重」，
  不负责「今天别推昨天那批人」。本脚本在推送前做一层持久化的「已推名单差集」。

设计（与用户确认的口径一致）：
  - **按任务 ID 隔离**：每个定时任务一份已推名单（--task-key 区分），
    社招任务和校招任务各推各的，互不干扰。
  - **滚动 N 天窗口**：默认 30 天，只记最近 N 天推过的 rid，超期自动过期、可再次推送
    （和搜索接口 viewedDays 的窗口语义一致：既不漏新人，又给老候选人复推机会）。
  - **差集过滤**：本次候选 rid 减去「窗口内已推 rid」= 今日真正新增，只推新增。
  - **无新增时**：返回 new_count=0，由 agent 推「今日无新增」说明（不静默）。

用法：
  # 过滤 + 回写（默认行为）
  python3 dedup_pushed.py \
      --task-key social-daily-system-planning \
      --input candidates.jsonl \
      --output new_candidates.jsonl

  # 只看差集、先不回写（dry-run，用于预览今天有几个新人）
  python3 dedup_pushed.py --task-key xxx --input c.jsonl --dry-run

存储：
  已推名单落在用户级目录（跨 workspace 共享，定时任务在任意 cwd 跑都能命中）：
    ~/.workbuddy/skills/txzhaopin-pushed-history/<task-key>.json
  结构：{"window_days": 30, "pushed": {"<rid>": <epoch_seconds>, ...}}

stdout 输出 JSON 摘要（供 agent 读取）：
  {"status":"ok","task_key":"...","input_total":N,"already_pushed":M,
   "new_count":K,"output_file":"...","window_days":30,"wrote_history":true}

退出码：0 正常（含 new_count=0）；2 参数/IO 错误。
"""

import argparse
import json
import os
import sys
import time

HISTORY_ROOT = os.path.expanduser("~/.workbuddy/skills/txzhaopin-pushed-history")
DEFAULT_WINDOW_DAYS = 30


def _read_rids_from_jsonl(path: str) -> list:
    """从候选 JSONL 读 rid，保持原始顺序、去重。兼容 rid / Rid 两种字段名。
    跳过首行可能存在的 _meta 行（不含 rid 的行天然被跳过）。"""
    if not os.path.exists(path):
        print(f"ERROR: --input 文件不存在: {path}", file=sys.stderr)
        sys.exit(2)
    rids = []
    seen = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            rid = obj.get("rid") or obj.get("Rid") or ""
            if rid and rid not in seen:
                seen.add(rid)
                rids.append((rid, obj))
    return rids


def _load_history(task_key: str) -> dict:
    path = os.path.join(HISTORY_ROOT, f"{task_key}.json")
    if not os.path.exists(path):
        return {"window_days": DEFAULT_WINDOW_DAYS, "pushed": {}}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "pushed" not in data:
            return {"window_days": DEFAULT_WINDOW_DAYS, "pushed": {}}
        return data
    except (json.JSONDecodeError, OSError):
        # 历史文件损坏 → 当作空名单，不阻断主流程（宁可重复推一次，也不报错卡住）
        print(f"[warn] 历史名单损坏，按空名单处理: {path}", file=sys.stderr)
        return {"window_days": DEFAULT_WINDOW_DAYS, "pushed": {}}


def _save_history(task_key: str, data: dict) -> bool:
    os.makedirs(HISTORY_ROOT, exist_ok=True)
    path = os.path.join(HISTORY_ROOT, f"{task_key}.json")
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
        return True
    except OSError as e:
        print(f"[warn] 写入历史名单失败（不阻断推送）: {e}", file=sys.stderr)
        return False


def _prune_expired(pushed: dict, window_days: int, now: int) -> dict:
    """剔除超出滚动窗口的 rid。
    window_days<=0 视为「不保留任何历史」→ 全部过期（等价于关闭跨天去重）。"""
    if window_days <= 0:
        return {}
    cutoff = now - window_days * 86400
    return {rid: ts for rid, ts in pushed.items()
            if isinstance(ts, (int, float)) and ts >= cutoff}


def main():
    ap = argparse.ArgumentParser(description="跨天去重：已推名单差集过滤")
    ap.add_argument("--task-key", required=True,
                    help="任务隔离 key（建议用 automation_id 或稳定任务别名，如 social-daily-system-planning）")
    ap.add_argument("--input", required=True, help="本次候选 JSONL（含 rid）")
    ap.add_argument("--output", "-o", default="new_candidates.jsonl",
                    help="差集后的新增候选 JSONL（默认 new_candidates.jsonl，落当前 cwd）")
    ap.add_argument("--window-days", type=int, default=None,
                    help=f"滚动去重窗口天数（不传则沿用历史名单记录值，新名单默认 {DEFAULT_WINDOW_DAYS}）")
    ap.add_argument("--dry-run", action="store_true",
                    help="只算差集、输出新增 JSONL，但不回写历史名单（预览用）")
    args = ap.parse_args()

    now = int(time.time())
    output_path = os.path.abspath(args.output)

    rid_objs = _read_rids_from_jsonl(args.input)
    input_total = len(rid_objs)

    hist = _load_history(args.task_key)
    # 优先用命令行显式值（含 0）；未传则沿用历史记录值；都没有用默认。
    if args.window_days is not None:
        window_days = args.window_days
    else:
        window_days = hist.get("window_days", DEFAULT_WINDOW_DAYS)
    pushed = _prune_expired(hist.get("pushed", {}), window_days, now)

    # 差集：本次候选里、窗口内没推过的 = 今日新增
    new_objs = [(rid, obj) for rid, obj in rid_objs if rid not in pushed]
    already = input_total - len(new_objs)

    # 写新增名单（即使为 0 也写一个空文件，方便 agent 统一读取）
    with open(output_path, "w", encoding="utf-8") as f:
        for _, obj in new_objs:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    wrote_history = False
    if not args.dry_run and new_objs:
        for rid, _ in new_objs:
            pushed[rid] = now
        hist["pushed"] = pushed
        hist["window_days"] = window_days
        wrote_history = _save_history(args.task_key, hist)

    summary = {
        "status": "ok",
        "task_key": args.task_key,
        "input_total": input_total,
        "already_pushed": already,
        "new_count": len(new_objs),
        "output_file": output_path,
        "window_days": window_days,
        "wrote_history": wrote_history,
        "dry_run": bool(args.dry_run),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
