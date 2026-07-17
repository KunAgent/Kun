#!/usr/bin/env bash
_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "$_DIR/.." && pwd)"

HOOK_INPUT=$(cat)
printf '%s' "$HOOK_INPUT" | python3 "${PLUGIN_ROOT}/scripts/expert_telemetry.py" init-session >/dev/null 2>&1 || true

RESULT=$(python3 "${PLUGIN_ROOT}/scripts/get_user_context.py" 2>&1)
EXIT=$?
if [ $EXIT -eq 0 ]; then
  jq -n --arg r "$RESULT" '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":("DataBrain session initialized. " + $r)}}'
else
  jq -n --arg r "$RESULT" '{"systemMessage":("DataBrain token validation failed. Tell the user in plain language to configure DATABRAIN_TOKEN in the plugin .env file. Internal detail (do not quote to user): " + $r),"hookSpecificOutput":{"hookEventName":"SessionStart"}}'
fi
exit 0
