#!/usr/bin/env bash
# setup_user_id.sh — 自动配置 SKILL_TRACKER_USER_ID（A1 工号 UV）
#
# 用途：
#   解决 interview-assistant 埋点中 A1 字段未上报的问题。
#   A1 = 用户工号（如 elioyao），用于看板按工号去重 UV（vs A2 仅按设备去重）。
#
# 用法：
#   bash setup_user_id.sh                 # 自动从 mcporter 反查工号 → 写到 ~/.zshrc
#   bash setup_user_id.sh elioyao         # 手动指定工号
#   bash setup_user_id.sh --check         # 只检查当前状态，不修改
#
# 退出码：
#   0  = 配置成功 / 已配置正确
#   1  = 自动反查失败（需手动指定）
#   2  = 写入 zshrc 失败

set -e

SHELL_RC="$HOME/.zshrc"
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"

# === 子命令：仅检查 ===
if [ "$1" = "--check" ]; then
    echo "=== 当前 SKILL_TRACKER_USER_ID 状态 ==="
    if [ -n "$SKILL_TRACKER_USER_ID" ]; then
        echo "✅ 当前 shell 已设置：$SKILL_TRACKER_USER_ID"
    else
        echo "❌ 当前 shell 未设置"
    fi
    if grep -q "SKILL_TRACKER_USER_ID" "$SHELL_RC" 2>/dev/null; then
        VAL=$(grep "SKILL_TRACKER_USER_ID" "$SHELL_RC" | tail -1 | sed -E 's/.*=\s*"?([^"]*)"?.*/\1/')
        echo "✅ $SHELL_RC 中已记录：$VAL"
    else
        echo "❌ $SHELL_RC 中未记录"
        echo "   建议运行：bash $0"
    fi
    exit 0
fi

# === Step 1: 确定工号 ===
USER_ID="$1"

if [ -z "$USER_ID" ]; then
    # 自动反查：通过 mcporter 调任意一个返回当前登录人 staff 字段的接口
    # 这里用 social-todo-center.get_api_trace_get_list（轻量、稳定、必带 staff 字段）
    if command -v mcporter >/dev/null 2>&1; then
        echo "🔍 通过 mcporter recruit-mcp 反查当前用户工号..."
        AUTO_USER=$(mcporter call recruit-mcp CallAPI \
            apiId='recruit.social-todo-center.get_api_trace_get_list' \
            params='{"flowId":"3","extType":"interview","done":"false","type":"trace","pageNum":1,"pageSize":1}' \
            2>/dev/null | python3 -c "
import sys, json, re
try:
    raw = sys.stdin.read()
    m = re.search(r'\{[\s\S]+\}', raw)
    if not m: sys.exit(1)
    d = json.loads(m.group())
    rows = (d.get('data',{}).get('data',{}) or {}).get('rows') or []
    if rows:
        # 第一条 row 的 staff 字段就是当前操作人英文名
        staff = rows[0].get('staff','').strip()
        if staff:
            print(staff)
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null || true)

        if [ -n "$AUTO_USER" ]; then
            USER_ID="$AUTO_USER"
            echo "✅ 自动反查成功：$USER_ID（来源：social-todo-center 当前操作人）"
        fi
    fi
fi

if [ -z "$USER_ID" ]; then
    cat <<EOF
❌ 自动反查失败。请手动指定工号：

  bash $0 <你的工号>

例如：
  bash $0 elioyao

或者直接编辑 $SHELL_RC，加一行：
  export SKILL_TRACKER_USER_ID=<你的工号>

EOF
    exit 1
fi

# === Step 2: 写入 shell rc ===
echo ""
echo "📝 准备写入 $SHELL_RC：export SKILL_TRACKER_USER_ID=$USER_ID"

# 删旧的（避免重复）
if grep -q "^export SKILL_TRACKER_USER_ID=" "$SHELL_RC" 2>/dev/null; then
    # macOS sed 需要 -i ''
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/^export SKILL_TRACKER_USER_ID=/d' "$SHELL_RC"
    else
        sed -i '/^export SKILL_TRACKER_USER_ID=/d' "$SHELL_RC"
    fi
fi

# 加新的
echo "" >> "$SHELL_RC"
echo "# Added by tx-recruit interview-assistant for A1 (staff_name) UV tracking" >> "$SHELL_RC"
echo "export SKILL_TRACKER_USER_ID=$USER_ID" >> "$SHELL_RC"

cat <<EOF

✅ 配置完成！

📌 下一步：
  1. 当前 shell 立即生效：source $SHELL_RC
  2. 验证：echo \$SKILL_TRACKER_USER_ID  （应输出 $USER_ID）
  3. 重启 WorkBuddy 让 skill 进程读到新环境变量

埋点上报后，看板上 A1 字段会显示 $USER_ID（工号 UV 维度）

EOF
