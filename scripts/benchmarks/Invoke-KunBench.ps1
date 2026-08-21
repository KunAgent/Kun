[CmdletBinding()]
param(
  [ValidateSet('preflight', 'build-kun', 'run', 'resume', 'validate', 'summarize')]
  [string]$Action = 'preflight',

  [ValidateSet('all', 'swebench', 'deepswe', 'terminal-bench')]
  [string]$Suite = 'all',

  [ValidateSet('smoke', 'pilot', 'full')]
  [string]$Preset = 'smoke',

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
  [string]$RunId,

  [ValidateNotNullOrEmpty()]
  [string]$Distro = 'Ubuntu',

  [ValidatePattern('^/')]
  [string]$RepoPath,

  [ValidatePattern('^/')]
  [string]$EnvFile,

  [ValidatePattern('^/')]
  [string]$ArtifactRoot,

  [ValidatePattern('^/')]
  [string]$KunArchive,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw 'wsl.exe was not found. Install WSL2 before running Kun benchmarks.'
}
if ([string]::IsNullOrWhiteSpace($RepoPath)) {
  throw 'RepoPath is required and must be an absolute WSL path such as /home/me/DeepSeek-GUI.'
}

$kernel = (& wsl.exe -d $Distro --exec uname -r 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to start WSL distribution '$Distro': $kernel"
}
if ($kernel -notmatch '(?i)(WSL2|microsoft-standard)') {
  throw "Distribution '$Distro' is not WSL2 (kernel: $kernel)."
}

& wsl.exe -d $Distro --exec test -d $RepoPath
if ($LASTEXITCODE -ne 0) {
  throw "Repository path does not exist inside '$Distro': $RepoPath"
}

$benchArgs = [System.Collections.Generic.List[string]]::new()
$benchArgs.Add('run')
$benchArgs.Add('benchmark:agents')
$benchArgs.Add('--')
$benchArgs.Add($Action)

if ($Action -in @('preflight', 'run')) {
  $benchArgs.Add('--suite')
  $benchArgs.Add($Suite)
  $benchArgs.Add('--preset')
  $benchArgs.Add($Preset)
}
if ($Action -in @('preflight', 'run', 'resume') -and $EnvFile) {
  $benchArgs.Add('--env-file')
  $benchArgs.Add($EnvFile)
}
if ($Action -in @('run', 'resume', 'validate', 'summarize') -and $RunId) {
  $benchArgs.Add('--run-id')
  $benchArgs.Add($RunId)
}
if ($Action -in @('preflight', 'run', 'resume', 'validate', 'summarize') -and $ArtifactRoot) {
  $benchArgs.Add('--artifact-root')
  $benchArgs.Add($ArtifactRoot)
}
if ($Action -in @('preflight', 'run') -and $KunArchive) {
  $benchArgs.Add('--kun-archive')
  $benchArgs.Add($KunArchive)
}
if ($DryRun -and $Action -in @('preflight', 'build-kun', 'run')) {
  $benchArgs.Add('--dry-run')
}
if ($Action -in @('resume', 'validate', 'summarize') -and -not $RunId) {
  throw "RunId is required for action '$Action'."
}

$wslArgs = @('-d', $Distro, '--cd', $RepoPath, '--exec', 'npm') + $benchArgs
Write-Host "Running Kun benchmark action '$Action' in WSL distribution '$Distro'..."
& wsl.exe @wslArgs
exit $LASTEXITCODE
