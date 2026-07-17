#!/usr/bin/env python3
"""并发询价编排器 CLI 入口。

详细设计：docs/superpowers/specs/2026-06-16-inquiry-price-parallel-design.md
"""
import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

# 把 scripts 目录加入 sys.path，以便 import orchestrator 包
# （orchestrator/ 现在位于 scripts/orchestrator/，与本脚本同级）
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from orchestrator._cpq_delegate_gate import (
    GATE_EXIT_CODE as _CPQ_GATE_EXIT_CODE,
    CpqGateError,
    enforce as _enforce_cpq_gate,
)
from orchestrator.main_loop import run_orchestrator
from orchestrator.run_dir import read_json, read_run_lock_info


def _collect_run_summary(run_dir: Path) -> dict:
    """收集 run-dir 当前状态，包括锁信息（供 --inspect / --status 共用）。"""
    if not run_dir.exists():
        return {"error": f"run-dir 不存在: {run_dir}"}

    tasks = read_json(run_dir / "tasks.json") if (run_dir / "tasks.json").exists() else {"tasks": []}
    states = read_json(run_dir / "task_states.json") if (run_dir / "task_states.json").exists() else {}

    n = 0
    while (run_dir / f"round_{n+1}_results.json").exists():
        n += 1

    lock = read_run_lock_info(run_dir)

    # task_states 状态聚合
    state_counts: dict = {}
    for st in states.values() if isinstance(states, dict) else []:
        s = st.get("status", "pending") if isinstance(st, dict) else "pending"
        state_counts[s] = state_counts.get(s, 0) + 1

    summary_files = {}
    for fname in ("summary.md", "summary.xlsx", "pending.json"):
        p = run_dir / fname
        if p.exists():
            summary_files[fname] = str(p)

    return {
        "run_dir": str(run_dir),
        "task_count": len(tasks.get("tasks", [])),
        "completed_rounds": n,
        "task_state_counts": state_counts,
        "task_states": {
            tid: st.get("status", "pending") if isinstance(st, dict) else "pending"
            for tid, st in (states.items() if isinstance(states, dict) else [])
        } if states else {},
        "orchestrator_lock": lock,
        "output_files": summary_files,
    }


def _inspect(run_dir: Path) -> int:
    """只读查看 run-dir 当前状态，不做任何远端调用。"""
    if not run_dir.exists():
        print(f"run-dir 不存在: {run_dir}", file=sys.stderr)
        return 1
    summary = _collect_run_summary(run_dir)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def _status(run_dir: Path) -> int:
    """跨 shell 安全的状态查询入口。

    与 --inspect 的差异：
    - --inspect 为机器可读 JSON（编排器 / CI 用）
    - --status 输出**人类可读摘要 + 退出码**，供 AI / 用户在不依赖
      `kill -0 $PID` 的情况下判断"编排器是不是还活着 / 跑到哪一步了"。

    退出码：
      0  → 编排器未在运行（已结束 或 从未启动）；摘要里会说明哪种
      20 → 编排器正在运行（按摘要里的最新进度判断是否需要等）
      1  → run-dir 不存在或损坏
    """
    if not run_dir.exists():
        print(f"run-dir 不存在: {run_dir}", file=sys.stderr)
        return 1

    summary = _collect_run_summary(run_dir)
    lock = summary.get("orchestrator_lock", {})
    held = lock.get("held")
    meta = lock.get("meta", {}) or {}

    print(f"=== inquiry-price-parallel run status ===")
    print(f"run-dir            : {run_dir}")
    print(f"task_count         : {summary['task_count']}")
    print(f"completed_rounds   : {summary['completed_rounds']}")
    print(f"task_state_counts  : {summary['task_state_counts']}")
    print(f"output_files       : {summary['output_files']}")
    print()
    if held is True:
        print(f"orchestrator       : RUNNING")
        print(f"  pid              : {meta.get('pid')}")
        print(f"  hostname         : {meta.get('hostname')}")
        print(f"  started_at       : {meta.get('started_at')}")
        print(f"  python_executable: {meta.get('python_executable')}")
        print()
        print("提示：编排器还在跑。请等待它完成，或用 `kill <pid>` 中止。")
        print("不要重新启动 --tasks-file，会被锁拒绝（exit 1）。")
        return 20
    elif held is False:
        print("orchestrator       : NOT RUNNING")
        if meta:
            print(f"  上次运行 pid     : {meta.get('pid')}")
            print(f"  上次运行 host    : {meta.get('hostname')}")
            print(f"  上次运行启动时间 : {meta.get('started_at')}")
        if summary["completed_rounds"] > 0 and summary["task_state_counts"]:
            print()
            print("已有产出，可读 summary.md / summary.xlsx 查看结果。")
        else:
            print()
            print("没有完成轮次，可能上次运行被中断；可用 --resume 续跑。")
        return 0
    else:
        # held is None：Windows / 探测失败
        print("orchestrator       : UNKNOWN（无法判断锁状态，可能在 Windows）")
        print("提示：请改用进程列表或 IDE 任务面板手动确认。")
        return 0


def main():
    parser = argparse.ArgumentParser(description="并发询价编排器")

    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--tasks-file", help="任务列表 JSON（已被 split_tasks.py 校验通过）")
    g.add_argument("--resume", help="续跑：指定 run-dir，读 answers.json 推下一轮")
    g.add_argument("--inspect", help="只读查看 run-dir 当前状态（机器可读 JSON）")
    g.add_argument("--status", help=("跨 shell 安全的运行状态查询（人类可读 + 退出码）。"
                                      "退出码 0=未运行 · 20=运行中 · 1=run-dir 不存在/损坏"))

    parser.add_argument("--run-dir", help="运行目录（与 --tasks-file 一起用）")
    parser.add_argument("--concurrency", type=int, default=6, help="滑动窗口大小，默认 6")
    parser.add_argument("--per-task-timeout", type=int, default=300,
                        help=("单任务挂钟上限（秒），超过即标 timeout 终态，不再 retry。"
                              "默认 300；传 0 或负数关闭超时（等齐所有任务，旧行为）"))
    parser.add_argument("--progress-interval", type=int, default=30,
                        help=("进度心跳间隔（秒），每 N 秒输出一行 stdout 进度。"
                              "默认 30；传 0 关闭。"))
    parser.add_argument("--batch-task-ids", default="",
                        help=("【分批模式 · 2026-06-22 引入】逗号分隔的 task_id 列表，"
                              "本次只处理这个子集 ∩ (pending + exception + 已答 asking)。"
                              "未列入子集的任务保持现状（pending 仍 pending、终态仍终态）。"
                              "退出码语义：0=本批全终态 · 10=本批至少 1 个 asking。"
                              "用于解决长任务被主 agent 时长杀的问题——主 agent 把 N 行切成"
                              "每批 ≤15 行，每批一次调用，每次 exit 都是主 agent 活跃时间的"
                              "天然重置点。不传 = 老行为（处理全部未终态非 asking 行）。"
                              "summary.xlsx 始终按全量 task_states 写入（全局快照）。"
                              "与 --inspect / --status 同用时被忽略。"))

    args = parser.parse_args()

    if args.inspect:
        sys.exit(_inspect(Path(args.inspect)))

    if args.status:
        sys.exit(_status(Path(args.status)))

    # 解析 batch_task_ids：空字符串 / 全空白 → None（老行为）；否则去重保序拆成 list
    batch_task_ids: Optional[List[str]] = _parse_batch_task_ids(args.batch_task_ids)

    if args.resume:
        run_dir = Path(args.resume)
        sys.exit(run_orchestrator(
            run_dir=run_dir,
            concurrency=args.concurrency,
            per_task_timeout=args.per_task_timeout,
            resume=True,
            progress_interval=args.progress_interval,
            batch_task_ids=batch_task_ids,
        ))

    # tasks-file 模式：必须配 --run-dir
    if not args.run_dir:
        parser.error("--tasks-file 必须配合 --run-dir 使用")

    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        parser.error(f"--run-dir 不存在：{run_dir}")
    if not (run_dir / "tasks.json").exists():
        parser.error(f"{run_dir}/tasks.json 不存在；请先用 split_tasks.py 生成")

    # 子 skill 入口反向 gate：若检测到本次是被 CPQ 主流程委托调用，则强校验 A 段产物（context.md + phase1.md）。
    # 详见 orchestrator/_cpq_delegate_gate.py 文档。
    try:
        _enforce_cpq_gate(run_dir)
    except CpqGateError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(_CPQ_GATE_EXIT_CODE)

    sys.exit(run_orchestrator(
        run_dir=run_dir,
        concurrency=args.concurrency,
        per_task_timeout=args.per_task_timeout,
        resume=False,
        progress_interval=args.progress_interval,
        batch_task_ids=batch_task_ids,
    ))


def _parse_batch_task_ids(raw: str) -> Optional[List[str]]:
    """把 --batch-task-ids 的原始字符串解析成 list[str]，空 → None。

    - 空 / 全空白 → None（老行为：全量处理）
    - 非空 → 拆分 + 去除每项空白 + 丢空项 + 保留**首次出现**的顺序去重

    保序去重而不是 set()，是为了让"批次内任务先后顺序"在主 agent 角度可控
    （虽然编排器内部仍是 concurrency 滑窗并发，但 todo 列表顺序影响调度起始）。
    """
    if not raw or not raw.strip():
        return None
    seen = set()
    result: List[str] = []
    for s in raw.split(","):
        tid = s.strip()
        if not tid or tid in seen:
            continue
        seen.add(tid)
        result.append(tid)
    return result if result else None


if __name__ == "__main__":
    main()
