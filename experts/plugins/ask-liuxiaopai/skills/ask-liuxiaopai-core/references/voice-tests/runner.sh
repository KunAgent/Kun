#!/usr/bin/env bash
# Voice Regression Runner
#
# 用法：
#   bash references/voice-tests/runner.sh        # 跑全部 8 道
#   bash references/voice-tests/runner.sh T1 T3  # 只跑 T1 和 T3
#
# 输出：references/voice-tests/runs/<timestamp>/
#   - T<N>-output.md       (AI 刘小排干净 final answer)
#   - T<N>-output-raw.txt  (codex 原始 transcript，调试用)
#   - T<N>-judge.json      (judge 评分)
#   - T<N>-judge-raw.txt   (judge 原始输出，调试用)
#   - summary.md           (汇总)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y-%m-%d-%H%M)"
RUN_DIR="$SCRIPT_DIR/runs/$TS"

mkdir -p "$RUN_DIR"

# ====== Model pin (必须显式带，不靠 ~/.codex/config.toml) ======

CODEX_FLAGS=(
    --skip-git-repo-check
    -c "model=gpt-5.5"
    -c "model_reasoning_effort=xhigh"
)

# ====== Tests (case 兼容 macOS bash 3.2) ======

get_prompt() {
    case "$1" in
        T1) echo '我想做一个 AI 写作工具，帮自媒体作者一键生成爆款标题。' ;;
        T2) echo '我想做一个企业培训 SaaS，专门做员工合规培训。目标客户是 500 人以上的中型企业 HR 部门。我已经写了 demo，想看看怎么开始 sales。' ;;
        T3) echo '我想抄一个现在很赚钱的 AI 产品，做个差不多的版本快点赚钱。' ;;
        T4) echo '我现在上班很烦，想辞职 all in 做自己的产品。' ;;
        T5) echo '已知前 4 轮：用户描述要做"帮人写公众号的 AI 工具"，AI 刘小排已问出小李这个具体的人，小李每周憋一篇要 4-6 小时主要卡选题，阅读量 100 多。轮 4 用户问 GPT-5。第 5 轮用户说："哎，AI 行业变化太快了。你说我做这个公众号工具会不会被新模型淘汰？要不要等几个月看看再做？" 请给第 5 轮 AI 刘小排的回复。' ;;
        T6) echo '我做了一个 AI 工具，定价 9.9 还是 49 比较好？我想做订阅，应该 9.9/月还是 49/月？' ;;
        T7) echo '我想一个人做出海 AI 产品，面向美国中小企业卖订阅。' ;;
        T8) echo '你说的"独立开发者"这个词有什么问题？' ;;
        *) echo "" ;;
    esac
}

# ====== 提取干净 final answer ======
#
# codex exec 的 stdout 通常包含：
#   <session header / approval / model 等元信息>
#   <reasoning trace>
#   codex
#   <final answer 第 1 次>
#   tokens used
#   <count>
#   <final answer 第 2 次重复>
#
# 我们要的是最后一次重复的 final answer——最干净。

extract_clean_answer() {
    local RAW="$1"

    # 方案 A：取最后一个 "tokens used" 之后第 2 行起（跳过 count 行）
    local LAST_TOKENS
    LAST_TOKENS=$(grep -n "^tokens used$" "$RAW" 2>/dev/null | tail -1 | cut -d: -f1)
    if [ -n "$LAST_TOKENS" ]; then
        local START=$((LAST_TOKENS + 2))
        local LINES
        LINES=$(tail -n +$START "$RAW" | sed -e :a -e '/./,$!d' -e '/^[[:space:]]*$/{$d;N;ba' -e '}')
        if [ -n "$LINES" ]; then
            printf '%s\n' "$LINES"
            return 0
        fi
    fi

    # 方案 B：fallback —— 取最后一行 "^codex$" 之后到 "tokens used" 之前
    local CODEX_LINE
    CODEX_LINE=$(grep -n "^codex$" "$RAW" 2>/dev/null | tail -1 | cut -d: -f1)
    if [ -n "$CODEX_LINE" ]; then
        local FROM=$((CODEX_LINE + 1))
        if [ -n "$LAST_TOKENS" ] && [ "$LAST_TOKENS" -gt "$CODEX_LINE" ]; then
            local TO=$((LAST_TOKENS - 1))
            sed -n "${FROM},${TO}p" "$RAW"
        else
            tail -n +$FROM "$RAW"
        fi
        return 0
    fi

    # 方案 C：兜底原样返回
    cat "$RAW"
}

# ====== Run AI 刘小排 + Judge ======

run_test() {
    TID="$1"
    PROMPT="$(get_prompt "$TID")"

    if [ -z "$PROMPT" ]; then
        echo "[$TID] Unknown test"
        return
    fi

    echo "[$TID] Running AI 刘小排 (model=gpt-5.5/xhigh)..."

    AI_RAW="$RUN_DIR/$TID-output-raw.txt"
    AI_OUT="$RUN_DIR/$TID-output.md"

    cat <<EOF | codex exec "${CODEX_FLAGS[@]}" - 2>&1 > "$AI_RAW"
$PROMPT

请使用 ask-liuxiaopai skill 完全沉浸扮演 AI 刘小排。skill 在 ~/.codex/skills/ask-liuxiaopai/SKILL.md。
EOF

    extract_clean_answer "$AI_RAW" > "$AI_OUT"

    if [ ! -s "$AI_OUT" ]; then
        echo "[$TID] WARNING: extracted output is empty, see $AI_RAW"
    fi

    echo "[$TID] Running judge (model=gpt-5.5/xhigh)..."

    JUDGE_RAW="$RUN_DIR/$TID-judge-raw.txt"
    JUDGE_OUT="$RUN_DIR/$TID-judge.json"

    cat <<EOF | codex exec "${CODEX_FLAGS[@]}" - 2>&1 > "$JUDGE_RAW"
你是 ask-liuxiaopai voice regression judge。按 rubric 客观打勾。

【绝对规则】
1. 只判断 rubric 客观条目。
2. 输出严格 JSON 平铺格式，无任何 prose、解释、代码块标记。
3. 格式：{"test_id": "$TID", "r1": "pass|fail|na", ..., "r14": "pass|fail|na"}

【测试题输入 ($TID)】
$PROMPT

【AI 刘小排回答】
$(cat "$AI_OUT")

【rubric 定义】（r1-r14 共 14 条）
$(cat "$SCRIPT_DIR/judge/schema.md")

只输出 JSON，不要 prose。
EOF

    # 从 codex 原始输出里抠干净的 JSON：取 final answer 后再 grep
    JUDGE_CLEAN=$(extract_clean_answer "$JUDGE_RAW")
    if echo "$JUDGE_CLEAN" | grep -oE '\{[^{}]*"r1"[^{}]*\}' | head -1 > "$JUDGE_OUT" && [ -s "$JUDGE_OUT" ]; then
        echo "[$TID] Judge OK"
    else
        echo '{"parse_error": true}' > "$JUDGE_OUT"
        echo "[$TID] Judge parse failed, see $JUDGE_RAW"
    fi
}

# ====== Main ======

if [ $# -eq 0 ]; then
    TIDS="T1 T2 T3 T4 T5 T6 T7 T8"
else
    TIDS="$@"
fi

for TID in $TIDS; do
    run_test "$TID"
done

# ====== Summary ======

echo ""
echo "===== Summary ====="
{
    echo "# Voice Test Run: $TS"
    echo ""
    echo "Model pin: gpt-5.5 / xhigh reasoning"
    echo ""
    echo "| Test | Pass | Fail | N/A | Status |"
    echo "|------|------|------|-----|--------|"

    for TID in $TIDS; do
        JUDGE="$RUN_DIR/$TID-judge.json"
        if [ -f "$JUDGE" ] && ! grep -q parse_error "$JUDGE"; then
            PASS=$(grep -o '"pass"' "$JUDGE" | wc -l | tr -d ' ')
            FAIL=$(grep -o '"fail"' "$JUDGE" | wc -l | tr -d ' ')
            NA=$(grep -o '"na"' "$JUDGE" | wc -l | tr -d ' ')
            if [ "$PASS" -ge 10 ]; then STATUS="✅ pass"; else STATUS="❌ fail"; fi
            echo "| $TID | $PASS | $FAIL | $NA | $STATUS |"
        else
            echo "| $TID | - | - | - | ⚠️ parse_error |"
        fi
    done
} > "$RUN_DIR/summary.md"

cat "$RUN_DIR/summary.md"

echo ""
echo "Output dir: $RUN_DIR"
