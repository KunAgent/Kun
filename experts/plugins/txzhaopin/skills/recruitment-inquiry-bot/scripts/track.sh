#!/bin/bash
# =============================================================================
# skill-tracker: track.sh
# A zero-dependency, platform-adaptive shell script for reporting skill usage
# events to Beacon.
#
# Runtime behavior:
#   - On CodeBuddy: Hooks handle most reporting automatically (100%).
#     This script serves as supplement for custom business events.
#   - On OpenClaw/BoxAI/others: This script is the primary reporting mechanism.
#
# Requirements: bash + curl (available on all platforms)
#
# Usage:
#   bash ./track.sh <app_key> <skill_name> <event_name> [json_data]
#
# Examples:
#   bash ./track.sh "YOUR_APP_KEY" "my-skill" "skill_invoked"
#   bash ./track.sh "YOUR_APP_KEY" "my-skill" "task_done" '{"status":"success"}'
#
# Exit codes:
#   0 - Always returns 0 (never blocks the caller)
# =============================================================================

set -o pipefail

# --- Configuration ---
BEACON_URL="https://otheve.beacon.qq.com/analytics/v2_upload"
SDK_ID="js"
SDK_VERSION="4.3.4-web"
APP_VERSION="1.0.0"
PLATFORM_ID="3"
TIMEOUT_SECONDS=3

# --- Input validation ---
APP_KEY="${1:-}"
SKILL_NAME="${2:-}"
EVENT_NAME="${3:-}"
CUSTOM_DATA="${4:-}"
USER_ID="${5:-${SKILL_TRACKER_USER_ID:-}}"

if [ -z "$APP_KEY" ] || [ -z "$SKILL_NAME" ] || [ -z "$EVENT_NAME" ]; then
    echo "Usage: bash scripts/track.sh <app_key> <skill_name> <event_name> [json_data]" >&2
    exit 0
fi

# --- Guard: reject placeholder app_key ---
if [ "$APP_KEY" = "YOUR_APP_KEY" ] || [ "$APP_KEY" = "your_app_key" ] || [ "$APP_KEY" = "YOUR-APP-KEY" ]; then
    echo "[skill-tracker] WARNING: app_key is not configured (got '$APP_KEY'). Skipping event '$EVENT_NAME'." >&2
    echo "[skill-tracker] Please provide a valid Beacon Appkey. Get one at https://trackmate.woa.com/" >&2
    exit 0
fi

# --- Helper: Replace special characters per Beacon API requirements ---
replace_symbol() {
    local value="$1"
    value="${value//|/%7C}"
    value="${value//&/%26}"
    value="${value//=/%3D}"
    value="${value//+/%2B}"
    echo "$value"
}

# --- Generate stable device fingerprint (A2) ---
# Formula: MD5(hostname:username:device_id)
# Device ID priority: machine-id > MAC address > persistent UUID > "no-device-id"
# MUST match skill_tracker/fingerprint.py algorithm exactly.
generate_a2() {
    local raw_hostname=""
    local raw_username=""
    local device_id=""

    raw_hostname=$(hostname 2>/dev/null || echo "unknown-host")
    raw_username=$(whoami 2>/dev/null || echo "unknown-user")

    # --- Device ID priority chain ---

    # Priority 1: machine-id (Linux/container)
    if [ -z "$device_id" ] && [ -f /etc/machine-id ]; then
        device_id=$(cat /etc/machine-id 2>/dev/null | tr -d '[:space:]')
    fi
    if [ -z "$device_id" ] && [ -f /var/lib/dbus/machine-id ]; then
        device_id=$(cat /var/lib/dbus/machine-id 2>/dev/null | tr -d '[:space:]')
    fi

    # Priority 1: machine-id (Windows - MachineGuid)
    if [ -z "$device_id" ] && command -v reg.exe &>/dev/null; then
        device_id=$(reg.exe query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid 2>/dev/null \
            | grep -i "MachineGuid" | awk '{print $NF}' | tr -d '[:space:]')
    fi

    # Priority 1: machine-id (macOS - IOPlatformUUID)
    if [ -z "$device_id" ] && command -v ioreg &>/dev/null; then
        device_id=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null \
            | grep IOPlatformUUID | sed 's/.*= "//;s/"//' | tr -d '[:space:]')
    fi

    # Priority 2: MAC address
    if [ -z "$device_id" ]; then
        local raw_mac=""
        if command -v ifconfig &>/dev/null; then
            raw_mac=$(ifconfig 2>/dev/null | grep -oE '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | head -1)
        elif command -v ip &>/dev/null; then
            raw_mac=$(ip link 2>/dev/null | grep -oE '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' | head -1)
        elif command -v getmac &>/dev/null; then
            # Windows getmac: output format "AA-BB-CC-DD-EE-FF", convert to colon-separated
            raw_mac=$(getmac /FO CSV /NH 2>/dev/null | head -1 | cut -d',' -f1 | tr -d '"' | tr '-' ':')
        fi
        # Linux containers: read from sysfs
        if [ -z "$raw_mac" ] && [ -d /sys/class/net ]; then
            for iface in /sys/class/net/*/address; do
                local addr=""
                addr=$(cat "$iface" 2>/dev/null | tr -d '[:space:]')
                if [ -n "$addr" ] && [ "$addr" != "00:00:00:00:00:00" ]; then
                    raw_mac="$addr"
                    break
                fi
            done
        fi
        # Normalize MAC to lowercase (match Python uuid.getnode() format)
        [ -n "$raw_mac" ] && device_id=$(echo "$raw_mac" | tr '[:upper:]' '[:lower:]')
    fi

    # Priority 3: persistent device-id file
    if [ -z "$device_id" ]; then
        local did_dir="$HOME/.skill-tracker"
        local did_file="$did_dir/device-id"
        if [ -f "$did_file" ]; then
            device_id=$(cat "$did_file" 2>/dev/null | tr -d '[:space:]')
        fi
        if [ -z "$device_id" ]; then
            # Generate a UUID-like identifier
            local new_did=""
            if command -v uuidgen &>/dev/null; then
                new_did=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')
            elif command -v python3 &>/dev/null; then
                new_did=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null)
            elif [ -f /proc/sys/kernel/random/uuid ]; then
                new_did=$(cat /proc/sys/kernel/random/uuid 2>/dev/null)
            fi
            if [ -n "$new_did" ]; then
                mkdir -p "$did_dir" 2>/dev/null && echo "$new_did" > "$did_file" 2>/dev/null
                device_id="$new_did"
            fi
        fi
    fi

    # Priority 4: final fallback
    [ -z "$device_id" ] && device_id="no-device-id"

    local fingerprint="${raw_hostname}:${raw_username}:${device_id}"

    # --- MD5 calculation ---
    local a2=""
    if command -v md5sum &>/dev/null; then
        a2=$(echo -n "$fingerprint" | md5sum | cut -c1-32)
    elif command -v md5 &>/dev/null; then
        a2=$(echo -n "$fingerprint" | md5 -q)
    elif command -v openssl &>/dev/null; then
        a2=$(echo -n "$fingerprint" | openssl md5 | sed 's/.*= //')
    elif command -v python3 &>/dev/null; then
        a2=$(python3 -c "import hashlib,sys; print(hashlib.md5(sys.stdin.buffer.read()).hexdigest())" <<< "$fingerprint" 2>/dev/null)
        # python3 <<< adds a newline; recalculate with echo -n
        a2=$(echo -n "$fingerprint" | python3 -c "import hashlib,sys; print(hashlib.md5(sys.stdin.buffer.read()).hexdigest())" 2>/dev/null)
    else
        a2=$(echo -n "$fingerprint" | cksum | awk '{print $1}')
        a2=$(printf '%032s' "$a2" | tr ' ' '0')
    fi
    echo "$a2"
}

# --- Runtime platform detection ---
# Detects the CURRENT runtime platform, not the development platform.
# This runs every time the script is called, adapting to wherever the
# skill is actually being used.
detect_platform() {
    local platform="unknown"

    # Method 1: Check environment variables set by platforms
    # Claude Code (claude-internal) indicators
    if [ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ] || [ -n "${CLAUDE_SKILL_DIR:-}" ]; then
        platform="claude-code"
    # CodeBuddy indicators
    elif [ -n "${CODEBUDDY_PROJECT_DIR:-}" ] || [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
        platform="codebuddy"
    elif [ -n "${CODEBUDDY_ENV:-}" ] || [ -n "${CODEBUDDY_VERSION:-}" ]; then
        platform="codebuddy"
    elif [ -n "${OPENCLAW_SHELL:-}" ] || [ -n "${OPENCLAW_ENV:-}" ] || [ -n "${OPENCLAW_VERSION:-}" ]; then
        # OPENCLAW_SHELL is OpenClaw's officially documented marker set by the
        # exec context (e.g. OPENCLAW_SHELL=exec) — it's the most reliable
        # signal we can get, so keep it first among OpenClaw env checks.
        platform="openclaw"
    elif [ -n "${BOXAI_ENV:-}" ] || [ -n "${BOXAI_VERSION:-}" ]; then
        platform="boxai"
    fi

    # Method 2: Check parent process hints
    if [ "$platform" = "unknown" ]; then
        local parent_cmd=""
        parent_cmd=$(ps -o comm= -p $PPID 2>/dev/null || echo "")
        if echo "$parent_cmd" | grep -qi "claude"; then
            platform="claude-code"
        elif echo "$parent_cmd" | grep -qi "codebuddy"; then
            platform="codebuddy"
        elif echo "$parent_cmd" | grep -qi "openclaw"; then
            platform="openclaw"
        elif echo "$parent_cmd" | grep -qi "boxai"; then
            platform="boxai"
        fi
    fi

    # Method 3: Check for platform-specific directories in workspace.
    # Only .claude/ is trusted here — it is Claude Code's runtime workspace
    # marker. We intentionally do NOT fall back to a `.codebuddy/` directory:
    # its presence only means the project once used CodeBuddy hooks, not that
    # the current runtime is CodeBuddy. A user opening the same workspace in
    # OpenClaw would otherwise be misclassified as codebuddy.
    if [ "$platform" = "unknown" ]; then
        if [ -d ".claude" ]; then
            platform="claude-code"
        fi
    fi

    # Method 4: IDE/terminal hints
    if [ "$platform" = "unknown" ]; then
        if [ -n "${VSCODE_PID:-}" ] || [ -n "${TERM_PROGRAM:-}" ]; then
            platform="ide-${TERM_PROGRAM:-vscode}"
        fi
    fi

    echo "$platform"
}

# --- Enrich data based on runtime platform ---
# On CodeBuddy, we can collect more context; on other platforms, collect basics.
collect_platform_context() {
    local platform="$1"
    local extra=""

    # Basic info available on all platforms
    # Use skill_ prefix for os to avoid Beacon reserved field conflict
    local os_info=""
    os_info=$(uname -s 2>/dev/null || echo "unknown")
    extra="\"skill_os\":\"$(replace_symbol "$os_info")\""

    local arch=""
    arch=$(uname -m 2>/dev/null || echo "unknown")
    extra="$extra,\"arch\":\"$(replace_symbol "$arch")\""

    # CodeBuddy-specific enrichment
    if [ "$platform" = "codebuddy" ]; then
        # Project directory from CodeBuddy env
        local project_dir="${CODEBUDDY_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
        extra="$extra,\"project_dir\":\"$(replace_symbol "$(basename "$project_dir")")\""

        # Detect project type
        local project_type="unknown"
        if [ -f "$project_dir/package.json" ]; then
            project_type="nodejs"
        elif [ -f "$project_dir/go.mod" ]; then
            project_type="go"
        elif [ -f "$project_dir/requirements.txt" ] || [ -f "$project_dir/pyproject.toml" ]; then
            project_type="python"
        elif [ -f "$project_dir/Cargo.toml" ]; then
            project_type="rust"
        elif [ -f "$project_dir/pom.xml" ] || [ -f "$project_dir/build.gradle" ]; then
            project_type="java"
        elif [ -f "$project_dir/CMakeLists.txt" ] || [ -f "$project_dir/Makefile" ]; then
            project_type="cpp"
        fi
        extra="$extra,\"project_type\":\"$project_type\""

        # File count (quick)
        local file_count="0"
        file_count=$(find "$project_dir" -maxdepth 2 -type f ! -path '*/.git/*' 2>/dev/null | wc -l | tr -d ' ')
        extra="$extra,\"file_count\":\"$file_count\""

        # Check if hooks are active
        if [ -f "$project_dir/.codebuddy/settings.json" ]; then
            extra="$extra,\"hooks_active\":\"true\""
        else
            extra="$extra,\"hooks_active\":\"false\""
        fi
    fi

    # Claude Code-specific enrichment
    if [ "$platform" = "claude-code" ]; then
        local project_dir="${CLAUDE_SKILL_DIR:-$(pwd)}"
        extra="$extra,\"project_dir\":\"$(replace_symbol "$(basename "$project_dir")")\""

        # Detect project type (same logic)
        local project_type="unknown"
        if [ -f "$project_dir/package.json" ]; then
            project_type="nodejs"
        elif [ -f "$project_dir/go.mod" ]; then
            project_type="go"
        elif [ -f "$project_dir/requirements.txt" ] || [ -f "$project_dir/pyproject.toml" ]; then
            project_type="python"
        elif [ -f "$project_dir/Cargo.toml" ]; then
            project_type="rust"
        elif [ -f "$project_dir/pom.xml" ] || [ -f "$project_dir/build.gradle" ]; then
            project_type="java"
        elif [ -f "$project_dir/CMakeLists.txt" ] || [ -f "$project_dir/Makefile" ]; then
            project_type="cpp"
        fi
        extra="$extra,\"project_type\":\"$project_type\""

        # Check if hooks are active (Claude Code uses .claude/settings.json or SKILL.md frontmatter)
        if [ -f "$project_dir/.claude/settings.json" ] || [ -f "$project_dir/SKILL.md" ]; then
            extra="$extra,\"hooks_active\":\"true\""
        else
            extra="$extra,\"hooks_active\":\"false\""
        fi
    fi

    echo "$extra"
}

# --- Collect skill_user (person-level UV) ---
# Priority: SKILL_TRACKER_USER env > whoami > "unknown"
collect_skill_user() {
    local user="${SKILL_TRACKER_USER:-}"
    if [ -z "$user" ]; then
        user=$(whoami 2>/dev/null || echo "unknown")
    fi
    echo "$user"
}

# --- Collect skill_version ---
# Priority: SKILL_VERSION env > pyproject.toml > package.json > VERSION file > empty
collect_skill_version() {
    local version="${SKILL_VERSION:-}"

    # Try pyproject.toml
    if [ -z "$version" ] && [ -f "$SKILL_DIR/pyproject.toml" ]; then
        version=$(grep -E '^version\s*=' "$SKILL_DIR/pyproject.toml" 2>/dev/null \
            | head -1 | sed 's/.*=\s*["'"'"']\(.*\)["'"'"'].*/\1/')
    fi

    # Try package.json
    if [ -z "$version" ] && [ -f "$SKILL_DIR/package.json" ]; then
        version=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$SKILL_DIR/package.json" 2>/dev/null \
            | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    fi

    # Try VERSION file
    if [ -z "$version" ] && [ -f "$SKILL_DIR/VERSION" ]; then
        version=$(cat "$SKILL_DIR/VERSION" 2>/dev/null | tr -d '[:space:]')
    fi

    echo "$version"
}

# --- Resolve SKILL_DIR for version detection ---
# When called directly: SKILL_DIR is the parent of the directory containing track.sh (i.e. skill root)
# When called via report.sh: SKILL_DIR is already set by the caller
if [ -z "${SKILL_DIR:-}" ]; then
    SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

# --- Build event mapValue ---
build_map_value() {
    local skill_name="$1"
    local platform="$2"
    local platform_context="$3"
    local custom_data="$4"

    # Use skill_ prefix for platform/os/user to avoid Beacon reserved field conflict
    local map_value=""
    map_value="\"skill_name\":\"$(replace_symbol "$skill_name")\""
    map_value="$map_value,\"skill_platform\":\"$(replace_symbol "$platform")\""

    # skill_user: person-level UV via whoami
    local skill_user=""
    skill_user=$(collect_skill_user)
    map_value="$map_value,\"skill_user\":\"$(replace_symbol "$skill_user")\""

    # skill_version: from config files (omit if not found)
    local skill_version=""
    skill_version=$(collect_skill_version)
    if [ -n "$skill_version" ]; then
        map_value="$map_value,\"skill_version\":\"$(replace_symbol "$skill_version")\""
    fi

    # Add platform context (includes skill_os, arch, etc.)
    if [ -n "$platform_context" ]; then
        map_value="$map_value,$platform_context"
    fi

    # Merge custom data if provided
    if [ -n "$custom_data" ]; then
        local stripped=""
        stripped=$(echo "$custom_data" | sed 's/^[[:space:]]*{//;s/}[[:space:]]*$//')
        if [ -n "$stripped" ]; then
            map_value="$map_value,$stripped"
        fi
    fi

    echo "{$map_value}"
}

# --- Main ---
main() {
    local a2=""
    a2=$(generate_a2)

    local platform=""
    platform=$(detect_platform)

    local platform_context=""
    platform_context=$(collect_platform_context "$platform")

    local event_time=""
    if date +%s%3N &>/dev/null 2>&1; then
        event_time=$(date +%s%3N 2>/dev/null)
        if echo "$event_time" | grep -q "N"; then
            event_time="$(date +%s)000"
        fi
    else
        event_time="$(date +%s)000"
    fi

    local map_value=""
    map_value=$(build_map_value "$SKILL_NAME" "$platform" "$platform_context" "$CUSTOM_DATA")

    # Build common: A2 always present, A1 only when USER_ID is set
    local common_fields=""
    if [ -n "$USER_ID" ]; then
        common_fields="\"A1\": \"$(replace_symbol "$USER_ID")\", \"A2\": \"${a2}\""
    else
        common_fields="\"A2\": \"${a2}\""
    fi

    local body=""
    body=$(cat <<EOF
{
    "appVersion": "${APP_VERSION}",
    "sdkId": "${SDK_ID}",
    "sdkVersion": "${SDK_VERSION}",
    "mainAppKey": "$(replace_symbol "$APP_KEY")",
    "platformId": ${PLATFORM_ID},
    "common": {
        ${common_fields}
    },
    "events": [
        {
            "eventCode": "$(replace_symbol "$EVENT_NAME")",
            "eventTime": "${event_time}",
            "mapValue": ${map_value}
        }
    ]
}
EOF
)

    curl -s -o /dev/null \
        --max-time "$TIMEOUT_SECONDS" \
        -X POST "$BEACON_URL" \
        -H "Content-Type: application/json;charset=UTF-8" \
        -d "$body" 2>/dev/null || true

    exit 0
}

main
