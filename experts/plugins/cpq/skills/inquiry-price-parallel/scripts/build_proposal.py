#!/usr/bin/env python3
"""把 markdown 表格机械切片成 tasks_proposal.json。

设计依据：docs/superpowers/specs/2026-06-16-p1-build-proposal.md

用途：
    把 source_table.md（来自 parse_excel.py / LLM 视觉识图 / 用户粘贴）
    按行 fan-out 成 N 个 task，每个 task.message = 表头 + 分隔行 + 该数据行
    （三行精确拼接）。

设计要点（关键工程纪律）：
    1. 直接读 markdown 文件**字节流**（Path.read_text(encoding='utf-8')），
       避免任何 shell 中转 / Python 字符串字面量 / heredoc 的转义风险。
    2. 复用 split_tasks.parse_source_table，保证两者解析一致。
    3. 输出后仍由 split_tasks.py 字符级校验把关（双层防线）。

CLI 用法：
    python3 build_proposal.py \\
        --source-table source_table.md \\
        --output       tasks_proposal.json

退出码：
    0 = 成功
    2 = 输入校验失败（文件不存在 / 表格格式错 / 无数据行 / 无写权限）
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Dict

# 让本脚本可作为 module 被测试（test_build_proposal.py）import
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from split_tasks import parse_source_table


def build_proposal(source_table_text: str,
                    common_context_suffix: str = "") -> Dict:
    """把 markdown 表格切成 tasks_proposal.json 内容。

    Args:
        source_table_text: markdown 表格全文（含表头 + 分隔行 + N 行数据）
        common_context_suffix: 公共补充信息（P2，可选）。非空时写入 proposal 顶层
            字段，由编排器在首轮发送时拼接到每个 task.message 末尾。
            ⚠️ 不会改写任何 task.message，铁律 5（message 三行精确）保留。

    Returns:
        tasks_proposal dict，schema 同主 spec §4.3 + P2 扩展：
            {"tasks": [...], "common_context_suffix"?: str}

    Raises:
        ValueError: 找不到 separator 行 / 无数据行 / 表格为空
    """
    header, separator, rows = parse_source_table(source_table_text)

    if not rows:
        raise ValueError("表格无数据行（仅有表头与分隔行）")

    tasks = []
    for i, row in enumerate(rows, start=1):
        # 三行精确拼接，与 split_tasks.build_expected_message 对齐
        message = "\n".join([header, separator, row])
        tasks.append({
            "task_id": f"task_{i:03d}",
            "source_row_index": i,
            "message": message,
        })

    proposal: Dict = {"tasks": tasks}
    # 仅在非空时写入顶层字段（避免污染向后兼容场景）
    if common_context_suffix:
        proposal["common_context_suffix"] = common_context_suffix
    return proposal


def main():
    parser = argparse.ArgumentParser(
        description="把 markdown 表格机械切片成 tasks_proposal.json（P1）",
    )
    parser.add_argument(
        "--source-table", required=True,
        help="markdown 表格文件路径（UTF-8 编码）",
    )
    parser.add_argument(
        "--output", required=True,
        help="输出 tasks_proposal.json 路径；不存在的父目录会自动创建",
    )
    parser.add_argument(
        "--common-context", default="",
        help=("公共补充信息（P2，可选）。非空时写入 proposal 顶层 "
              "common_context_suffix 字段，由编排器在首轮发送时拼接到每个 task.message 末尾。"
              "白名单见 SKILL.md 步骤 2.5：仅站点/地域/计费模式/时长/数量/币种。"
              "禁止把产品规格类内容塞进来。"),
    )
    args = parser.parse_args()

    src = Path(args.source_table).expanduser()
    if not src.exists():
        print(f"源表格文件不存在: {src}", file=sys.stderr)
        sys.exit(2)

    try:
        text = src.read_text(encoding="utf-8")
    except OSError as e:
        print(f"读取源表格失败: {e}", file=sys.stderr)
        sys.exit(2)

    if not text.strip():
        print("源表格内容为空", file=sys.stderr)
        sys.exit(2)

    try:
        proposal = build_proposal(text, common_context_suffix=args.common_context)
    except ValueError as e:
        print(f"解析源表格失败: {e}", file=sys.stderr)
        sys.exit(2)

    out = Path(args.output).expanduser()
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(proposal, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as e:
        print(f"写入输出失败: {e}", file=sys.stderr)
        sys.exit(2)

    print(f"wrote {len(proposal['tasks'])} tasks → {out}")
    sys.exit(0)


if __name__ == "__main__":
    main()
