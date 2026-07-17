#Requires -Version 5.1
<#
.SYNOPSIS
    tai-auth.ps1 - OAuth2 PAR auth for *.woa.com domains
.DESCRIPTION
    通用 Bearer 认证代理：拿到 OAuth2 access_token 后，按 -Method / -Body / -Header
    原样透传 HTTP 请求到目标 URL。天然兼容"在太湖上注册为 MCP，但实际暴露非 MCP
    协议（如 /cgi/* 业务 REST API）"的场景 —— 只需要传完整 URL 和方法即可。

    若希望主动探测对方是否为标准 MCP 服务，可加 -ProbeMcp 单独跑握手。
.EXAMPLE
    # 标准 MCP 端点
    .\tai-auth.ps1 -Url "http://mcp-tai.it.woa.com/mcp" -Method POST -Body '{}'
.EXAMPLE
    # 非标准业务 REST（注册了 MCP 但其实是 REST）
    .\tai-auth.ps1 -Url "https://page-record.mcp.it.woa.com/cgi/team/getTeamList?onlyShowMyTeam=1"
.EXAMPLE
    # 探测目标是否为标准 MCP
    .\tai-auth.ps1 -Url "https://page-record.mcp.it.woa.com/mcp" -ProbeMcp
#>

param(
    [string]$Url,
    [string]$Method = "GET",
    [string]$Body,
    [hashtable]$Header = @{},
    [string]$ClientId,
    [string]$Resource,
    [string]$OAuth2Base,
    [string]$AppName,
    [switch]$StartAuth,
    [switch]$WaitAuth,
    [string]$RequestUri,
    [switch]$ProbeMcp
)

$script:DEFAULT_OAUTH2_BASE = "https://iam.it.woa.com"
$script:DEFAULT_CLIENT_ID = "taihu_proxy_client"
$script:DEFAULT_SCOPE = "*"

# 从 URL 提取 resource（包含 scheme + host + path）
function Get-ResourceFromUrl {
    param([string]$U)
    try {
        $uri = [System.Uri]::new($U)
        # 返回完整的 URL（scheme + host + path），不包含 query string
        "$($uri.Scheme)://$($uri.Host)$($uri.AbsolutePath)"
    } catch {
        $U  # 如果解析失败，返回原始 URL
    }
}
$script:CONFIG_DIR = Join-Path $env:USERPROFILE ".workbuddy\config\tof4-auth"
$script:TOKEN_CACHE_PATH = Join-Path $script:CONFIG_DIR "tokens.json"
$script:PENDING_AUTH_PATH = Join-Path $script:CONFIG_DIR "pending-auth.json"
$script:MCP_SESSION_DIR = Join-Path $script:CONFIG_DIR "mcp-sessions"
$script:POLL_INTERVAL_MS = 3000
$script:POLL_MAX_ATTEMPTS = 100

Add-Type -AssemblyName System.Web

function Write-Log { param([string]$Msg); [Console]::Error.WriteLine("[tai-auth] $Msg") }
function Write-LogError { param([string]$Msg); [Console]::Error.WriteLine("[tai-auth] X $Msg") }

function New-PKCE {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $verifier = [Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=',''
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($verifier))
    $challenge = [Convert]::ToBase64String($hash) -replace '\+','-' -replace '/','_' -replace '=',''
    @{ Verifier = $verifier; Challenge = $challenge }
}

function New-RandomState {
    $bytes = New-Object byte[] 8
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ([BitConverter]::ToString($bytes) -replace '-','').ToLower()
}

function Save-PendingAuth {
    param([string]$ReqUri, [string]$CodeVerifier)
    if (-not (Test-Path $script:CONFIG_DIR)) { New-Item -ItemType Directory -Path $script:CONFIG_DIR -Force | Out-Null }
    $data = @{}
    if (Test-Path $script:PENDING_AUTH_PATH) {
        try { 
            $json = Get-Content $script:PENDING_AUTH_PATH -Raw | ConvertFrom-Json
            $json.PSObject.Properties | ForEach-Object { $data[$_.Name] = $_.Value }
        } catch { $data = @{} }
    }
    $data[$ReqUri] = @{ code_verifier = $CodeVerifier; created_at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
    $data | ConvertTo-Json -Depth 10 | Set-Content $script:PENDING_AUTH_PATH -Encoding UTF8
}

function Get-PendingAuth {
    param([string]$ReqUri)
    if (-not (Test-Path $script:PENDING_AUTH_PATH)) { return $null }
    try {
        $json = Get-Content $script:PENDING_AUTH_PATH -Raw | ConvertFrom-Json
        $data = @{}
        $json.PSObject.Properties | ForEach-Object { $data[$_.Name] = $_.Value }
        $entry = $data[$ReqUri]
        if (-not $entry) { return $null }
        $data.Remove($ReqUri)
        $data | ConvertTo-Json -Depth 10 | Set-Content $script:PENDING_AUTH_PATH -Encoding UTF8
        return $entry.code_verifier
    } catch { return $null }
}

$script:GLOBAL_SCOPE_KEY = "__global_scope_star__"

function Get-CacheKey { param([string]$CId, [string]$Res); "$CId::$Res" }
function Get-GlobalCacheKey { param([string]$CId); "$CId::$script:GLOBAL_SCOPE_KEY" }

function Read-TokenCache {
    if (-not (Test-Path $script:TOKEN_CACHE_PATH)) { return @{ entries = @() } }
    try { 
        $json = Get-Content $script:TOKEN_CACHE_PATH -Raw | ConvertFrom-Json
        @{ entries = @($json.entries) }
    } catch { @{ entries = @() } }
}

function Write-TokenCache {
    param([hashtable]$Data)
    if (-not (Test-Path $script:CONFIG_DIR)) { New-Item -ItemType Directory -Path $script:CONFIG_DIR -Force | Out-Null }
    $Data | ConvertTo-Json -Depth 10 | Set-Content $script:TOKEN_CACHE_PATH -Encoding UTF8
}

function Get-CachedToken {
    param([string]$CId, [string]$Res)
    $key = Get-CacheKey -CId $CId -Res $Res
    $cache = Read-TokenCache
    if (-not $cache.entries) { return $null }
    $entry = $cache.entries | Where-Object { (Get-CacheKey -CId $_.client_id -Res ($_.resource -join ',')) -eq $key } | Select-Object -First 1
    if (-not $entry) { return $null }
    $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    if (($entry.expires_at - $nowMs) -le 0 -and -not $entry.refresh_token) { return $null }
    $entry
}

function Get-GlobalCachedToken {
    param([string]$CId)
    $key = Get-GlobalCacheKey -CId $CId
    $cache = Read-TokenCache
    if (-not $cache.entries) { return $null }
    $entry = $cache.entries | Where-Object { (Get-CacheKey -CId $_.client_id -Res ($_.resource -join ',')) -eq $key } | Select-Object -First 1
    if (-not $entry) { return $null }
    $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    if (($entry.expires_at - $nowMs) -le 0 -and -not $entry.refresh_token) { return $null }
    $entry
}

function Remove-CachedToken {
    param([string]$CId, [string]$Res, [bool]$AlsoRemoveGlobal = $false)
    if (-not (Test-Path $script:TOKEN_CACHE_PATH)) { return }
    $cache = Read-TokenCache
    if (-not $cache.entries) { return }
    $resKey = Get-CacheKey -CId $CId -Res $Res
    $globalKey = Get-GlobalCacheKey -CId $CId
    $kept = @()
    foreach ($e in $cache.entries) {
        $ek = Get-CacheKey -CId $e.client_id -Res ($e.resource -join ',')
        if ($ek -eq $resKey) { continue }
        if ($AlsoRemoveGlobal -and $ek -eq $globalKey) { continue }
        $kept += $e
    }
    $cache.entries = $kept
    Write-TokenCache -Data $cache
}

function Save-Token {
    param([string]$CId, [string]$Res, [string]$AccessToken, [string]$RefreshToken, [int]$ExpiresIn = 3600, [bool]$AlsoSaveGlobal = $true)
    $cache = Read-TokenCache
    if (-not $cache.entries) { $cache.entries = @() }
    $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $expiresAt = $nowMs + ($ExpiresIn * 1000)
    
    # Save resource-specific entry
    $key = Get-CacheKey -CId $CId -Res $Res
    $newEntry = @{
        client_id = $CId; resource = @($Res); access_token = $AccessToken
        refresh_token = $RefreshToken; expires_at = $expiresAt
    }
    $idx = -1
    for ($i = 0; $i -lt $cache.entries.Count; $i++) {
        if ((Get-CacheKey -CId $cache.entries[$i].client_id -Res ($cache.entries[$i].resource -join ',')) -eq $key) { $idx = $i; break }
    }
    if ($idx -ge 0) { $cache.entries[$idx] = $newEntry } else { $cache.entries += $newEntry }
    
    # Also save global scope=* entry for sharing across different MCP services
    if ($AlsoSaveGlobal) {
        $globalKey = Get-GlobalCacheKey -CId $CId
        $globalEntry = @{
            client_id = $CId; resource = @($script:GLOBAL_SCOPE_KEY); access_token = $AccessToken
            refresh_token = $RefreshToken; expires_at = $expiresAt
        }
        $globalIdx = -1
        for ($i = 0; $i -lt $cache.entries.Count; $i++) {
            if ((Get-CacheKey -CId $cache.entries[$i].client_id -Res ($cache.entries[$i].resource -join ',')) -eq $globalKey) { $globalIdx = $i; break }
        }
        if ($globalIdx -ge 0) { $cache.entries[$globalIdx] = $globalEntry } else { $cache.entries += $globalEntry }
    }
    
    Write-TokenCache -Data $cache
}

function Invoke-PAR {
    param([string]$Base, [string]$CId, [string]$Res, [string]$Challenge, [string]$State, [string]$Scope, [string]$AppName)
    
    $params = @(
        "client_id=$([System.Web.HttpUtility]::UrlEncode($CId))"
        "response_type=code"
        "code_challenge=$([System.Web.HttpUtility]::UrlEncode($Challenge))"
        "code_challenge_method=S256"
        "state=$([System.Web.HttpUtility]::UrlEncode($State))"
    )
    
    $Res.Split(',') | ForEach-Object {
        $r = $_.Trim()
        if ($r) {
            $params += "resource=$([System.Web.HttpUtility]::UrlEncode($r))"
        }
    }
    
    if ($Scope) {
        $params += "scope=$([System.Web.HttpUtility]::UrlEncode($Scope))"
    }
    
    if ($AppName) {
        $params += "app_name=$([System.Web.HttpUtility]::UrlEncode($AppName))"
    }
    
    $body = $params -join "&"
    Invoke-RestMethod -Uri "$Base/oauth2/par" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $body
}

function Wait-ForAuth {
    param([string]$Base, [string]$CId, [string]$ReqUri)
    Write-Log "Waiting for authorization... (timeout: 5 min)"
    for ($i = 0; $i -lt $script:POLL_MAX_ATTEMPTS; $i++) {
        Start-Sleep -Milliseconds $script:POLL_INTERVAL_MS
        $encReqUri = [System.Web.HttpUtility]::UrlEncode($ReqUri)
        $encCId = [System.Web.HttpUtility]::UrlEncode($CId)
        $pollUrl = "$Base/oauth2/par/poll?request_uri=$encReqUri&client_id=$encCId"
        try {
            $resp = Invoke-RestMethod -Uri $pollUrl -Method GET -ErrorAction Stop
            if ($resp.status -eq "completed") {
                if (-not $resp.code) { throw "Auth completed but no code returned" }
                return @{ Code = $resp.code; RedirectUri = $resp.redirect_uri }
            }
            if ($resp.status -eq "error") { throw "Auth failed: $($resp.error_description)" }
        } catch {
            if ($_.Exception.Response.StatusCode.value__ -eq 404) { throw "Auth request expired" }
        }
    }
    throw "Auth timeout"
}

function Invoke-TokenExchange {
    param([string]$Base, [string]$CId, [string]$Code, [string]$RedirectUri, [string]$Verifier)
    $body = @{
        grant_type = "authorization_code"
        code = $Code
        client_id = $CId
        redirect_uri = $RedirectUri
        code_verifier = $Verifier
    }
    $params = ($body.GetEnumerator() | ForEach-Object { "$([System.Web.HttpUtility]::UrlEncode($_.Key))=$([System.Web.HttpUtility]::UrlEncode($_.Value))" }) -join "&"
    Invoke-RestMethod -Uri "$Base/oauth2/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $params
}

function Invoke-TokenRefresh {
    param([string]$Base, [string]$CId, [string]$RefreshToken)
    $body = @{
        grant_type = "refresh_token"
        refresh_token = $RefreshToken
        client_id = $CId
    }
    $params = ($body.GetEnumerator() | ForEach-Object { "$([System.Web.HttpUtility]::UrlEncode($_.Key))=$([System.Web.HttpUtility]::UrlEncode($_.Value))" }) -join "&"
    
    try {
        Invoke-RestMethod -Uri "$Base/oauth2/token" -Method POST -ContentType "application/x-www-form-urlencoded" -Body $params
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 400) {
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
                if ($errorBody.error -eq "invalid_grant" -or $errorBody.error -eq "invalid_token") {
                    Write-LogError "refresh_token invalid, please re-authorize"
                }
            } catch {}
        }
        throw
    }
}

function Get-ValidToken {
    param([string]$Base, [string]$CId, [string]$Res)
    $cached = Get-CachedToken -CId $CId -Res $Res
    if ($cached) {
        $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        $remaining = [int](($cached.expires_at - $nowMs) / 1000)
        $remainingMin = [int]($remaining / 60)
        
        if ($remaining -gt 60) {
            Write-Log "Using cached token (expires in: $remainingMin min)"
            return $cached.access_token
        }
        
        if ($cached.refresh_token) {
            Write-Log "Token expiring soon, refreshing..."
            try {
                $tok = Invoke-TokenRefresh -Base $Base -CId $CId -RefreshToken $cached.refresh_token
                Save-Token -CId $CId -Res $Res -AccessToken $tok.access_token -RefreshToken $tok.refresh_token -ExpiresIn $tok.expires_in
                Write-Log "Token refreshed successfully"
                return $tok.access_token
            } catch {
                Write-Log "Token refresh failed, need re-auth"
                return $null
            }
        }
        
        if ($remaining -gt 0) {
            Write-Log "Token expiring soon ($remaining sec) and no refresh_token"
            return $cached.access_token
        }
        
        Write-Log "Token expired and no refresh_token"
    }
    $null
}

function Get-ValidGlobalToken {
    param([string]$Base, [string]$CId)
    $cached = Get-GlobalCachedToken -CId $CId
    if ($cached) {
        $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        $remaining = [int](($cached.expires_at - $nowMs) / 1000)
        $remainingMin = [int]($remaining / 60)
        
        if ($remaining -gt 60) {
            Write-Log "Using global scope=* token (expires in: $remainingMin min)"
            return $cached.access_token
        }
        
        if ($cached.refresh_token) {
            Write-Log "Global token expiring soon, refreshing..."
            try {
                $tok = Invoke-TokenRefresh -Base $Base -CId $CId -RefreshToken $cached.refresh_token
                Save-Token -CId $CId -Res $script:GLOBAL_SCOPE_KEY -AccessToken $tok.access_token -RefreshToken $tok.refresh_token -ExpiresIn $tok.expires_in -AlsoSaveGlobal $false
                Write-Log "Global token refreshed successfully"
                return $tok.access_token
            } catch {
                Write-Log "Global token refresh failed"
                return $null
            }
        }
        
        if ($remaining -gt 0) {
            Write-Log "Global token expiring soon ($remaining sec) and no refresh_token"
            return $cached.access_token
        }
    }
    $null
}

function Test-WoaDomain {
    param([string]$U)
    try { $uri = [System.Uri]::new($U); $uri.Host.EndsWith(".woa.com") -or $uri.Host -eq "woa.com" } catch { $false }
}

# ===== MCP Session Management =====
function Get-McpSessionCacheKey {
    param([string]$U)
    # Use host as session key
    try {
        $uri = [System.Uri]::new($U)
        $host_str = "$($uri.Scheme)://$($uri.Host)"
    } catch {
        $host_str = $U
    }
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($host_str)
    $hash = $md5.ComputeHash($bytes)
    [BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

function Get-McpSessionPath {
    param([string]$U)
    $key = Get-McpSessionCacheKey -U $U
    Join-Path $script:MCP_SESSION_DIR $key
}

function Get-CachedMcpSession {
    param([string]$U)
    $path = Get-McpSessionPath -U $U
    if (Test-Path $path) {
        # Check TTL: session cache expires after 10 minutes
        $fileAge = (Get-Date) - (Get-Item $path).LastWriteTime
        if ($fileAge.TotalMinutes -gt 10) {
            Write-Log "MCP Session: cached session expired (age: $([int]$fileAge.TotalMinutes) min > 10 min TTL), removing..."
            Remove-Item $path -Force
            return $null
        }
        (Get-Content $path -Raw).Trim()
    } else {
        $null
    }
}

function Save-McpSession {
    param([string]$U, [string]$SessionId)
    if (-not (Test-Path $script:MCP_SESSION_DIR)) {
        New-Item -ItemType Directory -Path $script:MCP_SESSION_DIR -Force | Out-Null
    }
    $path = Get-McpSessionPath -U $U
    $SessionId | Set-Content $path -Encoding UTF8 -NoNewline
}

function Remove-McpSession {
    param([string]$U)
    $path = Get-McpSessionPath -U $U
    if (Test-Path $path) { Remove-Item $path -Force }
}

function Initialize-McpSession {
    param([string]$U, [string]$AccessToken)
    
    $initBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"tai-auth","version":"1.0.0"}}}'
    $initHeaders = @{
        Authorization  = "Bearer $AccessToken"
        'Content-Type' = 'application/json; charset=utf-8'
        Accept         = 'application/json, text/event-stream'
    }
    
    Write-Log "MCP Session: initializing..."
    
    try {
        $resp = Invoke-WebRequest -Uri $U -Method POST -Headers $initHeaders `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($initBody)) -UseBasicParsing -ErrorAction Stop
        
        # Extract Mcp-Session-Id from response headers
        $sessionId = $resp.Headers['Mcp-Session-Id']
        if (-not $sessionId) {
            # Try case-insensitive lookup
            foreach ($key in $resp.Headers.Keys) {
                if ($key -ieq 'Mcp-Session-Id') {
                    $sessionId = $resp.Headers[$key]
                    break
                }
            }
        }
        
        if (-not $sessionId) {
            Write-Log "MCP Session: no Mcp-Session-Id in response (server may not require sessions)"
            return $null
        }
        
        # Handle array values (PowerShell may return headers as arrays)
        if ($sessionId -is [array]) { $sessionId = $sessionId[0] }
        $sessionId = $sessionId.Trim()
        
        Write-Log "MCP Session: got session-id"
        Save-McpSession -U $U -SessionId $sessionId
        
        # Send notifications/initialized
        $notifyHeaders = @{
            Authorization    = "Bearer $AccessToken"
            'Content-Type'   = 'application/json; charset=utf-8'
            'Mcp-Session-Id' = $sessionId
        }
        try {
            Invoke-WebRequest -Uri $U -Method POST -Headers $notifyHeaders `
                -Body ([System.Text.Encoding]::UTF8.GetBytes('{"jsonrpc":"2.0","method":"notifications/initialized"}')) `
                -UseBasicParsing -ErrorAction Stop | Out-Null
        } catch {
            # notifications/initialized failure is not fatal
        }
        
        Write-Log "MCP Session: initialized successfully"
        return $sessionId
    } catch {
        Write-Log "MCP Session: initialize failed - $($_.Exception.Message)"
        return $null
    }
}

function Get-EnsuredMcpSession {
    param([string]$U, [string]$AccessToken)
    
    $sessionId = Get-CachedMcpSession -U $U
    if ($sessionId) { return $sessionId }
    
    # No cached session, initialize
    return Initialize-McpSession -U $U -AccessToken $AccessToken
}

function Test-IsMcpEndpoint {
    param([string]$U, [string]$Body)
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
    if (-not $Body) { return $false }
    if ($Body -notmatch '"jsonrpc"') { return $false }

    # Match "method" : "<mcp-method-name>" in the JSON body
    # This covers all standard MCP method namespaces
    $mcpMethodPattern = '"method"\s*:\s*"(initialize|ping|notifications/|tools/|resources/|prompts/|logging/|completion/|roots/|sampling/|elicitation/)'
    return [bool]($Body -match $mcpMethodPattern)
}

# Main
$oauth2 = if ($OAuth2Base) { $OAuth2Base } elseif ($env:TOF4_OAUTH2_BASE) { $env:TOF4_OAUTH2_BASE } else { $script:DEFAULT_OAUTH2_BASE }
$cid = if ($ClientId) { $ClientId } elseif ($env:TOF4_CLIENT_ID) { $env:TOF4_CLIENT_ID } else { $script:DEFAULT_CLIENT_ID }

if ($StartAuth) {
    if (-not $Url) { Write-LogError "-StartAuth requires -Url"; exit 1 }
    $res = if ($Resource) { $Resource } elseif ($env:TOF4_RESOURCE) { $env:TOF4_RESOURCE } else { Get-ResourceFromUrl -U $Url }
    $scope = if ($env:TOF4_SCOPE) { $env:TOF4_SCOPE } else { $script:DEFAULT_SCOPE }
    $pkce = New-PKCE
    $state = New-RandomState
    $par = Invoke-PAR -Base $oauth2 -CId $cid -Res $res -Challenge $pkce.Challenge -State $state -Scope $scope
    $encCid = [System.Web.HttpUtility]::UrlEncode($cid)
    $encReqUri = [System.Web.HttpUtility]::UrlEncode($par.request_uri)
    $authUrl = $oauth2 + '/oauth2/authorize?client_id=' + $encCid + '&request_uri=' + $encReqUri
    Save-PendingAuth -ReqUri $par.request_uri -CodeVerifier $pkce.Verifier
    Start-Process $authUrl
    @{ auth_required = $true; auth_url = $authUrl; request_uri = $par.request_uri; client_id = $cid; resource = $res; expires_in = $par.expires_in } | ConvertTo-Json
    exit 0
}

if ($WaitAuth) {
    if (-not $RequestUri) { Write-LogError "-WaitAuth requires -RequestUri"; exit 1 }
    if (-not $Url) { Write-LogError "-WaitAuth requires -Url"; exit 1 }
    $verifier = Get-PendingAuth -ReqUri $RequestUri
    if (-not $verifier) { Write-LogError "No pending auth found, please restart"; exit 1 }
    $res = if ($Resource) { $Resource } elseif ($env:TOF4_RESOURCE) { $env:TOF4_RESOURCE } else { Get-ResourceFromUrl -U $Url }
    $auth = Wait-ForAuth -Base $oauth2 -CId $cid -ReqUri $RequestUri
    $tok = Invoke-TokenExchange -Base $oauth2 -CId $cid -Code $auth.Code -RedirectUri $auth.RedirectUri -Verifier $verifier
    Save-Token -CId $cid -Res $res -AccessToken $tok.access_token -RefreshToken $tok.refresh_token -ExpiresIn $tok.expires_in
    Write-Log "Auth success! Token cached"
    @{ auth_success = $true } | ConvertTo-Json
    exit 0
}

if (-not $Url) { Write-LogError "Missing -Url"; exit 1 }
if (-not (Test-WoaDomain -U $Url)) { Write-LogError "URL is not *.woa.com domain"; exit 1 }

$res = if ($Resource) { $Resource } elseif ($env:TOF4_RESOURCE) { $env:TOF4_RESOURCE } else { Get-ResourceFromUrl -U $Url }
$scope = if ($env:TOF4_SCOPE) { $env:TOF4_SCOPE } else { $script:DEFAULT_SCOPE }
$appNameVal = if ($AppName) { $AppName } elseif ($env:TOF4_APP_NAME) { $env:TOF4_APP_NAME } else { $null }

# Token priority: 1. resource-specific -> 2. global scope=* -> 3. new auth
$accessToken = Get-ValidToken -Base $oauth2 -CId $cid -Res $res
$tokenSource = "resource"

if (-not $accessToken) {
    # Try global token
    $accessToken = Get-ValidGlobalToken -Base $oauth2 -CId $cid
    if ($accessToken) {
        $tokenSource = "global"
    }
}

# Function to do full OAuth2 auth
function Invoke-FullAuth {
    param([string]$Base, [string]$CId, [string]$Res, [string]$Scope, [string]$AppNameParam)
    $pkce = New-PKCE
    $state = New-RandomState
    $par = Invoke-PAR -Base $Base -CId $CId -Res $Res -Challenge $pkce.Challenge -State $state -Scope $Scope -AppName $AppNameParam
    $encCid = [System.Web.HttpUtility]::UrlEncode($CId)
    $encReqUri = [System.Web.HttpUtility]::UrlEncode($par.request_uri)
    $authUrl = $Base + '/oauth2/authorize?client_id=' + $encCid + '&request_uri=' + $encReqUri
    Start-Process $authUrl
    [Console]::Error.WriteLine("")
    [Console]::Error.WriteLine("[tai-auth] OAuth2 auth required (scope=*), please complete in browser")
    [Console]::Error.WriteLine("  $authUrl")
    [Console]::Error.WriteLine("")
    $auth = Wait-ForAuth -Base $Base -CId $CId -ReqUri $par.request_uri
    $tok = Invoke-TokenExchange -Base $Base -CId $CId -Code $auth.Code -RedirectUri $auth.RedirectUri -Verifier $pkce.Verifier
    Save-Token -CId $CId -Res $Res -AccessToken $tok.access_token -RefreshToken $tok.refresh_token -ExpiresIn $tok.expires_in
    Write-Log "Auth success! Token cached (resource + global scope=*)"
    $tok.access_token
}

if (-not $accessToken) {
    $accessToken = Invoke-FullAuth -Base $oauth2 -CId $cid -Res $res -Scope $scope -AppNameParam $appNameVal
    $tokenSource = "new"
}

# Build request headers
$reqHeaders = @{ Authorization = "Bearer $accessToken" }
foreach ($k in $Header.Keys) { $reqHeaders[$k] = $Header[$k] }

if ($Body -and -not $reqHeaders['Content-Type']) { 
    $reqHeaders['Content-Type'] = 'application/json; charset=utf-8' 
}

if (-not $reqHeaders['Accept']) {
    $reqHeaders['Accept'] = 'application/json, text/event-stream'
}

# ============================================================
# ProbeMcp: 仅探测目标是否为标准 MCP 端点，不进行业务调用
# ============================================================
if ($ProbeMcp) {
    $probeBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tai-auth-probe","version":"0.1"}}}'
    $probeHeaders = @{
        Authorization  = "Bearer $accessToken"
        'Content-Type' = 'application/json; charset=utf-8'
        Accept         = 'application/json, text/event-stream'
    }
    Write-Log "-> [Probe] POST $Url (MCP initialize handshake)"
    try {
        $probeResp = Invoke-WebRequest -Uri $Url -Method POST -Headers $probeHeaders `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($probeBody)) -UseBasicParsing -ErrorAction Stop
        $content = $probeResp.Content
        $isMcp = $false
        $reason = ""
        try {
            $parsed = $content | ConvertFrom-Json -ErrorAction Stop
            if ($parsed.jsonrpc -eq "2.0" -and ($parsed.result -or $parsed.error)) {
                $isMcp = $true
                $reason = "JSON-RPC 2.0 response detected"
            } else {
                $reason = "Valid JSON but not JSON-RPC 2.0 shape"
            }
        } catch {
            $reason = "Response is not valid JSON (likely non-MCP endpoint)"
        }
        $result = @{
            url          = $Url
            status       = $probeResp.StatusCode
            is_mcp       = $isMcp
            reason       = $reason
            content_type = $probeResp.Headers['Content-Type']
            body_preview = if ($content.Length -gt 500) { $content.Substring(0, 500) + "..." } else { $content }
        }
        Write-Log "Probe result: is_mcp=$isMcp ($reason)"
        $result | ConvertTo-Json -Depth 5
        exit 0
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errBody = ""
        try {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd()
        } catch {}
        $result = @{
            url          = $Url
            status       = $statusCode
            is_mcp       = $false
            reason       = "HTTP $statusCode - endpoint not serving MCP protocol"
            body_preview = if ($errBody.Length -gt 500) { $errBody.Substring(0, 500) + "..." } else { $errBody }
        }
        Write-Log "Probe result: is_mcp=False (HTTP $statusCode)"
        $result | ConvertTo-Json -Depth 5
        exit 0
    }
}

Write-Log "-> $Method $Url"

# ============================================================
# MCP Session Management: auto-initialize if target is MCP endpoint
# ============================================================
if (Test-IsMcpEndpoint -U $Url -Body $Body) {
    $mcpSessionId = Get-EnsuredMcpSession -U $Url -AccessToken $accessToken
    if ($mcpSessionId) {
        $reqHeaders['Mcp-Session-Id'] = $mcpSessionId
    }
}

$maxRetries = 3
$retryDelayMs = 1000
$lastError = $null
$needRetryWithNewToken = $false
$mcpSessionRetried = $false
$authRetried = $false

for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    try {
        $splat = @{ Uri = $Url; Method = $Method; Headers = $reqHeaders }
        if ($Body) { 
            $splat.Body = [System.Text.Encoding]::UTF8.GetBytes($Body)
        }
        $response = Invoke-WebRequest @splat -UseBasicParsing
        Write-Log "Response: $($response.StatusCode)"
        $response.Content
        exit 0
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $lastError = $_
        
        # If 401 and we're using a cached token (resource or global),
        # the server may have revoked the authorization (e.g. user manually
        # unbound the app on Taihu). Drop the stale entries and re-auth.
        # Only retry once to avoid infinite loop.
        if ($statusCode -eq 401 -and $tokenSource -ne "new" -and -not $authRetried) {
            $authRetried = $true
            Write-Log "Cached token rejected (401, source=$tokenSource). Server-side authorization may have been revoked."
            Write-Log "Purging stale token entries and re-authorizing..."
            # Remove both the resource-specific entry and the global entry,
            # because they usually share the same (now-invalid) access_token.
            Remove-CachedToken -CId $cid -Res $res -AlsoRemoveGlobal $true
            $accessToken = Invoke-FullAuth -Base $oauth2 -CId $cid -Res $res -Scope $scope -AppNameParam $appNameVal
            $tokenSource = "new"
            $reqHeaders['Authorization'] = "Bearer $accessToken"
            # Re-initialize MCP session with new token
            if (Test-IsMcpEndpoint -U $Url -Body $Body) {
                Remove-McpSession -U $Url
                $newSessionId = Get-EnsuredMcpSession -U $Url -AccessToken $accessToken
                if ($newSessionId) {
                    $reqHeaders['Mcp-Session-Id'] = $newSessionId
                } else {
                    $reqHeaders.Remove('Mcp-Session-Id')
                }
            }
            $attempt = 0  # Reset retry counter (will become 1 after for-loop increment)
            continue
        }
        
        # If 400 on MCP endpoint, session may have expired - re-initialize and retry.
        # Only retry once to avoid infinite loop.
        if ($statusCode -eq 400 -and (Test-IsMcpEndpoint -U $Url -Body $Body) -and -not $mcpSessionRetried) {
            $mcpSessionRetried = $true
            Write-Log "MCP Session may have expired (400). Re-initializing..."
            Remove-McpSession -U $Url
            $newSessionId = Get-EnsuredMcpSession -U $Url -AccessToken $accessToken
            if ($newSessionId) {
                $reqHeaders['Mcp-Session-Id'] = $newSessionId
                $attempt = 0  # Reset retry counter (will become 1 after for-loop increment)
                continue
            }
        }
        
        if ($statusCode -ge 400 -and $statusCode -lt 500 -and $statusCode -notin @(408, 429)) {
            Write-Log "Response: $statusCode (client error, not retrying)"
            # 针对注册了 MCP 但其实不是标准 MCP 的情况，给出友好提示
            if ($statusCode -eq 404 -and $Url -match '/mcp/?$' -and $Method -eq 'POST') {
                Write-Log "Hint: target URL ends with /mcp but returned 404."
                Write-Log "      It may be registered on Taihu as MCP but actually exposes a non-MCP REST API."
                Write-Log "      Try calling its real business path directly, e.g.:"
                Write-Log "        .\tai-auth.ps1 -Url 'https://<host>/cgi/<your-api>' -Method GET"
                Write-Log "      Or use -ProbeMcp to verify whether /mcp is a standard MCP endpoint."
            }
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $reader.ReadToEnd()
            } catch {
                $_.Exception.Message
            }
            exit 1
        }
        
        if ($attempt -lt $maxRetries) {
            Write-Log "Response: $statusCode (attempt $attempt/$maxRetries, retrying...)"
            Start-Sleep -Milliseconds $retryDelayMs
            $retryDelayMs *= 2
        } else {
            Write-Log "Response: $statusCode (all $maxRetries attempts failed)"
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $reader.ReadToEnd()
            } catch {
                $_.Exception.Message
            }
            exit 1
        }
    }
}
