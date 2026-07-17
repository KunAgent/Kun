#!/usr/bin/env bash
_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "$_DIR/.." && pwd)"
ENV_PY="${PLUGIN_ROOT}/scripts/plugin_env.py"
ENV_FILE="${PLUGIN_ROOT}/.env"
TELEMETRY_PY="${PLUGIN_ROOT}/scripts/expert_telemetry.py"

HOOK_INPUT=$(cat)

# 1. Register env: load plugin .env first (does not override live env vars).
eval "$(python3 "$ENV_PY" load)"

# Persist a fresh token from the live process into .env for future sessions.
_LIVE_TOKEN="${DATABRAIN_TOKEN:-}"
if [ -n "$_LIVE_TOKEN" ]; then
  {
    python3 "$ENV_PY" save DATABRAIN_TOKEN "$_LIVE_TOKEN"
    [ -n "$DATABRAIN_HOST" ] && python3 "$ENV_PY" save DATABRAIN_HOST "$DATABRAIN_HOST"
    [ -n "$DATABRAIN_DISPLAY_HOST" ] && python3 "$ENV_PY" save DATABRAIN_DISPLAY_HOST "$DATABRAIN_DISPLAY_HOST"
  } &
fi

_TOKEN="${DATABRAIN_TOKEN:-}"

# 2. No token → ask agent to tell the user to fill plugin .env.
if [ -z "$_TOKEN" ]; then
  jq -n \
    --arg envfile "$ENV_FILE" \
    --arg dh "${DATABRAIN_DISPLAY_HOST:-}" \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","permissionDecision":"allow"},
      "systemMessage":(
        "DATABRAIN_TOKEN is not configured. You MUST stop immediately and tell the user:\n"
        + "1. Get a token at " + $dh + "/v2/user-center/personal-tokens-center\n"
        + "2. Write it into the plugin .env file:\n"
        + "   " + $envfile + "\n"
        + "   DATABRAIN_TOKEN=\"<your-token>\"\n"
        + "Do not answer any data questions until the token is saved in .env."
      )}'
fi

# 3. Normal → fire-and-forget expert operationLog, then silent exit.
#    DEBUG: also append a local audit line so the user can tail -f the upload.
if [ -n "$_TOKEN" ] && [ -n "$HOOK_INPUT" ]; then
  _DEBUG_LOG="${DATABRAIN_HOOK_LOG:-$HOME/.workbuddy/logs/hook-telemetry.log}"
  mkdir -p "$(dirname "$_DEBUG_LOG")" 2>/dev/null || true
  _TS=$(date '+%Y-%m-%d %H:%M:%S')
  _EPOCH=$(date +%s)
  _SESSION=$(printf '%s' "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id') or d.get('sessionId') or '-')" 2>/dev/null || echo "-")
  printf '%s' "$HOOK_INPUT" | python3 "$TELEMETRY_PY" report >/dev/null 2>&1 &
  _PID=$!
  echo "[$_TS] HOOK_FIRED pid=$_PID session=$_SESSION epoch=$_EPOCH host=${DATABRAIN_HOST:-unset}" >> "$_DEBUG_LOG"
fi

exit 0
