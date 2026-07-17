#!/usr/bin/env python3
"""校验 LLM 写出的 tasks.json 提案，规范化后落盘。

设计依据：docs/superpowers/specs/2026-06-16-inquiry-price-parallel-design.md §4
"""
import re

# 仅匹配 markdown 表格分隔行的"形态空白差异"（: 和空格），
# 不影响普通行的字符
_SEPARATOR_LINE_RE = re.compile(r"^\s*\|?\s*(:?-+:?\s*\|\s*)+:?-+:?\s*\|?\s*$")


def normalize_for_compare(text: str) -> str:
    """规范化文本用于比对。

    - 统一换行：\r\n / \r → \n
    - 每行首尾去空白
    - 行内连续空白合并为单个空格
    - markdown 表格分隔行（仅含 -, :, |, 空白）规范化为统一形态
    - 不改单元格内容（数据行不被特别处理，普通规则就够）

    NOTE: 单元格内容内的连续空白会被压成一个，这一行为对询价场景安全
    （远端 agent 不会因为多一个空格而改变结果）。
    """
    # 1) 换行符统一
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    out_lines = []
    for line in text.split("\n"):
        line = line.strip()
        if _SEPARATOR_LINE_RE.match(line):
            # 分隔行：抽出列数，统一输出 | --- | --- | ... |
            cols = [c for c in line.split("|") if c.strip()]
            out_lines.append("| " + " | ".join(["---"] * len(cols)) + " |")
        else:
            # 普通行：连续空白合并为单空格
            line = re.sub(r"\s+", " ", line)
            out_lines.append(line)

    return "\n".join(out_lines)


def parse_source_table(text: str) -> tuple[str, str, list[str]]:
    """把原 markdown 表格拆成 header / separator / rows。

    Returns:
        (header_line, separator_line, list_of_data_rows)
        所有元素都是去掉首尾空白的原文（保留单元格内容）

    Raises:
        ValueError: 找不到表格分隔行
    """
    lines = [ln for ln in text.replace("\r\n", "\n").split("\n") if ln.strip()]
    if not lines:
        raise ValueError("空表格")

    # 找到第一个分隔行
    sep_idx = None
    for i, ln in enumerate(lines):
        if _SEPARATOR_LINE_RE.match(ln.strip()):
            sep_idx = i
            break
    if sep_idx is None or sep_idx == 0:
        raise ValueError("找不到 markdown 表格 separator 行")

    header = lines[sep_idx - 1].strip()
    separator = lines[sep_idx].strip()
    rows = [ln.strip() for ln in lines[sep_idx + 1:] if ln.strip()]
    return header, separator, rows


def build_expected_message(header: str, separator: str, rows: list, source_row_index: int) -> str:
    """按 (header, separator, rows[source_row_index-1]) 机械拼接。

    source_row_index 是 1-based。
    """
    if source_row_index < 1:
        raise ValueError("source_row_index 必须 >= 1")
    if source_row_index > len(rows):
        raise IndexError(f"source_row_index {source_row_index} 超出范围（共 {len(rows)} 行）")
    return "\n".join([header, separator, rows[source_row_index - 1]])


_TASK_ID_RE = re.compile(r"^task_(\d{3})$")


class ValidationError(Exception):
    pass


def validate_tasks_proposal(proposal: dict, source_table_text: str) -> None:
    """对 LLM 写的 tasks 提案做硬性校验。违反任一条抛 ValidationError。"""
    tasks = proposal.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValidationError("tasks 字段必须是非空列表")

    header, separator, rows = parse_source_table(source_table_text)

    if len(tasks) != len(rows):
        raise ValidationError(
            f"task_count 与原表数据行数不一致：tasks={len(tasks)}, rows={len(rows)}"
        )

    seen_indices = set()
    expected_seq = 1

    for t in tasks:
        tid = t.get("task_id", "")
        sri = t.get("source_row_index")
        msg = t.get("message", "")

        m = _TASK_ID_RE.match(tid)
        if not m:
            raise ValidationError(f"task_id 格式非法：{tid}（必须为 task_NNN，3 位 0 padding）")
        seq = int(m.group(1))
        if seq != expected_seq:
            raise ValidationError(
                f"task_id 必须严格升序：期望 task_{expected_seq:03d}，实际 {tid}"
            )
        expected_seq += 1

        if not isinstance(sri, int) or sri < 1 or sri > len(rows):
            raise ValidationError(f"task_id={tid} 的 source_row_index 越界：{sri}")
        if sri in seen_indices:
            raise ValidationError(f"task_id={tid} 的 source_row_index 重复：{sri}")
        seen_indices.add(sri)

        expected = build_expected_message(header, separator, rows, sri)
        if normalize_for_compare(msg) != normalize_for_compare(expected):
            raise ValidationError(
                f"task_id={tid} 的 message 规范化后不等于原表第 {sri} 行重建结果。\n"
                f"--- expected (规范化后) ---\n{normalize_for_compare(expected)}\n"
                f"--- got (规范化后) ---\n{normalize_for_compare(msg)}"
            )

    if seen_indices != set(range(1, len(rows) + 1)):
        missing = set(range(1, len(rows) + 1)) - seen_indices
        raise ValidationError(f"source_row_index 未覆盖完整：缺少 {sorted(missing)}")


import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description="校验 LLM 写的 tasks 提案并落盘")
    parser.add_argument("--tasks-json-file", required=True)
    parser.add_argument("--source-table-file", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--concurrency-threshold", type=int, default=3)

    args = parser.parse_args()

    try:
        proposal = json.loads(Path(args.tasks_json_file).read_text(encoding="utf-8"))
    except Exception as e:
        print(f"无法读取 tasks-json-file: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        source_text = Path(args.source_table_file).read_text(encoding="utf-8")
    except Exception as e:
        print(f"无法读取 source-table-file: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        validate_tasks_proposal(proposal, source_text)
    except (ValidationError, ValueError) as e:
        print(f"tasks 提案校验失败：\n{e}", file=sys.stderr)
        sys.exit(2)

    run_dir = Path(args.run_dir).expanduser()
    run_dir.mkdir(parents=True, exist_ok=True)

    tasks_file = run_dir / "tasks.json"
    _atomic_write_json(tasks_file, proposal)

    task_count = len(proposal["tasks"])
    should_parallel = task_count >= args.concurrency_threshold

    config = {
        "task_count": task_count,
        "concurrency_threshold": args.concurrency_threshold,
        "should_parallel": should_parallel,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "current_round": 0,
    }
    _atomic_write_json(run_dir / "config.json", config)

    output = {
        "task_count": task_count,
        "should_parallel": should_parallel,
        "tasks_file": str(tasks_file),
        "run_dir": str(run_dir),
        "concurrency_threshold": args.concurrency_threshold,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
