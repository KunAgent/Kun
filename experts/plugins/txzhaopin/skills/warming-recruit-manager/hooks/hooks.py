#!/usr/bin/env python3
"""
Multi-platform Hook dispatcher - unified entry point for all hook events.

Event name compatibility:
  CodeBuddy events (legacy):  Claude Code events:
  - session_start         →   SessionStart
  - session_end           →   SessionEnd
  - tool_used             →   PostToolUse
  - agent_stop            →   Stop

Manual / standalone invocation:
    python3 /path/to/hooks/hooks.py SessionStart
    python3 /path/to/hooks/hooks.py Stop
    python3 /path/to/hooks/hooks.py PostToolUse
"""

import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import send_report, save_session_start, get_session_duration

# =============================================================================
# !! CONFIGURE THESE FOR YOUR SKILL !!
# =============================================================================
APP_KEY = "0WEB0709ORSHJO0F"
SKILL_NAME = "warming-recruit-manager"
# =============================================================================


def handle_session_start(input_data):
    """SessionStart: report skill_invoked and cache session start time."""
    session_id = input_data.get("session_id", "unknown")
    save_session_start(session_id)
    send_report(APP_KEY, SKILL_NAME, "skill_invoked", {
        "session_id": session_id,
        "invoke_source": input_data.get("invoke_source", "unknown"),
        "report_source": "hook_auto",
    })


def handle_session_end(input_data):
    """SessionEnd: report session duration."""
    session_id = input_data.get("session_id", "unknown")
    reason = input_data.get("reason", "unknown")
    duration_seconds = get_session_duration(session_id)
    send_report(APP_KEY, SKILL_NAME, "session_end", {
        "skill_name": SKILL_NAME,
        "session_id": session_id,
        "reason": reason,
        "duration_seconds": duration_seconds,
    })


# Only intercept report.sh event/batch commands (intermediate business events).
_REPORT_EVENT_PATTERN = re.compile(
    r"report\.sh\s+event\s+"
    r"(?P<event>\S+)"
    r"(?:\s+'(?P<json>\{[^']*\})')?"
)

# Also match legacy report_event.sh pattern for backward compatibility
_LEGACY_REPORT_PATTERN = re.compile(
    r"report_event\.sh\s+"
    r"(?P<event>\S+)"
    r"(?:\s+'(?P<json>\{[^']*\})')?"
)

# Match batch subcommand: report.sh batch 'evt1|json1' 'evt2|json2' ...
_REPORT_BATCH_PATTERN = re.compile(r"report\.sh\s+batch\s+(.+)")
_BATCH_ITEM_PATTERN = re.compile(r"'([^']+)'")


def _try_intercept_tracking_command(command):
    """If command contains report event/batch call, extract event info and report it."""
    if not command:
        return False

    # Try batch pattern first
    batch_match = _REPORT_BATCH_PATTERN.search(command)
    if batch_match:
        items_str = batch_match.group(1)
        items = _BATCH_ITEM_PATTERN.findall(items_str)
        for item in items:
            if "|" in item:
                event_name, json_str = item.split("|", 1)
            else:
                event_name, json_str = item, ""
            extra_data = {"report_source": "hook_intercept"}
            if json_str:
                try:
                    parsed = json.loads(json_str)
                    if isinstance(parsed, dict):
                        extra_data.update(parsed)
                except (json.JSONDecodeError, ValueError):
                    pass
            send_report(APP_KEY, SKILL_NAME, event_name.strip(), extra_data)
        return bool(items)

    # Single event pattern
    match = _REPORT_EVENT_PATTERN.search(command)
    if not match:
        match = _LEGACY_REPORT_PATTERN.search(command)
    if not match:
        return False

    event_name = match.group("event") or "custom_event"
    json_str = match.group("json")

    extra_data = {"report_source": "hook_intercept"}
    if json_str:
        try:
            parsed = json.loads(json_str)
            if isinstance(parsed, dict):
                extra_data.update(parsed)
        except (json.JSONDecodeError, ValueError):
            pass

    send_report(APP_KEY, SKILL_NAME, event_name, extra_data)
    return True


def handle_tool_used(input_data):
    """PostToolUse: intercept report_event commands for business events."""
    tool_input = input_data.get("tool_input", {})
    if isinstance(tool_input, dict) and "command" in tool_input:
        _try_intercept_tracking_command(tool_input["command"])


def handle_agent_stop(input_data):
    """Stop: report task_completed when agent finishes."""
    session_id = input_data.get("session_id", "unknown")
    stop_reason = input_data.get("stop_reason", input_data.get("reason", ""))

    error_reasons = {"error", "tool_error", "max_tokens"}
    status = "fail" if stop_reason in error_reasons else "success"

    send_report(APP_KEY, SKILL_NAME, "task_completed", {
        "skill_name": SKILL_NAME,
        "session_id": session_id,
        "status": status,
        "report_source": "hook_auto",
    })


# --- Dispatcher ---
# Maps both CodeBuddy and Claude Code event names to the same handlers.
HANDLERS = {
    # CodeBuddy event names
    "session_start": handle_session_start,
    "session_end": handle_session_end,
    "tool_used": handle_tool_used,
    "agent_stop": handle_agent_stop,
    # Claude Code event names (same handlers, different entry points)
    "SessionStart": handle_session_start,
    "SessionEnd": handle_session_end,
    "PostToolUse": handle_tool_used,
    "Stop": handle_agent_stop,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in HANDLERS:
        valid = ", ".join(sorted(set(HANDLERS.keys())))
        print(f"Usage: python3 hooks.py <{valid}>", file=sys.stderr)
        sys.exit(1)

    try:
        input_data = json.loads(sys.stdin.read())
    except Exception:
        input_data = {}

    HANDLERS[sys.argv[1]](input_data)
    print(json.dumps({"continue": True}))


if __name__ == "__main__":
    main()
