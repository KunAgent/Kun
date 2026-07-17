# kdocs-cli installer for Windows — downloads the platform-specific binary to a global location.
# No Node.js or Go required.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#   irm https://cdn.example.com/setup.ps1 | iex
#
# Environment variables (all optional):
#   KDOCS_CLI_VERSION   — version to install (default: read from SKILL.md or "latest")
#   KDOCS_CLI_CDN       — CDN base URL override
#   KDOCS_CLI_DIR       — install directory override (default: %LOCALAPPDATA%\kdocs-cli)

$ErrorActionPreference = "Stop"

$CdnBase = if ($env:KDOCS_CLI_CDN) { $env:KDOCS_CLI_CDN } else { "https://wpsai.wpscdn.cn/skillhub/pro" }
$BinName = "kdocs-cli"
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA "kdocs-cli"
$InstallDir = if ($env:KDOCS_CLI_DIR) { $env:KDOCS_CLI_DIR } else { $DefaultInstallDir }

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Say  { param([string]$Message) Write-Host "  $Message" }
function Write-Err  { param([string]$Message) Write-Host "  [ERROR] $Message" -ForegroundColor Red; exit 1 }

function Get-Arch {
    if ($env:KDOCS_CLI_ARCH) {
        $override = $env:KDOCS_CLI_ARCH.ToLower()
        if ($override -eq "amd64" -or $override -eq "arm64") { return $override }
        Write-Err "Invalid KDOCS_CLI_ARCH '$env:KDOCS_CLI_ARCH'. Must be 'amd64' or 'arm64'."
    }
    try {
        $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        switch ($arch.ToString()) {
            "X64"   { return "amd64" }
            "Arm64" { return "arm64" }
        }
    } catch {}
    $envArch = $env:PROCESSOR_ARCHITECTURE
    if ($envArch) {
        switch ($envArch.ToUpper()) {
            "AMD64" { return "amd64" }
            "ARM64" { return "arm64" }
            "X86"   {
                $realArch = $env:PROCESSOR_ARCHITEW6432
                if ($realArch) {
                    switch ($realArch.ToUpper()) {
                        "AMD64" { return "amd64" }
                        "ARM64" { return "arm64" }
                    }
                }
                Write-Err "32-bit Windows is not supported."
            }
        }
    }
    Write-Err "Could not detect architecture. Set KDOCS_CLI_ARCH to 'amd64' or 'arm64'."
}

function Resolve-SkillVersion {
    if ($env:KDOCS_CLI_VERSION) { return $env:KDOCS_CLI_VERSION }
    # Try reading from nearby SKILL.md
    $searchPaths = @()
    if ($PSScriptRoot) {
        $searchPaths += Join-Path $PSScriptRoot "..\SKILL.md"
        $searchPaths += Join-Path $PSScriptRoot "..\..\SKILL.md"
    }
    $searchPaths += ".\SKILL.md"
    foreach ($candidate in $searchPaths) {
        if (Test-Path $candidate) {
            $lines = Get-Content $candidate -TotalCount 20
            foreach ($line in $lines) {
                if ($line -match '^version:\s*"?([^"]+)"?\s*$') {
                    return $Matches[1].Trim()
                }
            }
        }
    }
    Write-Err "Cannot determine version. Set KDOCS_CLI_VERSION explicitly."
}

function Test-VersionGe {
    param([string]$Installed, [string]$Target)
    try {
        return ([version]$Installed -ge [version]$Target)
    } catch {
        return $false
    }
}

function Test-ExistingInstall {
    param([string]$TargetVersion)
    $existing = Get-Command $BinName -ErrorAction SilentlyContinue
    if ($existing) {
        $existingVer = & $BinName version 2>$null
        if (-not $existingVer) { $existingVer = "0.0.0" }
        if ($existingVer -eq $TargetVersion) {
            Write-Say "$BinName v$TargetVersion is already installed at $($existing.Source)"
            Write-Say "Use '$BinName upgrade' to check for updates."
            exit 0
        }
        if (Test-VersionGe -Installed $existingVer -Target $TargetVersion) {
            Write-Say "Installed $BinName v$existingVer >= target v$TargetVersion, skipping."
            Write-Say "Use '$BinName upgrade' to manage versions."
            exit 0
        }
        Write-Say "Found existing $BinName v$existingVer at $($existing.Source)"
        Write-Say "Will upgrade to v$TargetVersion to $InstallDir\"
    }
}

# ── Main ─────────────────────────────────────────────────────────────────────

$Arch = Get-Arch
$Version = Resolve-SkillVersion

Test-ExistingInstall -TargetVersion $Version

$ArchiveName = "${BinName}-${Version}-windows-${Arch}.zip"
$DownloadUrl = "${CdnBase}/v${Version}/releases/${ArchiveName}"
$ChecksumsUrl = "${CdnBase}/v${Version}/releases/checksums.txt"

Write-Say "Installing ${BinName} v${Version} (windows/${Arch})..."
Write-Say "Target: ${InstallDir}\${BinName}.exe"

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "kdocs-cli-install-$PID"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ArchivePath = Join-Path $TmpDir $ArchiveName

    Write-Say "Downloading ${ArchiveName}..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ArchivePath -UseBasicParsing

    # SHA256 verification
    try {
        $ChecksumsPath = Join-Path $TmpDir "checksums.txt"
        Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -UseBasicParsing
        $ChecksumContent = Get-Content $ChecksumsPath
        $ExpectedLine = $ChecksumContent | Where-Object { $_ -match [regex]::Escape($ArchiveName) }
        if ($ExpectedLine) {
            $Expected = ($ExpectedLine -split '\s+')[0]
            $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLower()
            if ($Actual -ne $Expected.ToLower()) {
                Write-Err "SHA256 mismatch! Expected $Expected, got $Actual."
            }
            Write-Say "SHA256 verified OK"
        } else {
            Write-Say "[WARN] Archive not in checksums.txt; skipping verification"
        }
    } catch {
        Write-Say "[WARN] Could not verify checksum; skipping"
    }

    Write-Say "Extracting..."
    Expand-Archive -Path $ArchivePath -DestinationPath $TmpDir -Force

    if (!(Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $BinFile = Get-ChildItem -Path $TmpDir -Recurse -Filter "${BinName}.exe" | Select-Object -First 1
    if ($null -eq $BinFile) {
        Write-Err "Binary ${BinName}.exe not found in archive."
    }

    $DestBin = Join-Path $InstallDir "${BinName}.exe"
    Copy-Item -Path $BinFile.FullName -Destination $DestBin -Force

    # Record install source for analytics (X-Request-Source header)
    "aippt" | Set-Content (Join-Path $InstallDir ".source") -NoNewline

    Write-Say "[OK] Installed: $DestBin"

    # Add to user PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        Write-Say ""
        Write-Say "Adding $InstallDir to user PATH..."
        [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$UserPath", "User")
        $env:PATH = "$InstallDir;$env:PATH"
        Write-Say "[OK] PATH updated (restart terminal for full effect)"
    }

    Write-Say ""
    Write-Say "${BinName} v${Version} ready!"
    Write-Say "  Run: ${BinName} version"
    Write-Say "  Upgrade later: ${BinName} upgrade"

} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
