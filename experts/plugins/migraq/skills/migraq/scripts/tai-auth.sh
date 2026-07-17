#!/usr/bin/env bash
#
# tai-auth.sh - OAuth2 PAR auth for *.woa.com domains (Mac/Linux)
# Zero external dependencies version - no jq required!
#
# 通用 Bearer 认证代理：拿到 OAuth2 access_token 后，按 -m / -b / -H
# 原样透传 HTTP 请求到目标 URL。天然兼容"在太湖上注册为 MCP，但实际暴露
# 非 MCP 协议（如 /cgi/* 业务 REST API）"的场景。
#
# Usage:
#   # 标准 MCP 端点
#   ./tai-auth.sh -u "http://mcp-tai.it.woa.com/mcp" -m POST -b '{}'
#
#   # 非标准业务 REST（注册了 MCP 但其实是 REST）
#   ./tai-auth.sh -u "https://page-record.mcp.it.woa.com/cgi/team/getTeamList?onlyShowMyTeam=1"
#
#   # 探测目标是否为标准 MCP
#   ./tai-auth.sh -u "https://page-record.mcp.it.woa.com/mcp" --probe-mcp
#

set -e

# ===== Configuration =====
DEFAULT_OAUTH2_BASE="https://iam.it.woa.com"
DEFAULT_CLIENT_ID="taihu_proxy_client"
DEFAULT_SCOPE="*"             # 使用 scope=* 授权所有资源，服务端宽松验证可复用于其他 *.woa.com 服务
CONFIG_DIR="$HOME/.workbuddy/config/tof4-auth"
TOKEN_CACHE_PATH="$CONFIG_DIR/tokens.json"
PENDING_AUTH_PATH="$CONFIG_DIR/pending-auth.json"
MCP_SESSION_DIR="$CONFIG_DIR/mcp-sessions"
POLL_INTERVAL_SEC=3
POLL_MAX_ATTEMPTS=100
MAX_RETRIES=3
GLOBAL_SCOPE_KEY="__global_scope_star__"

# ===== Logging =====
log() { echo "[tai-auth] $*" >&2; }
log_error() { echo "[tai-auth] ✗ $*" >&2; }

# ===== String Utils (Bash 3.2+ compatible) =====
to_upper() {
    local str="$1"
    if [[ "${BASH_VERSINFO[0]}" -ge 4 ]]; then
        echo "${str^^}"
    else
        echo "$str" | tr '[:lower:]' '[:upper:]'
    fi
}

# ===== Dependency Check =====
check_deps() {
    local missing=()
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v openssl >/dev/null 2>&1 || missing+=("openssl")
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        log_error "Install with: brew install ${missing[*]}  (macOS)"
        log_error "         or: apt install ${missing[*]}    (Ubuntu/Debian)"
        exit 1
    fi
}

# ===== Pure Bash JSON Parser =====
# Extract a string value from JSON by key (simple flat JSON only)
json_get() {
    local json="$1"
    local key="$2"
    # Match "key": "value" or "key": number or "key": true/false/null
    local result
    # Try string value first
    result=$(echo "$json" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    if [[ -n "$result" ]]; then
        echo "$result"
        return 0
    fi
    # Try number/boolean/null
    result=$(echo "$json" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*\([^,}"[:space:]]*\).*/\1/p' | head -1)
    if [[ -n "$result" && "$result" != "null" ]]; then
        echo "$result"
        return 0
    fi
    return 1
}

# Extract array value (returns comma-separated for simple arrays)
json_get_array() {
    local json="$1"
    local key="$2"
    # Extract array content between [ ]
    local arr
    arr=$(echo "$json" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' | head -1)
    # Remove quotes and spaces
    echo "$arr" | tr -d '"' | tr ',' '\n' | xargs | tr ' ' ','
}

# Build simple JSON object
# Usage: json_build key1 value1 key2 value2 ...
# Values that are integers, "true", "false", or "null" are output unquoted (as JSON numbers/booleans/null).
# All other values are output as JSON strings.
# To force a numeric-looking value to be a string, wrap it: json_build "code" '"200"'
json_build() {
    local result="{"
    local first=true
    while [[ $# -ge 2 ]]; do
        local key="$1"
        local value="$2"
        shift 2

        if [[ "$first" == "true" ]]; then
            first=false
        else
            result+=","
        fi

        if [[ "$value" =~ ^-?[0-9]+$ ]] || [[ "$value" == "true" ]] || [[ "$value" == "false" ]] || [[ "$value" == "null" ]]; then
            result+="\"$key\":$value"
        else
            result+="\"$key\":\"$value\""
        fi
    done
    result+="}"
    echo "$result"
}

# ===== PKCE Functions =====
generate_pkce() {
    local verifier
    verifier=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
    
    local challenge
    challenge=$(echo -n "$verifier" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
    
    echo "$verifier $challenge"
}

generate_state() {
    openssl rand -hex 8
}

# ===== URL Encoding (Pure Bash) =====
urlencode() {
    local string="$1"
    local strlen=${#string}
    local encoded=""
    local pos c o
    
    for (( pos=0 ; pos<strlen ; pos++ )); do
        c=${string:$pos:1}
        case "$c" in
            [-_.~a-zA-Z0-9] ) o="$c" ;;
            * ) printf -v o '%%%02X' "'$c" ;;
        esac
        encoded+="$o"
    done
    echo "$encoded"
}

# ===== File Operations =====
ensure_config_dir() {
    mkdir -p "$CONFIG_DIR"
}

# ===== Pending Auth Management =====
save_pending_auth() {
    local req_uri="$1"
    local code_verifier="$2"
    ensure_config_dir
    
    local created_at
    created_at=$(date +%s)000
    
    # Simple JSON structure for pending auth
    # We store one entry at a time for simplicity
    cat > "$PENDING_AUTH_PATH" <<EOF
{
  "$req_uri": {
    "code_verifier": "$code_verifier",
    "created_at": $created_at
  }
}
EOF
}

get_pending_auth() {
    local req_uri="$1"
    if [[ ! -f "$PENDING_AUTH_PATH" ]]; then
        return 1
    fi
    
    local content
    content=$(cat "$PENDING_AUTH_PATH")
    
    # Extract code_verifier for the given request_uri
    local verifier
    verifier=$(echo "$content" | grep -A2 "\"$req_uri\"" | grep "code_verifier" | sed 's/.*"code_verifier"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    
    if [[ -z "$verifier" ]]; then
        return 1
    fi
    
    # Clear the file after reading
    echo '{}' > "$PENDING_AUTH_PATH"
    
    echo "$verifier"
}

# ===== Token Cache Management =====
read_token_cache() {
    if [[ -f "$TOKEN_CACHE_PATH" ]]; then
        cat "$TOKEN_CACHE_PATH"
    else
        echo '{"entries":[]}'
    fi
}

write_token_cache() {
    ensure_config_dir
    echo "$1" > "$TOKEN_CACHE_PATH"
}

# Parse a single token entry from the cache
# Returns: access_token|refresh_token|expires_at|client_id|resource
parse_token_entry() {
    local entry="$1"
    local access_token refresh_token expires_at client_id resource
    
    access_token=$(json_get "$entry" "access_token")
    refresh_token=$(json_get "$entry" "refresh_token" || echo "")
    expires_at=$(json_get "$entry" "expires_at")
    client_id=$(json_get "$entry" "client_id")
    resource=$(json_get_array "$entry" "resource")
    
    echo "$access_token|$refresh_token|$expires_at|$client_id|$resource"
}

# Build cache key for lookup
get_cache_key() {
    local client_id="$1"
    local resource="$2"
    echo "${client_id}::${resource}"
}

get_global_cache_key() {
    local client_id="$1"
    echo "${client_id}::${GLOBAL_SCOPE_KEY}"
}

# Extract all entries from cache as newline-separated JSON objects
extract_cache_entries() {
    local cache="$1"
    # Remove newlines, extract entries array, split by },{ 
    echo "$cache" | tr '\n' ' ' | \
        sed 's/.*"entries"[[:space:]]*:[[:space:]]*\[\(.*\)\].*/\1/' | \
        sed 's/},{/}\n{/g'
}

get_cached_token() {
    local target_client_id="$1"
    local target_resource="$2"
    
    local cache
    cache=$(read_token_cache)
    
    # Extract entries
    local entries_raw
    entries_raw=$(echo "$cache" | tr '\n' ' ' | sed 's/.*"entries"[[:space:]]*:[[:space:]]*\[\(.*\)\].*/\1/')
    
    if [[ -z "$entries_raw" || "$entries_raw" == "$cache" || "$entries_raw" == "" ]]; then
        return 1
    fi
    
    # Split entries by },{ and iterate
    local IFS_OLD="$IFS"
    # Replace },{ with a delimiter we can split on
    local entries_split
    entries_split=$(echo "$entries_raw" | sed 's/},{/}|ENTRY_SEP|{/g')
    
    IFS='|'
    local found_entry=""
    
    # Read entries
    while IFS= read -r part; do
        [[ "$part" == "ENTRY_SEP" ]] && continue
        [[ -z "$part" ]] && continue
        
        local entry="$part"
        
        # Get client_id from this entry
        local entry_client_id
        entry_client_id=$(json_get "$entry" "client_id" || echo "")
        
        if [[ "$entry_client_id" != "$target_client_id" ]]; then
            continue
        fi
        
        # Get resource from this entry
        local entry_resource
        entry_resource=$(json_get_array "$entry" "resource" || echo "")
        
        # Check if resource matches (could be comma-separated list)
        if [[ "$entry_resource" == "$target_resource" ]] || [[ "$entry_resource" == *"$target_resource"* ]]; then
            found_entry="$entry"
            break
        fi
    done <<< "$(echo "$entries_split" | tr '|' '\n')"
    
    IFS="$IFS_OLD"
    
    if [[ -z "$found_entry" ]]; then
        return 1
    fi
    
    echo "$found_entry"
}

get_global_cached_token() {
    local target_client_id="$1"
    get_cached_token "$target_client_id" "$GLOBAL_SCOPE_KEY"
}

save_token() {
    local client_id="$1"
    local resource="$2"
    local access_token="$3"
    local refresh_token="$4"
    local expires_in="${5:-3600}"
    local also_save_global="${6:-true}"
    
    local now_ms
    now_ms=$(($(date +%s) * 1000))
    local expires_at=$((now_ms + expires_in * 1000))
    
    # Build new entry for resource-specific
    local new_entry
    if [[ -n "$refresh_token" ]]; then
        new_entry="{\"client_id\":\"$client_id\",\"resource\":[\"$resource\"],\"access_token\":\"$access_token\",\"refresh_token\":\"$refresh_token\",\"expires_at\":$expires_at}"
    else
        new_entry="{\"client_id\":\"$client_id\",\"resource\":[\"$resource\"],\"access_token\":\"$access_token\",\"expires_at\":$expires_at}"
    fi
    
    # Build global entry
    local global_entry
    if [[ -n "$refresh_token" ]]; then
        global_entry="{\"client_id\":\"$client_id\",\"resource\":[\"$GLOBAL_SCOPE_KEY\"],\"access_token\":\"$access_token\",\"refresh_token\":\"$refresh_token\",\"expires_at\":$expires_at}"
    else
        global_entry="{\"client_id\":\"$client_id\",\"resource\":[\"$GLOBAL_SCOPE_KEY\"],\"access_token\":\"$access_token\",\"expires_at\":$expires_at}"
    fi
    
    # Read existing cache and merge entries
    local cache
    cache=$(read_token_cache)
    
    local entries_raw
    entries_raw=$(echo "$cache" | tr '\n' ' ' | sed 's/.*"entries"[[:space:]]*:[[:space:]]*\[\(.*\)\].*/\1/')
    
    # Collect existing entries that don't match our keys
    local kept_entries=""
    local resource_key
    resource_key=$(get_cache_key "$client_id" "$resource")
    local global_key
    global_key=$(get_global_cache_key "$client_id")
    
    if [[ -n "$entries_raw" && "$entries_raw" != "$cache" && "$entries_raw" != "" ]]; then
        # Split entries
        local entries_split
        entries_split=$(echo "$entries_raw" | sed 's/},{/}|ENTRY_SEP|{/g')
        
        while IFS= read -r part; do
            [[ "$part" == "ENTRY_SEP" ]] && continue
            [[ -z "$part" ]] && continue
            
            local entry="$part"
            local entry_client_id
            entry_client_id=$(json_get "$entry" "client_id" || echo "")
            local entry_resource
            entry_resource=$(json_get_array "$entry" "resource" || echo "")
            
            local entry_key
            entry_key=$(get_cache_key "$entry_client_id" "$entry_resource")
            
            # Skip if this is the resource we're updating or the global key we're updating
            if [[ "$entry_key" == "$resource_key" ]]; then
                continue
            fi
            if [[ "$also_save_global" == "true" && "$entry_key" == "$global_key" ]]; then
                continue
            fi
            
            # Keep this entry
            if [[ -n "$kept_entries" ]]; then
                kept_entries="${kept_entries},${entry}"
            else
                kept_entries="$entry"
            fi
        done <<< "$(echo "$entries_split" | tr '|' '\n')"
    fi
    
    # Build final entries list
    local final_entries=""
    
    # Add kept entries first
    if [[ -n "$kept_entries" ]]; then
        final_entries="$kept_entries"
    fi
    
    # Add new resource entry
    if [[ -n "$final_entries" ]]; then
        final_entries="${final_entries},${new_entry}"
    else
        final_entries="$new_entry"
    fi
    
    # Add global entry if needed
    if [[ "$also_save_global" == "true" ]]; then
        final_entries="${final_entries},${global_entry}"
    fi
    
    # Write merged cache
    local new_cache="{\"entries\":[$final_entries]}"
    write_token_cache "$new_cache"
}

# Remove a specific cache entry (and optionally the global one that
# typically shares the same access_token). Used when the server rejects
# a locally-cached token (e.g. user unbound the app authorization on Taihu).
remove_cached_token() {
    local client_id="$1"
    local resource="$2"
    local also_remove_global="${3:-false}"
    
    if [[ ! -f "$TOKEN_CACHE_PATH" ]]; then
        return 0
    fi
    
    local cache
    cache=$(read_token_cache)
    
    local entries_raw
    entries_raw=$(echo "$cache" | tr '\n' ' ' | sed 's/.*"entries"[[:space:]]*:[[:space:]]*\[\(.*\)\].*/\1/')
    
    if [[ -z "$entries_raw" || "$entries_raw" == "$cache" ]]; then
        return 0
    fi
    
    local resource_key
    resource_key=$(get_cache_key "$client_id" "$resource")
    local global_key
    global_key=$(get_global_cache_key "$client_id")
    
    local entries_split
    entries_split=$(echo "$entries_raw" | sed 's/},{/}|ENTRY_SEP|{/g')
    
    local kept=""
    while IFS= read -r part; do
        [[ "$part" == "ENTRY_SEP" ]] && continue
        [[ -z "$part" ]] && continue
        
        local entry="$part"
        local entry_client_id entry_resource entry_key
        entry_client_id=$(json_get "$entry" "client_id" || echo "")
        entry_resource=$(json_get_array "$entry" "resource" || echo "")
        entry_key=$(get_cache_key "$entry_client_id" "$entry_resource")
        
        if [[ "$entry_key" == "$resource_key" ]]; then
            continue
        fi
        if [[ "$also_remove_global" == "true" && "$entry_key" == "$global_key" ]]; then
            continue
        fi
        
        if [[ -n "$kept" ]]; then
            kept="${kept},${entry}"
        else
            kept="$entry"
        fi
    done <<< "$(echo "$entries_split" | tr '|' '\n')"
    
    write_token_cache "{\"entries\":[$kept]}"
}

# ===== OAuth2 Functions =====
invoke_par() {
    local base="$1"
    local client_id="$2"
    local resource="$3"
    local challenge="$4"
    local state="$5"
    local scope="$6"
    local app_name="$7"
    
    local body="client_id=$(urlencode "$client_id")"
    body+="&response_type=code"
    body+="&code_challenge=$(urlencode "$challenge")"
    body+="&code_challenge_method=S256"
    body+="&state=$(urlencode "$state")"
    
    IFS=',' read -ra res_arr <<< "$resource"
    for r in "${res_arr[@]}"; do
        r=$(echo "$r" | xargs)
        if [[ -n "$r" ]]; then
            body+="&resource=$(urlencode "$r")"
        fi
    done
    
    if [[ -n "$scope" ]]; then
        body+="&scope=$(urlencode "$scope")"
    fi
    
    if [[ -n "$app_name" ]]; then
        body+="&app_name=$(urlencode "$app_name")"
    fi
    
    curl -s -X POST "$base/oauth2/par" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "$body"
}

wait_for_auth() {
    local base="$1"
    local client_id="$2"
    local req_uri="$3"
    
    log "Waiting for authorization... (timeout: 5 min)"
    
    local enc_req_uri enc_client_id poll_url
    enc_req_uri=$(urlencode "$req_uri")
    enc_client_id=$(urlencode "$client_id")
    poll_url="$base/oauth2/par/poll?request_uri=$enc_req_uri&client_id=$enc_client_id"
    
    for ((i=0; i<POLL_MAX_ATTEMPTS; i++)); do
        sleep "$POLL_INTERVAL_SEC"
        
        local resp http_code
        resp=$(curl -s -w "\n%{http_code}" "$poll_url")
        http_code=$(echo "$resp" | tail -1)
        resp=$(echo "$resp" | sed '$d')
        
        if [[ "$http_code" == "404" ]]; then
            log_error "Auth request expired"
            exit 1
        fi
        
        local status
        status=$(json_get "$resp" "status" || echo "")
        
        if [[ "$status" == "completed" ]]; then
            local code redirect_uri
            code=$(json_get "$resp" "code" || echo "")
            redirect_uri=$(json_get "$resp" "redirect_uri" || echo "")
            
            if [[ -z "$code" ]]; then
                log_error "Auth completed but no code returned"
                exit 1
            fi
            
            echo "$code $redirect_uri"
            return 0
        elif [[ "$status" == "error" ]]; then
            local error_desc
            error_desc=$(json_get "$resp" "error_description" || echo "Unknown error")
            log_error "Auth failed: $error_desc"
            exit 1
        fi
    done
    
    log_error "Auth timeout"
    exit 1
}

invoke_token_exchange() {
    local base="$1"
    local client_id="$2"
    local code="$3"
    local redirect_uri="$4"
    local verifier="$5"
    
    local body="grant_type=authorization_code"
    body+="&code=$(urlencode "$code")"
    body+="&client_id=$(urlencode "$client_id")"
    body+="&redirect_uri=$(urlencode "$redirect_uri")"
    body+="&code_verifier=$(urlencode "$verifier")"
    
    curl -s -X POST "$base/oauth2/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "$body"
}

invoke_token_refresh() {
    local base="$1"
    local client_id="$2"
    local refresh_token="$3"
    
    local body="grant_type=refresh_token"
    body+="&refresh_token=$(urlencode "$refresh_token")"
    body+="&client_id=$(urlencode "$client_id")"
    
    local response http_code
    response=$(curl -s -w "\n%{http_code}" -X POST "$base/oauth2/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "$body")
    http_code=$(echo "$response" | tail -1)
    response=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "400" ]]; then
        local error_type
        error_type=$(json_get "$response" "error" || echo "")
        if [[ "$error_type" == "invalid_grant" ]] || [[ "$error_type" == "invalid_token" ]]; then
            log_error "refresh_token invalid, please re-authorize"
            return 1
        fi
    fi
    
    if [[ "$http_code" != "200" ]]; then
        return 1
    fi
    
    echo "$response"
}

get_valid_token() {
    local base="$1"
    local client_id="$2"
    local resource="$3"
    
    local entry
    if ! entry=$(get_cached_token "$client_id" "$resource"); then
        return 1
    fi
    
    local now_ms
    now_ms=$(($(date +%s) * 1000))
    local expires_at
    expires_at=$(json_get "$entry" "expires_at")
    local remaining=$(( (expires_at - now_ms) / 1000 ))
    local remaining_min=$(( remaining / 60 ))
    
    # Token still valid (> 60 seconds remaining)
    if [[ $remaining -gt 60 ]]; then
        log "Using cached token (expires in: ${remaining_min} min)"
        json_get "$entry" "access_token"
        return 0
    fi
    
    # Token expiring soon or expired, try to refresh
    local refresh_token
    refresh_token=$(json_get "$entry" "refresh_token" || echo "")
    
    if [[ -n "$refresh_token" ]]; then
        log "Token expiring soon, refreshing..."
        
        local tok_resp
        if tok_resp=$(invoke_token_refresh "$base" "$client_id" "$refresh_token"); then
            local access_token new_refresh expires_in
            access_token=$(json_get "$tok_resp" "access_token" || echo "")
            new_refresh=$(json_get "$tok_resp" "refresh_token" || echo "")
            expires_in=$(json_get "$tok_resp" "expires_in" || echo "3600")
            
            if [[ -n "$access_token" ]]; then
                save_token "$client_id" "$resource" "$access_token" "$new_refresh" "$expires_in"
                log "Token refreshed successfully"
                echo "$access_token"
                return 0
            fi
        fi
        log "Token refresh failed, need re-auth"
        return 1
    fi
    
    # No refresh_token but token not yet expired - still return it with warning
    if [[ $remaining -gt 0 ]]; then
        log "Token expiring soon ($remaining sec) and no refresh_token"
        json_get "$entry" "access_token"
        return 0
    fi
    
    log "Token expired and no refresh_token"
    return 1
}

get_valid_global_token() {
    local base="$1"
    local client_id="$2"
    
    local entry
    if ! entry=$(get_global_cached_token "$client_id"); then
        return 1
    fi
    
    local now_ms
    now_ms=$(($(date +%s) * 1000))
    local expires_at
    expires_at=$(json_get "$entry" "expires_at")
    local remaining=$(( (expires_at - now_ms) / 1000 ))
    local remaining_min=$(( remaining / 60 ))
    
    # Token still valid (> 60 seconds remaining)
    if [[ $remaining -gt 60 ]]; then
        log "Using global scope=* token (expires in: ${remaining_min} min)"
        json_get "$entry" "access_token"
        return 0
    fi
    
    # Token expiring soon or expired, try to refresh
    local refresh_token
    refresh_token=$(json_get "$entry" "refresh_token" || echo "")
    
    if [[ -n "$refresh_token" ]]; then
        log "Global token expiring soon, refreshing..."
        
        local tok_resp
        if tok_resp=$(invoke_token_refresh "$base" "$client_id" "$refresh_token"); then
            local access_token new_refresh expires_in
            access_token=$(json_get "$tok_resp" "access_token" || echo "")
            new_refresh=$(json_get "$tok_resp" "refresh_token" || echo "")
            expires_in=$(json_get "$tok_resp" "expires_in" || echo "3600")
            
            if [[ -n "$access_token" ]]; then
                save_token "$client_id" "$GLOBAL_SCOPE_KEY" "$access_token" "$new_refresh" "$expires_in" "false"
                log "Global token refreshed successfully"
                echo "$access_token"
                return 0
            fi
        fi
        log "Global token refresh failed"
        return 1
    fi
    
    # No refresh_token but token not yet expired
    if [[ $remaining -gt 0 ]]; then
        log "Global token expiring soon ($remaining sec) and no refresh_token"
        json_get "$entry" "access_token"
        return 0
    fi
    
    return 1
}

test_woa_domain() {
    local url="$1"
    local host
    host=$(echo "$url" | sed -E 's|^https?://([^/:]+).*|\1|')
    
    if [[ "$host" == "woa.com" ]] || [[ "$host" == *.woa.com ]]; then
        return 0
    fi
    return 1
}

# 从 URL 提取 resource（包含 scheme + host + path）
get_resource_from_url() {
    local url="$1"
    # 提取 scheme://host/path，去掉 query string
    echo "$url" | sed -E 's|^(https?://[^?#]+).*|\1|'
}

open_browser() {
    local url="$1"
    if [[ "$(uname)" == "Darwin" ]]; then
        open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url"
    elif command -v gnome-open >/dev/null 2>&1; then
        gnome-open "$url"
    else
        log "Please open this URL manually: $url"
    fi
}

# ===== MCP Session Management =====
# Get a stable hash for a URL to use as session cache filename
get_session_cache_key() {
    local url="$1"
    # Extract scheme + host as session key (sessions are per-host)
    local host
    host=$(echo "$url" | sed -E 's|^(https?://[^/:]+).*|\1|')
    # Use a simple hash (md5 or fallback to sha256)
    if command -v md5sum >/dev/null 2>&1; then
        echo -n "$host" | md5sum | cut -d' ' -f1
    elif command -v md5 >/dev/null 2>&1; then
        echo -n "$host" | md5
    else
        echo -n "$host" | openssl dgst -md5 | awk '{print $NF}'
    fi
}

get_mcp_session_path() {
    local url="$1"
    local key
    key=$(get_session_cache_key "$url")
    echo "$MCP_SESSION_DIR/$key"
}

# Read cached MCP Session-Id for a URL (with 10-minute TTL)
get_cached_mcp_session() {
    local url="$1"
    local session_path
    session_path=$(get_mcp_session_path "$url")
    if [[ -f "$session_path" ]]; then
        local content
        content=$(cat "$session_path")
        # If marked as "no-session", server doesn't support sessions
        if [[ "$content" == "__NO_SESSION__" ]]; then
            echo ""
            return 0
        fi
        # Check TTL: session cache expires after 10 minutes (600 seconds)
        local now_epoch file_epoch age_sec
        now_epoch=$(date +%s)
        if [[ "$(uname)" == "Darwin" ]]; then
            file_epoch=$(stat -f '%m' "$session_path" 2>/dev/null || echo "0")
        else
            file_epoch=$(stat -c '%Y' "$session_path" 2>/dev/null || echo "0")
        fi
        age_sec=$((now_epoch - file_epoch))
        if [[ $age_sec -gt 600 ]]; then
            log "MCP Session: cached session expired (age: $((age_sec / 60)) min > 10 min TTL), removing..."
            rm -f "$session_path"
            return 0
        fi
        echo "$content"
    fi
}

# Save MCP Session-Id for a URL
save_mcp_session() {
    local url="$1"
    local session_id="$2"
    mkdir -p "$MCP_SESSION_DIR"
    local session_path
    session_path=$(get_mcp_session_path "$url")
    echo "$session_id" > "$session_path"
}

# Remove cached MCP Session-Id for a URL
remove_mcp_session() {
    local url="$1"
    local session_path
    session_path=$(get_mcp_session_path "$url")
    rm -f "$session_path"
}

# Perform MCP initialize handshake and cache Session-Id
# Returns 0 on success, 1 on failure
# On success, the session_id is saved to cache
# If server doesn't return session-id, saves "__NO_SESSION__" marker to avoid repeated init attempts
mcp_initialize() {
    local url="$1"
    local access_token="$2"
    
    local init_body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"tai-auth","version":"1.0.0"}}}'
    
    log "MCP Session: initializing..."
    
    # Send initialize request, capture response headers
    local response
    response=$(curl -s -D - -X POST "$url" \
        -H "Authorization: Bearer $access_token" \
        -H "Content-Type: application/json; charset=utf-8" \
        -H "Accept: application/json, text/event-stream" \
        -d "$init_body" 2>&1) || true
    
    # Extract Mcp-Session-Id from response headers (case-insensitive)
    local session_id
    session_id=$(echo "$response" | grep -i "^mcp-session-id:" | head -1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r\n')
    
    if [[ -z "$session_id" ]]; then
        log "MCP Session: no Mcp-Session-Id in response (server is stateless/sessionless)"
        # Mark this server as not requiring sessions to avoid repeated init attempts
        save_mcp_session "$url" "__NO_SESSION__"
        return 1
    fi
    
    log "MCP Session: got session-id"
    save_mcp_session "$url" "$session_id"
    
    # Send notifications/initialized
    curl -s -X POST "$url" \
        -H "Authorization: Bearer $access_token" \
        -H "Content-Type: application/json; charset=utf-8" \
        -H "Mcp-Session-Id: $session_id" \
        -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null 2>&1 || true
    
    log "MCP Session: initialized successfully"
    return 0
}

# Ensure MCP session is available for a URL
# If cached session exists, use it; otherwise initialize
# Outputs session_id to stdout (or empty if server doesn't use sessions)
ensure_mcp_session() {
    local url="$1"
    local access_token="$2"
    
    local session_id
    session_id=$(get_cached_mcp_session "$url")
    
    if [[ -n "$session_id" ]]; then
        echo "$session_id"
        return 0
    fi
    
    # Check if session cache file exists but returned empty (means __NO_SESSION__ marker is set)
    local session_path
    session_path=$(get_mcp_session_path "$url")
    if [[ -f "$session_path" ]]; then
        local content
        content=$(cat "$session_path")
        if [[ "$content" == "__NO_SESSION__" ]]; then
            # Server confirmed stateless, skip session management
            return 0
        fi
    fi
    
    # No cached session, initialize
    if mcp_initialize "$url" "$access_token"; then
        session_id=$(get_cached_mcp_session "$url")
        echo "$session_id"
        return 0
    fi
    
    # Server doesn't require sessions (mcp_initialize already saved __NO_SESSION__ marker)
    return 0
}

# Detect MCP endpoint by checking if the request body conforms to
# JSON-RPC 2.0 protocol with an MCP-specific method name, rather than
# relying on the URL path containing "/mcp".
#
# MCP protocol = JSON-RPC 2.0, so a valid MCP request body must:
#   1. Contain "jsonrpc" field (JSON-RPC 2.0 marker)
#   2. Contain a "method" field whose value is a known MCP method
#
# Known MCP methods (per MCP spec):
#   - initialize, notifications/initialized, ping
#   - tools/list, tools/call
#   - resources/list, resources/read, resources/subscribe, resources/unsubscribe
#   - prompts/list, prompts/get
#   - logging/setLevel
#   - completion/complete
#   - roots/list
#   - sampling/createMessage
#   - elicitation/create
is_mcp_endpoint() {
    local url="$1"
    local body="$2"

    # No body means it cannot be an MCP JSON-RPC request
    [[ -z "$body" ]] && return 1

    # Must contain "jsonrpc" (JSON-RPC 2.0 marker)
    [[ "$body" != *'"jsonrpc"'* ]] && return 1

    # Match "method" field with a known MCP method namespace
    # This covers all standard MCP method namespaces
    if echo "$body" | grep -qE '"method"\s*:\s*"(initialize|ping|notifications/|tools/|resources/|prompts/|logging/|completion/|roots/|sampling/|elicitation/)'; then
        return 0
    fi
    return 1
}

# ===== HTTP Request with Retry =====
# do_request prints the response body to stdout.
# The final HTTP status code is written to the file path in $LAST_HTTP_CODE_FILE
# (if set) so the caller can distinguish 401 from other failures reliably.
do_request() {
    local url="$1"
    local method="$2"
    local body="$3"
    local access_token="$4"
    shift 4
    local -a extra_headers=("$@")
    
    local retry_delay_sec=1
    
    local -a curl_args=(-s -w "\n%{http_code}")
    curl_args+=(-X "$method")
    curl_args+=(-H "Authorization: Bearer $access_token")
    curl_args+=(-H "Accept: application/json, text/event-stream")
    
    for h in "${extra_headers[@]}"; do
        curl_args+=(-H "$h")
    done
    
    if [[ -n "$body" ]]; then
        local has_content_type=false
        for h in "${extra_headers[@]}"; do
            if [[ "$h" == Content-Type:* ]]; then
                has_content_type=true
                break
            fi
        done
        if [[ "$has_content_type" == "false" ]]; then
            curl_args+=(-H "Content-Type: application/json; charset=utf-8")
        fi
        curl_args+=(-d "$body")
    fi
    
    curl_args+=("$url")
    
    local last_code=""
    for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
        local response http_code
        response=$(curl "${curl_args[@]}" 2>&1) || true
        http_code=$(echo "$response" | tail -1)
        response=$(echo "$response" | sed '$d')
        last_code="$http_code"
        
        if [[ "$http_code" =~ ^4[0-9][0-9]$ ]] && [[ "$http_code" != "408" ]] && [[ "$http_code" != "429" ]]; then
            log "Response: $http_code (client error, not retrying)"
            [[ -n "$LAST_HTTP_CODE_FILE" ]] && echo "$http_code" > "$LAST_HTTP_CODE_FILE"
            echo "$response"
            return 1
        fi
        
        if [[ "$http_code" =~ ^5[0-9][0-9]$ ]] || [[ "$http_code" == "408" ]] || [[ "$http_code" == "429" ]]; then
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                log "Response: $http_code (attempt $attempt/$MAX_RETRIES, retrying in ${retry_delay_sec}s...)"
                sleep "$retry_delay_sec"
                retry_delay_sec=$((retry_delay_sec * 2))
                continue
            else
                log "Response: $http_code (all $MAX_RETRIES attempts failed)"
                [[ -n "$LAST_HTTP_CODE_FILE" ]] && echo "$http_code" > "$LAST_HTTP_CODE_FILE"
                echo "$response"
                return 1
            fi
        fi
        
        if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
            log "Response: $http_code"
            [[ -n "$LAST_HTTP_CODE_FILE" ]] && echo "$http_code" > "$LAST_HTTP_CODE_FILE"
            echo "$response"
            return 0
        fi
        
        log "Response: $http_code"
        [[ -n "$LAST_HTTP_CODE_FILE" ]] && echo "$http_code" > "$LAST_HTTP_CODE_FILE"
        echo "$response"
        return 1
    done
    
    [[ -n "$LAST_HTTP_CODE_FILE" ]] && echo "$last_code" > "$LAST_HTTP_CODE_FILE"
    return 1
}

# ===== Usage =====
usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

OAuth2 PAR authentication for *.woa.com domains
Zero external dependencies - no jq required!

OPTIONS:
    -u, --url URL           Target URL (required for normal requests)
    -m, --method METHOD     HTTP method (default: GET)
    -b, --body BODY         Request body (JSON)
    -H, --header HEADER     Additional header (can be repeated)
    -c, --client-id ID      OAuth2 client ID (default: public_mcp_client)
    -r, --resource RES      OAuth2 resource (default: same as URL)
    -a, --app-name NAME     Application name for auth tracking (e.g., skill name)
    --oauth2-base URL       OAuth2 base URL (default: https://iam.it.woa.com)
    
    --start-auth            Start auth flow and exit (returns auth info as JSON)
    --wait-auth             Wait for auth completion
    --request-uri URI       Request URI (required with --wait-auth)
    --probe-mcp             Probe target URL with MCP initialize handshake,
                            report is_mcp=true/false (no business call made)
    
    -h, --help              Show this help message

EXAMPLES:
    # Standard MCP endpoint
    $(basename "$0") -u "http://mcp-tai.it.woa.com/mcp" -m POST -b '{"method":"..."}'

    # Non-MCP REST API (registered as MCP on Taihu but exposes REST)
    $(basename "$0") -u "https://page-record.mcp.it.woa.com/cgi/team/getTeamList?onlyShowMyTeam=1"

    # Probe whether /mcp is a real MCP endpoint
    $(basename "$0") -u "https://page-record.mcp.it.woa.com/mcp" --probe-mcp

    # Request with app name for tracking
    $(basename "$0") -u "http://mcp-tai.it.woa.com/mcp" -a "get-domain-owner" -m POST -b '...'

    # Two-phase auth (for AI assistant integration)
    $(basename "$0") --start-auth -u "http://mcp-tai.it.woa.com/mcp"
    $(basename "$0") --wait-auth --request-uri "urn:ietf:..." -u "http://mcp-tai.it.woa.com/mcp"

EOF
    exit 0
}

# ===== Main =====
main() {
    check_deps
    
    local url="" method="GET" body=""
    local -a headers=()
    local client_id="" resource="" oauth2_base="" app_name=""
    local start_auth=false wait_auth=false request_uri=""
    local probe_mcp=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -u|--url) url="$2"; shift 2 ;;
            -m|--method) method="$2"; shift 2 ;;
            -b|--body) body="$2"; shift 2 ;;
            -H|--header) headers+=("$2"); shift 2 ;;
            -c|--client-id) client_id="$2"; shift 2 ;;
            -r|--resource) resource="$2"; shift 2 ;;
            -a|--app-name) app_name="$2"; shift 2 ;;
            --oauth2-base) oauth2_base="$2"; shift 2 ;;
            --start-auth) start_auth=true; shift ;;
            --wait-auth) wait_auth=true; shift ;;
            --request-uri) request_uri="$2"; shift 2 ;;
            --probe-mcp) probe_mcp=true; shift ;;
            -h|--help) usage ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done
    
    oauth2_base="${oauth2_base:-${TOF4_OAUTH2_BASE:-$DEFAULT_OAUTH2_BASE}}"
    client_id="${client_id:-${TOF4_CLIENT_ID:-$DEFAULT_CLIENT_ID}}"
    app_name="${app_name:-${TOF4_APP_NAME:-}}"
    method=$(to_upper "$method")
    
    # Handle --start-auth
    if [[ "$start_auth" == "true" ]]; then
        if [[ -z "$url" ]]; then
            log_error "--start-auth requires --url"
            exit 1
        fi
        
        resource="${resource:-${TOF4_RESOURCE:-$(get_resource_from_url "$url")}}"
        local scope="${TOF4_SCOPE:-$DEFAULT_SCOPE}"
        
        local pkce_result
        pkce_result=$(generate_pkce)
        local verifier challenge
        verifier=$(echo "$pkce_result" | cut -d' ' -f1)
        challenge=$(echo "$pkce_result" | cut -d' ' -f2)
        local state
        state=$(generate_state)
        
        local par_resp
        par_resp=$(invoke_par "$oauth2_base" "$client_id" "$resource" "$challenge" "$state" "$scope" "$app_name")
        
        local req_uri expires_in
        req_uri=$(json_get "$par_resp" "request_uri")
        expires_in=$(json_get "$par_resp" "expires_in")
        
        local enc_cid enc_req_uri auth_url
        enc_cid=$(urlencode "$client_id")
        enc_req_uri=$(urlencode "$req_uri")
        auth_url="$oauth2_base/oauth2/authorize?client_id=$enc_cid&request_uri=$enc_req_uri"
        
        save_pending_auth "$req_uri" "$verifier"
        open_browser "$auth_url"
        
        # Output JSON response
        echo "{\"auth_required\":true,\"auth_url\":\"$auth_url\",\"request_uri\":\"$req_uri\",\"client_id\":\"$client_id\",\"resource\":\"$resource\",\"expires_in\":$expires_in}"
        exit 0
    fi
    
    # Handle --wait-auth
    if [[ "$wait_auth" == "true" ]]; then
        if [[ -z "$request_uri" ]]; then
            log_error "--wait-auth requires --request-uri"
            exit 1
        fi
        if [[ -z "$url" ]]; then
            log_error "--wait-auth requires --url"
            exit 1
        fi
        
        local verifier
        if ! verifier=$(get_pending_auth "$request_uri"); then
            log_error "No pending auth found, please restart"
            exit 1
        fi
        
        resource="${resource:-${TOF4_RESOURCE:-$(get_resource_from_url "$url")}}"
        
        local auth_result
        auth_result=$(wait_for_auth "$oauth2_base" "$client_id" "$request_uri")
        local code redirect_uri
        code=$(echo "$auth_result" | cut -d' ' -f1)
        redirect_uri=$(echo "$auth_result" | cut -d' ' -f2-)
        
        local tok_resp
        tok_resp=$(invoke_token_exchange "$oauth2_base" "$client_id" "$code" "$redirect_uri" "$verifier")
        
        local access_token refresh_token expires_in
        access_token=$(json_get "$tok_resp" "access_token")
        refresh_token=$(json_get "$tok_resp" "refresh_token" || echo "")
        expires_in=$(json_get "$tok_resp" "expires_in" || echo "3600")
        
        save_token "$client_id" "$resource" "$access_token" "$refresh_token" "$expires_in"
        log "Auth success! Token cached"
        
        echo '{"auth_success": true}'
        exit 0
    fi
    
    # Normal request mode
    if [[ -z "$url" ]]; then
        log_error "Missing --url"
        exit 1
    fi
    
    if ! test_woa_domain "$url"; then
        log_error "URL is not *.woa.com domain"
        exit 1
    fi
    
    resource="${resource:-${TOF4_RESOURCE:-$(get_resource_from_url "$url")}}"
    local scope="${TOF4_SCOPE:-$DEFAULT_SCOPE}"
    
    # Function to do full OAuth2 auth
    do_full_auth() {
        local pkce_result
        pkce_result=$(generate_pkce)
        local verifier challenge
        verifier=$(echo "$pkce_result" | cut -d' ' -f1)
        challenge=$(echo "$pkce_result" | cut -d' ' -f2)
        local state
        state=$(generate_state)
        
        local par_resp
        par_resp=$(invoke_par "$oauth2_base" "$client_id" "$resource" "$challenge" "$state" "$scope" "$app_name")
        
        local req_uri
        req_uri=$(json_get "$par_resp" "request_uri")
        
        local enc_cid enc_req_uri auth_url
        enc_cid=$(urlencode "$client_id")
        enc_req_uri=$(urlencode "$req_uri")
        auth_url="$oauth2_base/oauth2/authorize?client_id=$enc_cid&request_uri=$enc_req_uri"
        
        open_browser "$auth_url"
        
        echo "" >&2
        log "OAuth2 auth required (scope=*), please complete in browser"
        log "  $auth_url"
        echo "" >&2
        
        local auth_result
        auth_result=$(wait_for_auth "$oauth2_base" "$client_id" "$req_uri")
        local code redirect_uri
        code=$(echo "$auth_result" | cut -d' ' -f1)
        redirect_uri=$(echo "$auth_result" | cut -d' ' -f2-)
        
        local tok_resp
        tok_resp=$(invoke_token_exchange "$oauth2_base" "$client_id" "$code" "$redirect_uri" "$verifier")
        
        local new_access_token refresh_token expires_in
        new_access_token=$(json_get "$tok_resp" "access_token")
        refresh_token=$(json_get "$tok_resp" "refresh_token" || echo "")
        expires_in=$(json_get "$tok_resp" "expires_in" || echo "3600")
        
        save_token "$client_id" "$resource" "$new_access_token" "$refresh_token" "$expires_in"
        log "Auth success! Token cached (resource + global scope=*)"
        
        echo "$new_access_token"
    }
    
    # Token priority: 1. resource-specific -> 2. global scope=* -> 3. new auth
    local access_token
    local token_source="resource"
    
    if access_token=$(get_valid_token "$oauth2_base" "$client_id" "$resource"); then
        token_source="resource"
    elif access_token=$(get_valid_global_token "$oauth2_base" "$client_id"); then
        token_source="global"
    else
        access_token=$(do_full_auth)
        token_source="new"
    fi
    
    # ============================================================
    # ProbeMcp: 仅探测目标是否为标准 MCP 端点，不进行业务调用
    # ============================================================
    if [[ "$probe_mcp" == "true" ]]; then
        local probe_body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tai-auth-probe","version":"0.1"}}}'
        log "-> [Probe] POST $url (MCP initialize handshake)"
        
        local probe_resp probe_code
        probe_resp=$(curl -s -w "\n%{http_code}" -X POST "$url" \
            -H "Authorization: Bearer $access_token" \
            -H "Content-Type: application/json; charset=utf-8" \
            -H "Accept: application/json, text/event-stream" \
            -d "$probe_body" 2>&1) || true
        probe_code=$(echo "$probe_resp" | tail -1)
        probe_resp=$(echo "$probe_resp" | sed '$d')
        
        local is_mcp="false" reason=""
        if [[ "$probe_code" =~ ^2[0-9][0-9]$ ]]; then
            if echo "$probe_resp" | grep -q '"jsonrpc"[[:space:]]*:[[:space:]]*"2.0"' && \
               (echo "$probe_resp" | grep -q '"result"' || echo "$probe_resp" | grep -q '"error"'); then
                is_mcp="true"
                reason="JSON-RPC 2.0 response detected"
            else
                reason="2xx but not JSON-RPC 2.0 shape"
            fi
        else
            reason="HTTP $probe_code - endpoint not serving MCP protocol"
        fi
        
        local preview
        if [[ ${#probe_resp} -gt 500 ]]; then
            preview="${probe_resp:0:500}..."
        else
            preview="$probe_resp"
        fi
        # escape double quotes for JSON output
        preview=$(echo "$preview" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
        
        log "Probe result: is_mcp=$is_mcp ($reason)"
        echo "{\"url\":\"$url\",\"status\":$probe_code,\"is_mcp\":$is_mcp,\"reason\":\"$reason\",\"body_preview\":\"$preview\"}"
        exit 0
    fi
    
    # ============================================================
    # MCP Session Management: auto-initialize if target is MCP endpoint
    # ============================================================
    if is_mcp_endpoint "$url" "$body"; then
        local mcp_session_id
        mcp_session_id=$(ensure_mcp_session "$url" "$access_token")
        if [[ -n "$mcp_session_id" ]]; then
            headers+=("Mcp-Session-Id: $mcp_session_id")
        fi
    fi
    
    # Make the request
    log "-> $method $url"
    
    # Use a temp file to reliably receive the last HTTP status code out of do_request.
    local http_code_file
    http_code_file=$(mktemp 2>/dev/null || echo "$CONFIG_DIR/.last_http_code.$$")
    export LAST_HTTP_CODE_FILE="$http_code_file"
    
    local response
    response=$(do_request "$url" "$method" "$body" "$access_token" "${headers[@]}")
    local request_status=$?
    
    local last_http_code=""
    if [[ -f "$http_code_file" ]]; then
        last_http_code=$(cat "$http_code_file")
        rm -f "$http_code_file"
    fi
    unset LAST_HTTP_CODE_FILE
    
    # If 401 and we were using a cached token (resource or global), the server
    # may have revoked the authorization (e.g. user manually unbound the app on
    # Taihu). Purge stale entries and re-auth, then retry once.
    if [[ $request_status -ne 0 ]] && [[ "$last_http_code" == "401" ]] && [[ "$token_source" != "new" ]]; then
        log "Cached token rejected (401, source=$token_source). Server-side authorization may have been revoked."
        log "Purging stale token entries and re-authorizing..."
        remove_cached_token "$client_id" "$resource" "true"
        access_token=$(do_full_auth)
        token_source="new"
        
        # Re-initialize MCP session with new token
        if is_mcp_endpoint "$url" "$body"; then
            remove_mcp_session "$url"
            local new_session_id
            new_session_id=$(ensure_mcp_session "$url" "$access_token")
            # Update headers with new session id
            local -a retry_headers=()
            for h in "${headers[@]}"; do
                if [[ "$h" != Mcp-Session-Id:* ]]; then
                    retry_headers+=("$h")
                fi
            done
            if [[ -n "$new_session_id" ]]; then
                retry_headers+=("Mcp-Session-Id: $new_session_id")
            fi
            headers=("${retry_headers[@]}")
        fi
        
        log "-> $method $url"
        
        http_code_file=$(mktemp 2>/dev/null || echo "$CONFIG_DIR/.last_http_code.$$")
        export LAST_HTTP_CODE_FILE="$http_code_file"
        response=$(do_request "$url" "$method" "$body" "$access_token" "${headers[@]}")
        request_status=$?
        if [[ -f "$http_code_file" ]]; then
            last_http_code=$(cat "$http_code_file")
            rm -f "$http_code_file"
        fi
        unset LAST_HTTP_CODE_FILE
    fi
    
    # If 400 on MCP endpoint, session may have expired - re-initialize and retry once
    # But skip if server is already marked as stateless (no session)
    if [[ $request_status -ne 0 ]] && [[ "$last_http_code" == "400" ]] && is_mcp_endpoint "$url" "$body"; then
        local session_path_check
        session_path_check=$(get_mcp_session_path "$url")
        local is_stateless=false
        if [[ -f "$session_path_check" ]]; then
            local cached_content
            cached_content=$(cat "$session_path_check")
            if [[ "$cached_content" == "__NO_SESSION__" ]]; then
                is_stateless=true
            fi
        fi
        
        if [[ "$is_stateless" == "false" ]]; then
            log "MCP Session may have expired (400). Re-initializing..."
            remove_mcp_session "$url"
            local new_session_id
            new_session_id=$(ensure_mcp_session "$url" "$access_token")
            if [[ -n "$new_session_id" ]]; then
                # Update headers with new session id
                local -a retry_headers=()
                for h in "${headers[@]}"; do
                    if [[ "$h" != Mcp-Session-Id:* ]]; then
                        retry_headers+=("$h")
                    fi
                done
                retry_headers+=("Mcp-Session-Id: $new_session_id")
                headers=("${retry_headers[@]}")
                
                log "-> $method $url (retry with new session)"
                
                http_code_file=$(mktemp 2>/dev/null || echo "$CONFIG_DIR/.last_http_code.$$")
                export LAST_HTTP_CODE_FILE="$http_code_file"
                response=$(do_request "$url" "$method" "$body" "$access_token" "${headers[@]}")
                request_status=$?
                if [[ -f "$http_code_file" ]]; then
                    last_http_code=$(cat "$http_code_file")
                    rm -f "$http_code_file"
                fi
                unset LAST_HTTP_CODE_FILE
            else
                log "Server is stateless (no session-id returned). 400 error is not session-related."
            fi
        else
            log "Server is stateless (cached __NO_SESSION__). 400 error is not session-related, skipping re-init."
        fi
    fi
    
    # Non-standard MCP hint: URL ends with /mcp, POST, returned 4xx
    if [[ $request_status -ne 0 ]] && [[ "$method" == "POST" ]] && [[ "$url" =~ /mcp/?$ ]]; then
        log "Hint: target URL ends with /mcp but request failed."
        log "      It may be registered on Taihu as MCP but actually exposes a non-MCP REST API."
        log "      Try calling its real business path directly, e.g.:"
        log "        ./tai-auth.sh -u 'https://<host>/cgi/<your-api>' -m GET"
        log "      Or use --probe-mcp to verify whether /mcp is a standard MCP endpoint."
    fi
    
    echo "$response"
    exit $request_status
}

main "$@"