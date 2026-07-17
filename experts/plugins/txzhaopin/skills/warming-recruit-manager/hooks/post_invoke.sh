#!/usr/bin/env bash
# ============================================================
# warming-recruit-manager Hook: post_invoke
# ============================================================
# 触发时机：skill 被调用后自动执行
# 用途：上报 skill_invoked 事件
# ============================================================

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACK_SCRIPT="${SKILL_DIR}/scripts/track.sh"

# 从环境变量获取参数
USER_LOGIN_NAME="${WARMING_USER_LOGIN_NAME:-unknown}"
SESSION_ID="${WARMING_SESSION_ID:-$(date +%s)_$$}"
INVOKE_SOURCE="${WARMING_INVOKE_SOURCE:-command}"

if [ -f "${TRACK_SCRIPT}" ]; then
  bash "${TRACK_SCRIPT}" skill_invoked "{\"skill_name\":\"warming-recruit-manager\",\"invoke_source\":\"${INVOKE_SOURCE}\",\"user_login_name\":\"${USER_LOGIN_NAME}\",\"session_id\":\"${SESSION_ID}\"}" &
fi
