#!/usr/bin/env python3
"""
batch_io.py

轻量批量输入归一化：只读取 JSON / Markdown / 已由兄弟 Office/PDF skills 抽取出的结构化文本。
Excel / PDF / DOCX 原文件解析由 cpq plugin 内的 xlsx-manipulation / pdf-extraction /
docx-manipulation 负责，避免 cloud-mapping 自带重型解析依赖。

用法:
  python3 batch_io.py <file.json|file.md>

JSON 交接契约:
  [{
    "input": "原始规格文本",
    "hint": "spec|four_level|product_lib_name",
    "row": 2,
    "sheet": "ECS",
    "page": 1,
    "bbox": { "x": 10, "y": 20, "width": 100, "height": 30, "unit": "pt", "origin": "top-left" },
    "format": "excel|pdf|docx|json|markdown",
    "source": "xlsx-manipulation|pdf-extraction|docx-manipulation|batch_io"
  }]
"""

import json
import os
import sys

VALID_HINTS = {"spec", "four_level", "product_lib_name"}
TEXT_BLOCK_MAX_CHARS = 4000
OFFICE_SOURCE_BY_EXT = {
    ".xlsx": "xlsx-manipulation",
    ".xls": "xlsx-manipulation",
    ".pdf": "pdf-extraction",
    ".docx": "docx-manipulation",
}


def _as_non_empty_string(*values) -> str:
    for v in values:
        if v is None:
            continue
        text = str(v).strip()
        if text:
            return text
    return ""


def _normalize_positive_number(value):
    try:
        n = float(value)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _normalize_number(value):
    try:
        n = float(value)
        return n
    except (TypeError, ValueError):
        return None


def _normalize_bbox(value, page=None):
    if not isinstance(value, dict):
        return None
    x = _normalize_number(value.get("x") or value.get("x0"))
    y = _normalize_number(value.get("y") or value.get("top") or value.get("y0"))
    w_raw = value.get("width")
    if w_raw is None:
        x1 = _normalize_number(value.get("x1"))
        w_raw = (x1 - x) if x1 is not None and x is not None else None
    width = _normalize_positive_number(w_raw)
    h_raw = value.get("height")
    if h_raw is None:
        bottom = _normalize_number(value.get("bottom"))
        h_raw = (bottom - y) if bottom is not None and y is not None else None
    height = _normalize_positive_number(h_raw)
    if any(v is None for v in (x, y, width, height)):
        return None
    bbox = {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "unit": "px" if value.get("unit") == "px" else "pt",
        "origin": "bottom-left" if value.get("origin") == "bottom-left" else "top-left",
    }
    bbox_page = _normalize_positive_number(value.get("page") or page)
    if bbox_page is not None:
        bbox["page"] = int(bbox_page)
    return bbox


def _pick_array_payload(data, file_path: str) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "rows", "records", "data"):
            if isinstance(data.get(key), list):
                return data[key]
    raise ValueError(
        f"JSON 批量输入必须是数组，或包含 items/rows/records/data 数组: {file_path}"
    )


def _normalize_batch_item(row, idx: int, default_format: str = "json"):
    if isinstance(row, str):
        text = row.strip()
        return {"input": text, "row": idx + 1, "format": default_format, "source": "batch_io"} if text else None
    if not isinstance(row, dict):
        return None

    input_text = _as_non_empty_string(
        row.get("input"), row.get("text"), row.get("content"), row.get("spec"), row.get("value")
    )
    if not input_text:
        return None

    item = {
        "input": input_text,
        "row": int(_normalize_positive_number(row.get("row") or row.get("rowIndex") or row.get("line")) or (idx + 1)),
        "format": _as_non_empty_string(row.get("format"), default_format),
        "source": _as_non_empty_string(row.get("source"), "batch_io"),
    }

    hint = row.get("hint")
    if hint in VALID_HINTS:
        item["hint"] = hint

    sheet = _as_non_empty_string(row.get("sheet"), row.get("sheetName"), row.get("worksheet"))
    if sheet:
        item["sheet"] = sheet

    page = _normalize_positive_number(row.get("page"))
    if page is not None:
        item["page"] = int(page)

    bbox = _normalize_bbox(row.get("bbox"), page)
    if bbox:
        item["bbox"] = bbox

    return item


def _split_text_blocks(text: str, fmt: str) -> list:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = []
    current = []
    start_line = 1
    chars = 0

    def flush():
        nonlocal current, chars
        content = "\n".join(current).strip()
        if content:
            blocks.append({"input": content, "row": start_line, "format": fmt, "source": "batch_io"})
        current = []
        chars = 0

    for i, line in enumerate(normalized.split("\n")):
        if not line.strip():
            flush()
            start_line = i + 2
            continue
        if not current:
            start_line = i + 1
        current.append(line)
        chars += len(line) + 1
        if chars >= TEXT_BLOCK_MAX_CHARS:
            flush()
            start_line = i + 2

    flush()
    return blocks


def _check_unsupported_office(file_path: str):
    ext = os.path.splitext(file_path)[1].lower()
    skill = OFFICE_SOURCE_BY_EXT.get(ext)
    if skill:
        raise ValueError(
            f"cloud-mapping 不再直接解析 {ext} 原文件；"
            f"请先使用 {skill} 抽取规格相关文本/表格，保存为 JSON 或 Markdown 后再运行 batch_io.py"
        )


def read_json_batch(file_path: str) -> list:
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    rows = _pick_array_payload(data, file_path)
    return [item for item in ((_normalize_batch_item(r, i, "json") for i, r in enumerate(rows))) if item]


def read_markdown_batch(file_path: str) -> list:
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
    return _split_text_blocks(text, "markdown")


def read_batch(file_path: str) -> list:
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".json":
        return read_json_batch(file_path)
    if ext in (".md", ".markdown"):
        return read_markdown_batch(file_path)
    _check_unsupported_office(file_path)
    raise ValueError(f"不支持的批量输入格式: {ext or '<none>'}；仅支持 .json / .md / .markdown")


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(0)
    file_path = sys.argv[1]
    result = read_batch(file_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
