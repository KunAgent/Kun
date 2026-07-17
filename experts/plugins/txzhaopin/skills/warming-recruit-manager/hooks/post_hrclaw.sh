#!/usr/bin/env bash
# ============================================================
# warming-recruit-manager Hook: post_hrclaw
# ============================================================
# 触发时机：HRClaw 邮件/企微 Tips 发送完成后执行
# 用途：上报 scene_f_hrclaw 事件
# ============================================================

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACK_SCRIPT="${SKILL_DIR}/scripts/track.sh"

# 从环境变量获取参数
CHANNEL="${WARMING_HRCLAW_CHANNEL:-mail}"
NOTIFY_TARGET="${WARMING_HRCLAW_NOTIFY_TARGET:-tutor}"
TEMPLATE_TYPE="${WARMING_HRCLAW_TEMPLATE_TYPE:-single}"
OA_LOGIN_RESULT="${WARMING_HRCLAW_OA_RESULT:-unknown}"
SEND_RESULT="${WARMING_HRCLAW_SEND_RESULT:-unknown}"
RECEIVER_COUNT="${WARMING_HRCLAW_RECEIVER_COUNT:-0}"
CANDIDATE_COUNT="${WARMING_HRCLAW_CANDIDATE_COUNT:-0}"
HAS_RESUME_LINK="${WARMING_HRCLAW_HAS_RESUME_LINK:-no}"
HAS_EMPLOYEE_SUBTYPE="${WARMING_HRCLAW_HAS_EMPLOYEE_SUBTYPE:-no}"
USE_BROWSER_AUTOMATION="${WARMING_HRCLAW_USE_BROWSER_AUTOMATION:-yes}"
FALLBACK_REASON="${WARMING_HRCLAW_FALLBACK_REASON:-na}"
USER_LOGIN_NAME="${WARMING_USER_LOGIN_NAME:-unknown}"
SESSION_ID="${WARMING_SESSION_ID:-$(date +%s)_$$}"

if [ -f "${TRACK_SCRIPT}" ]; then
  bash "${TRACK_SCRIPT}" scene_f_hrclaw "{\"channel\":\"${CHANNEL}\",\"notify_target\":\"${NOTIFY_TARGET}\",\"template_type\":\"${TEMPLATE_TYPE}\",\"oa_login_result\":\"${OA_LOGIN_RESULT}\",\"send_result\":\"${SEND_RESULT}\",\"receiver_count\":${RECEIVER_COUNT},\"candidate_count\":${CANDIDATE_COUNT},\"has_resume_link\":\"${HAS_RESUME_LINK}\",\"has_employee_subtype\":\"${HAS_EMPLOYEE_SUBTYPE}\",\"use_browser_automation\":\"${USE_BROWSER_AUTOMATION}\",\"fallback_reason\":\"${FALLBACK_REASON}\",\"user_login_name\":\"${USER_LOGIN_NAME}\",\"session_id\":\"${SESSION_ID}\"}" &
fi
