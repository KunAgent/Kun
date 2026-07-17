#!/usr/bin/env python3
"""
将 Excel 配置清单解析为文本格式，用于传入 knot 智能体。

使用方式:
    python parse_excel.py --file /path/to/配置清单.xlsx
    python parse_excel.py --file /path/to/配置清单.xlsx --format markdown
    python parse_excel.py --file /path/to/配置清单.xlsx --format json

输出到 stdout，可直接管道传给 call_knot_agent.py。

依赖:
    pip install openpyxl
"""

import argparse
import json
import sys

try:
    import openpyxl
except ImportError:
    print("错误: 需要安装 openpyxl。请执行: pip install openpyxl", file=sys.stderr)
    sys.exit(1)


def parse_excel(file_path: str, sheet_name: str = None) -> list[dict]:
    """
    解析 Excel 文件为结构化数据。

    Args:
        file_path: Excel 文件路径
        sheet_name: 指定 sheet 名称（默认取第一个）

    Returns:
        list[dict]: 每行数据作为一个字典，key 为表头列名
    """
    wb = openpyxl.load_workbook(file_path, data_only=True)

    if sheet_name:
        ws = wb[sheet_name]
    else:
        ws = wb.active

    rows = list(ws.iter_rows(values_only=True))

    if not rows:
        return []

    # 第一行作为表头
    headers = [str(h).strip() if h is not None else f"列{i+1}" for i, h in enumerate(rows[0])]

    # 解析数据行（跳过全空行）
    data = []
    for row in rows[1:]:
        if all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        row_dict = {}
        for i, cell in enumerate(row):
            if i < len(headers):
                row_dict[headers[i]] = str(cell).strip() if cell is not None else ""
        data.append(row_dict)

    return data


def format_as_markdown(data: list[dict]) -> str:
    """将解析结果格式化为 Markdown 表格。"""
    if not data:
        return "（空表格）"

    headers = list(data[0].keys())

    # 构建表头
    lines = []
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

    # 构建数据行
    for row in data:
        cells = [row.get(h, "") for h in headers]
        lines.append("| " + " | ".join(cells) + " |")

    return "\n".join(lines)


def format_as_json(data: list[dict]) -> str:
    """将解析结果格式化为 JSON。"""
    return json.dumps(data, ensure_ascii=False, indent=2)


def format_as_text(data: list[dict]) -> str:
    """将解析结果格式化为逐行描述的纯文本。"""
    if not data:
        return "（空表格）"

    lines = []
    for i, row in enumerate(data, 1):
        parts = []
        for k, v in row.items():
            if v:  # 跳过空值
                parts.append(f"{k}: {v}")
        lines.append(f"第{i}行: {', '.join(parts)}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="将 Excel 配置清单解析为文本格式")
    parser.add_argument("--file", "-f", required=True, help="Excel 文件路径")
    parser.add_argument("--sheet", "-s", default=None, help="Sheet 名称（默认取第一个）")
    parser.add_argument(
        "--format", choices=["markdown", "json", "text"], default="markdown",
        help="输出格式: markdown（默认）、json、text"
    )

    args = parser.parse_args()

    # 解析 Excel
    try:
        data = parse_excel(args.file, args.sheet)
    except FileNotFoundError:
        print(f"错误: 文件不存在: {args.file}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误: 解析 Excel 失败: {e}", file=sys.stderr)
        sys.exit(1)

    if not data:
        print("警告: 未解析到任何数据行", file=sys.stderr)
        sys.exit(0)

    # 格式化输出
    if args.format == "markdown":
        output = format_as_markdown(data)
    elif args.format == "json":
        output = format_as_json(data)
    else:
        output = format_as_text(data)

    print(output)


if __name__ == "__main__":
    main()
