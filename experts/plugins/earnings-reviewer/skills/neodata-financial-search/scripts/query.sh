#!/usr/bin/env bash
# NeoData 金融数据查询 - curl 封装（通过代理 API）
#
# Usage:
#   bash query.sh "腾讯最新财报"
#   bash query.sh --token "<token>" "贵州茅台股价"
#   bash query.sh --save-token "<token>"
#
# 鉴权优先级: --token 参数 > skills 目录下 .neodata_token 缓存文件（12 小时有效期）
#
# 环境变量 (可选):
#   NEODATA_ENDPOINT  - 代理 URL (可选，默认 https://copilot.tencent.com/agenttool/v1/neodata)
#   NEODATA_DATA_TYPE - 数据类型 all/api/doc (可选，默认不传由代理填充)

set -euo pipefail

DEFAULT_ENDPOINT="https://copilot.tencent.com/agenttool/v1/neodata"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
TOKEN_FILE="$SKILLS_DIR/.neodata_token"
LEGACY_TOKEN_FILE="$HOME/.workbuddy/.neodata_token"
TOKEN_TTL=43200  # 12 小时 = 43200 秒

# 跨平台 Python 解释器探测：python3 → python → py。
# Windows 上 python3 可能是应用商店存根（不可用），故逐个验证可执行。
detect_python() {
    local c
    for c in python3 python py; do
        if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys" >/dev/null 2>&1; then
            echo "$c"
            return 0
        fi
    done
    return 1
}
PYTHON_BIN="$(detect_python || true)"

# 解析参数
CLI_TOKEN=""
SAVE_TOKEN=""
QUERY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --token)
            CLI_TOKEN="$2"
            shift 2
            ;;
        --save-token)
            SAVE_TOKEN="$2"
            shift 2
            ;;
        *)
            QUERY="$1"
            shift
            ;;
    esac
done

# --save-token 模式：保存后退出（JSON 格式，含时间戳）
if [[ -n "$SAVE_TOKEN" ]]; then
    NOW=$(date +%s)
    printf '{"token":"%s","saved_at":%s}' "$SAVE_TOKEN" "$NOW" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    # 清理旧路径
    [[ -f "$LEGACY_TOKEN_FILE" ]] && rm -f "$LEGACY_TOKEN_FILE"
    echo "Token 已保存到 $TOKEN_FILE（有效期 12 小时）"
    exit 0
fi

if [[ -z "$QUERY" ]]; then
    echo "用法: bash query.sh [--token <token>] <query>" >&2
    echo "      bash query.sh --save-token <token>" >&2
    exit 1
fi

ENDPOINT="${NEODATA_ENDPOINT:-$DEFAULT_ENDPOINT}"
DATA_TYPE="${NEODATA_DATA_TYPE:-}"

# Token 优先级: --token 参数 > 缓存文件（需检查过期）
TOKEN="$CLI_TOKEN"
if [[ -z "$TOKEN" ]]; then
    # 旧路径存在且新路径不存在时，自动迁移
    if [[ -f "$LEGACY_TOKEN_FILE" && ! -f "$TOKEN_FILE" ]]; then
        mv "$LEGACY_TOKEN_FILE" "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
    fi

    if [[ -f "$TOKEN_FILE" ]]; then
        # 读取 JSON 缓存，检查 12 小时过期
        SAVED_AT=$(${PYTHON_BIN:-python3} -c "import json; print(json.load(open('$TOKEN_FILE')).get('saved_at', 0))" 2>/dev/null || echo "0")
        NOW=$(date +%s)
        ELAPSED=$((NOW - SAVED_AT))
        if [[ "$ELAPSED" -lt "$TOKEN_TTL" ]]; then
            TOKEN=$(${PYTHON_BIN:-python3} -c "import json; print(json.load(open('$TOKEN_FILE')).get('token', ''))" 2>/dev/null || echo "")
        else
            echo "TOKEN_EXPIRED" >&2
        fi
    else
        echo "TOKEN_MISSING" >&2
    fi
fi

if [[ -z "$TOKEN" ]]; then
    exit 1
fi

# 构建请求体，channel 和 sub_channel 为固定字段
if [[ -n "$DATA_TYPE" ]]; then
    BODY=$(printf '{"query": "%s", "channel": "neodata", "sub_channel": "workbuddy", "data_type": "%s"}' "$QUERY" "$DATA_TYPE")
else
    BODY=$(printf '{"query": "%s", "channel": "neodata", "sub_channel": "workbuddy"}' "$QUERY")
fi

RESPONSE=$(curl --silent --show-error --location --max-time 30 --connect-timeout 10 \
    --write-out "\n%{http_code}" \
    "${ENDPOINT}" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer ${TOKEN}" \
    --data "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESP=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "请求失败: HTTP ${HTTP_CODE}" >&2
    [[ -n "$BODY_RESP" ]] && echo "$BODY_RESP" >&2
    exit 1
fi

echo "$BODY_RESP" | ${PYTHON_BIN:-python3} -m json.tool 2>/dev/null || echo "$BODY_RESP"
