#!/bin/bash
# 数据画像报告生成模板
# 用法: bash generate_profile_report.sh <data_file> <output_dir>

DATA_FILE="${1}"
OUTPUT_DIR="${2:-./output}"

if [ -z "$DATA_FILE" ]; then
    echo "用法: bash generate_profile_report.sh <data_file> [output_dir]"
    echo "支持格式: CSV, Excel (.xlsx/.xls)"
    exit 1
fi

if [ ! -f "$DATA_FILE" ]; then
    echo "错误: 文件不存在 - $DATA_FILE"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

FILENAME=$(basename "$DATA_FILE")
REPORT_NAME="${FILENAME%.*}_profile_report"

echo "=== 数据画像报告生成器 ==="
echo "输入文件: $DATA_FILE"
echo "输出目录: $OUTPUT_DIR"
echo ""

# 生成 JSON 画像
echo "[1/3] 生成数据画像..."
python3 "$(dirname "$0")/data_profiler.py" "$DATA_FILE" --format json > "$OUTPUT_DIR/${REPORT_NAME}.json"

# 生成 Markdown 报告
echo "[2/3] 生成 Markdown 报告..."
python3 "$(dirname "$0")/data_profiler.py" "$DATA_FILE" --format markdown > "$OUTPUT_DIR/${REPORT_NAME}.md"

echo "[3/3] 完成！"
echo ""
echo "输出文件:"
echo "  - JSON画像: $OUTPUT_DIR/${REPORT_NAME}.json"
echo "  - Markdown报告: $OUTPUT_DIR/${REPORT_NAME}.md"
