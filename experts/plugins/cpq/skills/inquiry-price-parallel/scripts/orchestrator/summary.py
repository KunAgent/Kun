"""summary.xlsx + summary.md 生成（spec §8）。

机械拼接；`remote_price` 列原样搬运远端 [价格] 段（task_state.price_info），
本地零解析 / 零换算 / 零推算（铁律 6 改造版：值与单位以远端返回为准）。
"""
import os
import re
from pathlib import Path
from typing import Dict, List

import openpyxl

EXCERPT_LEN = 200

_BUILT_IN_COLS = [
    "task_id", "status", "rounds_taken", "conversation_id",
    "download_links", "remote_price", "four_layer",
    "last_round_answer_excerpt", "last_round_error",
]


def _parse_header_cells(header_row: str) -> List[str]:
    """从 markdown 表头行抽出列名。"""
    parts = [p.strip() for p in header_row.split("|")]
    return [p for p in parts if p]


def _parse_row_cells(row_md: str) -> List[str]:
    """从 markdown 数据行抽出单元格。"""
    parts = [p.strip() for p in row_md.split("|")]
    return [p for p in parts if p]


def _row_data_from_message(message: str) -> List[str]:
    """从 message（含 header+sep+row）中抽出数据行的单元格。

    message 格式：3 行 markdown（header / separator / data row）。
    """
    lines = [ln for ln in message.split("\n") if ln.strip()]
    if len(lines) < 3:
        return []
    return _parse_row_cells(lines[2])


def write_summary_xlsx(path: Path, tasks: Dict, task_states: Dict) -> None:
    """写 summary.xlsx（原子）。"""
    src_cols = _parse_header_cells(tasks.get("header_row", ""))
    headers = list(src_cols) + list(_BUILT_IN_COLS)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)

    for t in tasks.get("tasks", []):
        tid = t["task_id"]
        row_cells = _row_data_from_message(t.get("message", ""))
        if len(row_cells) < len(src_cols):
            row_cells = row_cells + [""] * (len(src_cols) - len(row_cells))
        elif len(row_cells) > len(src_cols):
            row_cells = row_cells[:len(src_cols)]

        st = task_states.get(tid, {})
        download_links = st.get("download_links") or []
        links_str = "\n".join(
            (link.get("url", "") if isinstance(link, dict) else str(link))
            for link in download_links
        )
        excerpt = (st.get("last_round_answer") or "")[:EXCERPT_LEN]

        builtin = [
            tid,
            st.get("status", "pending"),
            st.get("rounds_taken", 0),
            st.get("conversation_id", ""),
            links_str,
            st.get("price_info", ""),  # 远端 [价格] 段原样搬运，零本地加工
            st.get("four_layer", ""),  # 远端 [四层] 段原样搬运，供 CPQ 选品复用
            excerpt,
            st.get("last_round_error", ""),
        ]
        ws.append(list(row_cells) + builtin)

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    wb.save(tmp)
    os.replace(tmp, path)


def write_summary_md(path: Path, run_id: str, tasks: Dict, task_states: Dict,
                     current_round: int) -> None:
    """写 summary.md（原子）。"""
    lines = []
    lines.append(f"# 询价 Run: {run_id}\n")
    lines.append(f"- 总任务数: {len(tasks.get('tasks', []))}")
    lines.append(f"- 当前轮次: {current_round}")
    statuses = [task_states.get(t["task_id"], {}).get("status", "pending")
                for t in tasks.get("tasks", [])]
    # 完成态集合包含 timeout（P0 spec §7.3 + conclusion-protocol）
    if all(s in ("concluded", "failed", "aborted_by_user", "timeout") for s in statuses) and statuses:
        lines.append(f"- 状态: 已完成")
    else:
        lines.append(f"- 状态: 进行中")
    lines.append("")
    lines.append("## 任务概览\n")
    lines.append("| task_id | 原表行 | 状态 | 轮次 | 下载链接 |")
    lines.append("|---|---|---|---|---|")
    for t in tasks.get("tasks", []):
        tid = t["task_id"]
        st = task_states.get(tid, {})
        links = st.get("download_links") or []
        link_str = ", ".join(
            (l.get("file_name", "") if isinstance(l, dict) else str(l))
            for l in links
        ) or "—"
        lines.append(
            f"| {tid} | {t.get('source_row_index')} | "
            f"{st.get('status', 'pending')} | {st.get('rounds_taken', 0)} | {link_str} |"
        )

    lines.append("")
    lines.append("## 已完成任务的下载链接\n")
    for t in tasks.get("tasks", []):
        tid = t["task_id"]
        st = task_states.get(tid, {})
        if st.get("status") != "concluded":
            continue
        for link in st.get("download_links") or []:
            url = link.get("url", "") if isinstance(link, dict) else str(link)
            if url:
                lines.append(f"- {tid}: {url}")

    text = "\n".join(lines) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
