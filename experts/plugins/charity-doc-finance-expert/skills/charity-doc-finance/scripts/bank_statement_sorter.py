#!/usr/bin/env python3
"""
银行流水自动分类整理脚本
读取银行导出的 Excel/CSV 流水，自动分类为收入/支出，
标记大额交易和疑似捐赠，生成分类汇总表。

用法:
    python bank_statement_sorter.py <银行流水文件> [--output <输出文件路径>]

支持格式: .xlsx, .xls, .csv

依赖:
    - Python >= 3.8（无需 3.10+ 特性，兼容 3.8~3.14）
    - openpyxl (Excel 支持)   pip install openpyxl
"""

import sys
import os
import csv
import re
from datetime import datetime
from pathlib import Path
from collections import defaultdict

# 尝试导入 openpyxl，不强制依赖
try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False


# ============================================================
# 配置
# ============================================================

# 收入关键词（用于识别捐赠收入）
DONATION_KEYWORDS = [
    "捐赠", "捐款", "donation", "善款", "爱心",
    "月捐", "一次性捐", "配捐", "公益", "99公益",
]

GRANT_KEYWORDS = [
    "拨款", "补助", "政府", "财政", "购买服务",
]

# 支出关键词分类
EXPENSE_CATEGORIES = {
    "人员费用": ["工资", "薪酬", "社保", "公积金", "个税", "劳务费", "讲师费"],
    "项目活动": ["活动", "项目", "培训", "志愿", "走访", "调研"],
    "办公行政": ["房租", "物业", "水电", "办公", "快递", "打印", "文具"],
    "差旅交通": ["差旅", "交通", "机票", "火车", "住宿", "出租", "打车"],
    "通讯网络": ["电话", "网络", "宽带", "通讯"],
    "设备采购": ["电脑", "设备", "打印机", "家具"],
}

# 大额交易阈值
LARGE_AMOUNT_THRESHOLD = 50000  # 5万元以上标记为大额


# ============================================================
# 文件读取
# ============================================================

def read_csv_file(file_path):
    """读取 CSV 银行流水"""
    rows = []
    encodings = ["utf-8-sig", "utf-8", "gbk", "gb2312", "gb18030"]

    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc) as f:
                # 跳过可能的空行和标题行
                content = f.read()
                lines = [l for l in content.strip().split("\n") if l.strip()]

                if not lines:
                    continue

                reader = csv.reader(lines)
                for row in reader:
                    if row and any(cell.strip() for cell in row):
                        rows.append([cell.strip() for cell in row])
                break
        except (UnicodeDecodeError, UnicodeError):
            continue

    return rows


def read_excel_file(file_path):
    """读取 Excel 银行流水"""
    if not HAS_OPENPYXL:
        print("⚠️ 需要安装 openpyxl 来读取 Excel 文件:")
        print("   pip install openpyxl")
        sys.exit(1)

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active
    rows = []
    for row in ws.iter_rows(values_only=True):
        if row and any(cell is not None for cell in row):
            rows.append([str(cell) if cell is not None else "" for cell in row])
    wb.close()
    return rows


def read_file(file_path):
    """根据文件类型选择读取方式"""
    ext = Path(file_path).suffix.lower()
    if ext == ".csv":
        return read_csv_file(file_path)
    elif ext in (".xlsx", ".xls"):
        return read_excel_file(file_path)
    else:
        print(f"❌ 不支持的文件格式: {ext}")
        sys.exit(1)


# ============================================================
# 智能列识别
# ============================================================

def identify_columns(header_row):
    """智能识别列含义"""
    col_map = {
        "date": None,
        "description": None,
        "income": None,
        "expense": None,
        "amount": None,
        "balance": None,
        "counterparty": None,
    }

    date_keywords = ["日期", "交易日期", "记账日期", "date", "时间"]
    desc_keywords = ["摘要", "备注", "用途", "附言", "说明", "description", "memo"]
    income_keywords = ["贷方", "收入", "贷方金额", "转入", "credit"]
    expense_keywords = ["借方", "支出", "借方金额", "转出", "debit"]
    amount_keywords = ["金额", "交易金额", "发生额", "amount"]
    balance_keywords = ["余额", "账户余额", "balance"]
    party_keywords = ["对方", "对方户名", "交易对方", "counterparty", "对方名称"]

    for i, col in enumerate(header_row):
        col_lower = col.lower().strip()
        if any(k in col_lower for k in date_keywords) and col_map["date"] is None:
            col_map["date"] = i
        elif any(k in col_lower for k in party_keywords) and col_map["counterparty"] is None:
            col_map["counterparty"] = i
        elif any(k in col_lower for k in desc_keywords) and col_map["description"] is None:
            col_map["description"] = i
        elif any(k in col_lower for k in income_keywords) and col_map["income"] is None:
            col_map["income"] = i
        elif any(k in col_lower for k in expense_keywords) and col_map["expense"] is None:
            col_map["expense"] = i
        elif any(k in col_lower for k in amount_keywords) and col_map["amount"] is None:
            col_map["amount"] = i
        elif any(k in col_lower for k in balance_keywords) and col_map["balance"] is None:
            col_map["balance"] = i

    return col_map


# ============================================================
# 交易分类
# ============================================================

def parse_amount(value):
    """解析金额字符串为浮点数"""
    if not value or value == "None":
        return 0.0
    # 去除千分位逗号、空格、货币符号
    cleaned = re.sub(r"[,，\s¥￥$]", "", str(value))
    # 处理括号表示负数
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def classify_transaction(description, counterparty=""):
    """根据摘要和对方户名分类交易"""
    text = f"{description} {counterparty}".lower()

    # 检查是否为捐赠收入
    for kw in DONATION_KEYWORDS:
        if kw in text:
            return "捐赠收入", "捐赠收入"

    # 检查是否为政府补助
    for kw in GRANT_KEYWORDS:
        if kw in text:
            return "政府补助收入", "政府补助收入"

    # 检查支出类别
    for category, keywords in EXPENSE_CATEGORIES.items():
        for kw in keywords:
            if kw in text:
                return "支出", category

    return "待分类", "待分类"


# ============================================================
# 处理与输出
# ============================================================

def process_transactions(rows, col_map):
    """处理所有交易记录"""
    results = []

    # 从第二行开始（跳过表头）
    for row_idx, row in enumerate(rows[1:], start=2):
        if len(row) <= max(v for v in col_map.values() if v is not None):
            continue

        # 提取各字段
        date_str = row[col_map["date"]] if col_map["date"] is not None else ""
        description = row[col_map["description"]] if col_map["description"] is not None else ""
        counterparty = row[col_map["counterparty"]] if col_map["counterparty"] is not None else ""

        # 解析金额
        income_amt = 0.0
        expense_amt = 0.0

        if col_map["income"] is not None and col_map["expense"] is not None:
            income_amt = parse_amount(row[col_map["income"]])
            expense_amt = parse_amount(row[col_map["expense"]])
        elif col_map["amount"] is not None:
            amt = parse_amount(row[col_map["amount"]])
            if amt > 0:
                income_amt = amt
            else:
                expense_amt = abs(amt)

        # 跳过金额为0的行
        if income_amt == 0 and expense_amt == 0:
            continue

        # 判断收支方向
        if income_amt > 0:
            direction = "收入"
            amount = income_amt
        else:
            direction = "支出"
            amount = expense_amt

        # 自动分类
        trans_type, sub_category = classify_transaction(description, counterparty)

        # 标记大额
        is_large = amount >= LARGE_AMOUNT_THRESHOLD

        results.append({
            "行号": row_idx,
            "日期": date_str,
            "收支方向": direction,
            "金额": amount,
            "对方名称": counterparty,
            "摘要": description,
            "自动分类": trans_type,
            "科目建议": sub_category,
            "大额标记": "⚠️大额" if is_large else "",
            "状态": "待确认",
        })

    return results


def generate_output(results, output_path):
    """生成分类汇总CSV"""
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        fieldnames = [
            "行号", "日期", "收支方向", "金额", "对方名称", "摘要",
            "自动分类", "科目建议", "大额标记", "状态"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow(r)


def print_summary(results):
    """打印汇总统计"""
    total_income = sum(r["金额"] for r in results if r["收支方向"] == "收入")
    total_expense = sum(r["金额"] for r in results if r["收支方向"] == "支出")
    income_count = sum(1 for r in results if r["收支方向"] == "收入")
    expense_count = sum(1 for r in results if r["收支方向"] == "支出")
    large_count = sum(1 for r in results if r["大额标记"])
    unclassified = sum(1 for r in results if r["自动分类"] == "待分类")

    # 按分类统计
    by_category = defaultdict(lambda: {"count": 0, "amount": 0})
    for r in results:
        key = f"{r['收支方向']}-{r['自动分类']}"
        by_category[key]["count"] += 1
        by_category[key]["amount"] += r["金额"]

    print()
    print("📊 流水分析汇总:")
    print(f"   收入: {income_count} 笔, 合计 {total_income:,.2f} 元")
    print(f"   支出: {expense_count} 笔, 合计 {total_expense:,.2f} 元")
    print(f"   大额交易: {large_count} 笔 (≥{LARGE_AMOUNT_THRESHOLD:,}元)")
    print(f"   待人工分类: {unclassified} 笔")
    print()
    print("   分类明细:")
    for key in sorted(by_category.keys()):
        info = by_category[key]
        print(f"     {key}: {info['count']}笔, {info['amount']:,.2f}元")

    # 检测疑似捐赠
    donations = [r for r in results if r["自动分类"] == "捐赠收入"]
    if donations:
        print()
        print(f"   💰 疑似捐赠收入: {len(donations)} 笔, 合计 {sum(d['金额'] for d in donations):,.2f} 元")
        print("      请核对是否均已开具捐赠票据")


# ============================================================
# 主流程
# ============================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="银行流水自动分类整理工具")
    parser.add_argument("file", help="银行流水文件路径（Excel 或 CSV）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认: 原文件名_分类整理.csv）")

    args = parser.parse_args()

    file_path = args.file
    if not os.path.exists(file_path):
        print(f"❌ 文件不存在: {file_path}")
        sys.exit(1)

    if not args.output:
        stem = Path(file_path).stem
        output_path = str(Path(file_path).parent / f"{stem}_分类整理.csv")
    else:
        output_path = args.output

    print("=" * 60)
    print("🏦 银行流水自动分类整理工具")
    print("=" * 60)
    print(f"📄 输入文件: {file_path}")

    # 读取文件
    print("📖 正在读取文件...")
    rows = read_file(file_path)
    print(f"   读取到 {len(rows)} 行数据")

    if len(rows) < 2:
        print("⚠️ 数据行数不足，请检查文件内容")
        sys.exit(0)

    # 识别列
    print("🔍 正在识别列结构...")
    col_map = identify_columns(rows[0])
    identified = {k: v for k, v in col_map.items() if v is not None}
    print(f"   已识别列: {', '.join(identified.keys())}")

    if col_map["date"] is None:
        print("⚠️ 未识别到日期列，请检查表头是否包含'日期'字样")
    if col_map["amount"] is None and col_map["income"] is None:
        print("⚠️ 未识别到金额列，请检查表头是否包含'金额/贷方/借方'字样")

    # 处理交易
    print("⚙️ 正在分类处理...")
    results = process_transactions(rows, col_map)
    print(f"   处理了 {len(results)} 笔有效交易")

    # 输出汇总
    print_summary(results)

    # 生成文件
    print()
    print(f"💾 正在保存: {output_path}")
    generate_output(results, output_path)

    print()
    print("=" * 60)
    print("✅ 整理完成！")
    print(f"   📄 分类结果: {output_path}")
    print()
    print("⚡ 下一步:")
    print("   1. 打开CSV确认每笔交易的分类是否正确")
    print("   2. 核对'疑似捐赠收入'是否均已开具票据")
    print("   3. 关注'大额标记'的交易是否有审批记录")
    print("=" * 60)


if __name__ == "__main__":
    main()
