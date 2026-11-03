function Get-InstallerRecoveryFieldMap {
  return [ordered]@{
    AppExecutable = 'KUN_INSTALLER_APP_EXECUTABLE'
    AppGuid = 'KUN_INSTALLER_APP_GUID'
    AutomaticUpdate = 'KUN_INSTALLER_AUTOMATIC_UPDATE'
    CanonicalLeaf = 'KUN_INSTALLER_CANONICAL_LEAF'
    CommonDesktop = 'KUN_INSTALLER_COMMON_DESKTOP'
    CommonPrograms = 'KUN_INSTALLER_COMMON_PROGRAMS'
    CurrentDesktop = 'KUN_INSTALLER_CURRENT_DESKTOP'
    CurrentPrograms = 'KUN_INSTALLER_CURRENT_PROGRAMS'
    InstallMode = 'KUN_INSTALLER_INSTALL_MODE'
    InstallRegistryKey = 'KUN_INSTALLER_INSTALL_REGISTRY_KEY'
    JournalPath = 'KUN_INSTALLER_JOURNAL'
    BackupRoot = 'KUN_INSTALLER_PAYLOAD_BACKUP'
    PreserveOtherScope = 'KUN_INSTALLER_PRESERVE_OTHER_SCOPE'
    ProductName = 'KUN_INSTALLER_PRODUCT_NAME'
    SecondarySource = 'KUN_INSTALLER_SECONDARY_SOURCE'
    Source = 'KUN_INSTALLER_SOURCE'
    Target = 'KUN_INSTALLER_TARGET'
    UninstallRegistryKey = 'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY'
    StageRoot = 'KUN_INSTALLER_STAGE'
    HealthResult = 'KUN_INSTALLER_HEALTH_RESULT'
  }
}

function Set-InstallerRecoveryFieldsFromEnvironment([hashtable]$Transaction) {
  $map = Get-InstallerRecoveryFieldMap
  foreach ($field in $map.Keys) {
    if (-not $Transaction.ContainsKey($field)) {
      $Transaction[$field] = Get-EnvironmentValue $map[$field]
    }
  }
}

function Assert-InstallerRecoveryFields($Transaction) {
  $required = @(
    'AppExecutable', 'AppGuid', 'AutomaticUpdate', 'CanonicalLeaf', 'InstallMode',
    'InstallRegistryKey', 'JournalPath', 'ProductName', 'Source', 'StageRoot',
    'Target', 'UninstallRegistryKey', 'HealthResult'
  )
  if ((Get-NormalizedInstallMode) -eq 'all') {
    $required += @('CommonDesktop', 'CommonPrograms')
  } else {
    $required += @('CurrentDesktop', 'CurrentPrograms')
  }
  foreach ($field in $required) {
    if ([string]::IsNullOrWhiteSpace([string]$Transaction.$field)) {
      throw "The automatic update transaction recovery field is required: $field"
    }
  }
}

# A new installer has a different PID and no old stage/health environment.
# Bootstrap only this installer entry point, never the GUI's strict reader.
# The current install identity and shell/registry roots remain authoritative.
function Get-InstallerRestartRecoveryEnvironment($Transaction) {
  Assert-InstallerRecoveryFields $Transaction
  $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_UPDATE_SOURCE')
  if ([string]::IsNullOrWhiteSpace($source)) {
    $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  }
  if ([string]::IsNullOrWhiteSpace($source) -or
      -not (Test-PathEqual ([string]$Transaction.Source) $source)) {
    throw 'The interrupted update source is not authorized by this installer.'
  }
  $target = Resolve-LegacySourceTarget $source
  if ([string]::IsNullOrWhiteSpace($target)) { $target = $source }
  if (-not (Test-PathEqual ([string]$Transaction.Target) $target) -or
      -not (Test-PathEqual (Get-JournalTarget) $target) -or
      [bool]$Transaction.InPlace -ne [bool](Test-PathEqual $source $target)) {
    throw 'The interrupted update target is not authorized by this installer.'
  }
  if (-not (Test-PathEqual ([string]$Transaction.JournalPath) (Get-JournalPath))) {
    throw 'The interrupted update journal is not authorized by this installer.'
  }
  foreach ($field in @('AppExecutable', 'CanonicalLeaf', 'InstallRegistryKey', 'UninstallRegistryKey', 'ProductName')) {
    $name = (Get-InstallerRecoveryFieldMap)[$field]
    if (-not [string]::Equals([string]$Transaction.$field, (Get-EnvironmentValue $name), [StringComparison]::OrdinalIgnoreCase)) {
      throw "The interrupted update identity field is not authorized: $field"
    }
  }
  if ([string]$Transaction.AutomaticUpdate -ne '1') {
    throw 'The interrupted transaction is not an automatic update.'
  }
  $stage = Normalize-FullPath ([string]$Transaction.StageRoot)
  $stagePattern = '^' + [Regex]::Escape($target + '.kun-stage-') + '([0-9]+)$'
  $stageMatch = [Regex]::Match($stage, $stagePattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $stageMatch.Success) {
    throw 'The interrupted update stage is not an authorized installer sibling.'
  }
  $oldPid = $stageMatch.Groups[1].Value
  $backup = Join-Path (Split-Path -Parent (Get-JournalPath)) ('update-backup-' + $oldPid)
  if (-not (Test-PathEqual ([string]$Transaction.BackupRoot) $backup) -or
      -not (Test-PathEqual ([string]$Transaction.OldPayloadRoot) ($target + '.kun-old-' + $oldPid))) {
    throw 'The interrupted update backup does not belong to its original installer.'
  }
  $health = Normalize-FullPath ([string]$Transaction.HealthResult)
  $healthPaths = @((Get-UpdateTransactionPath) + '.health.json')
  $pendingResult = Normalize-FullPath (Get-EnvironmentValue 'KUN_PENDING_UPDATE_RESULT')
  if (-not [string]::IsNullOrWhiteSpace($pendingResult)) { $healthPaths += $pendingResult + '.health.json' }
  $healthPaths += Join-Path ([IO.Path]::GetTempPath()) ('Kun-update-health-' + $oldPid + '.json')
  if (-not ($healthPaths | Where-Object { Test-PathEqual $health $_ })) {
    throw 'The interrupted update health result is not authorized by this installer.'
  }
  foreach ($path in @($source, $target, $stage, $backup, $health,
      ([string]$Transaction.OldPayloadRoot), ([string]$Transaction.FailedPayloadRoot),
      ([string]$Transaction.AssetsRoot))) {
    Assert-SafeInstallRoot $path 'Interrupted update recovery'
  }
  return @{
    KUN_INSTALLER_SOURCE = $source
    KUN_INSTALLER_TARGET = $target
    KUN_INSTALLER_STAGE = $stage
    KUN_INSTALLER_PAYLOAD_BACKUP = $backup
    KUN_INSTALLER_HEALTH_RESULT = $health
  }
}

function Recover-InstallerUpdateTransaction {
  # No saved path is adopted until storage ACLs, schema, app and scope pass.
  $transaction = Read-TrustedUpdateTransaction
  if ($null -eq $transaction) { return }
  $environment = Get-InstallerRestartRecoveryEnvironment $transaction
  $previous = @{}
  try {
    foreach ($name in $environment.Keys) {
      $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    # Re-read with the normal exact-path, assets and shortcut authorization.
    Recover-PendingUpdateTransaction
    # A new Prepare must not try to read the old PID's terminal transaction.
    Finalize-TerminalUpdateTransaction
  } finally {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
  }
}

# Scope selection happens before elevation. Only observe an existing, securely
# owned transaction here: never repair ACLs or quarantine files to obtain trust.
function Test-InterruptedUpdateScopeRegistration([string]$Scope, [string]$RunningSource, [string]$RegisteredSource) {
  $rootName = if ($Scope -eq 'all') { 'KUN_INSTALLER_ALL_RECOVERY_ROOT' } else { 'KUN_INSTALLER_CURRENT_RECOVERY_ROOT' }
  $root = Normalize-FullPath (Get-EnvironmentValue $rootName)
  if ([string]::IsNullOrWhiteSpace($root) -or [string]::IsNullOrWhiteSpace($RegisteredSource)) { return $false }
  $guid = Get-JournalAppGuid
  $path = Join-Path $root ($guid + '-update.json')
  if (-not (Test-Path -LiteralPath $root -PathType Container) -or
      -not (Test-Path -LiteralPath $path -PathType Leaf) -or
      -not (Test-JournalAclSecure $root $Scope) -or
      -not (Test-JournalAclSecure $path $Scope)) { return $false }
  Assert-NoReparsePathComponents $path 'Interrupted update scope record'
  $transaction = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ([int]$transaction.SchemaVersion -ne 4 -or
      -not [string]::Equals([string]$transaction.AppGuid, $guid, [StringComparison]::OrdinalIgnoreCase) -or
      [string]$transaction.InstallMode -ne $Scope -or
      -not (Test-PathEqual ([string]$transaction.Source) $RunningSource) -or
      -not (Test-PathEqual ([string]$transaction.StageRoot) $RegisteredSource)) { return $false }
  $target = Resolve-LegacySourceTarget $RunningSource
  if ([string]::IsNullOrWhiteSpace($target)) { $target = $RunningSource }
  $context = @{
    KUN_INSTALLER_INSTALL_MODE = $Scope
    KUN_INSTALLER_SOURCE = $RunningSource
    KUN_INSTALLER_TARGET = $target
    KUN_INSTALLER_JOURNAL = Join-Path $root ($guid + '.json')
    KUN_INSTALLER_TRANSACTION = $path
  }
  $previous = @{}
  try {
    foreach ($name in $context.Keys) {
      $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $context[$name], 'Process')
    }
    $environment = Get-InstallerRestartRecoveryEnvironment $transaction
    foreach ($name in $environment.Keys) {
      if (-not $previous.ContainsKey($name)) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      }
      [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    Assert-UpdateTransactionPaths $transaction
    return $true
  } finally {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
  }
}

# Retry only a single failed filesystem operation, never a whole transaction.
# A shared wait budget prevents many locked entries multiplying the delay.
function Invoke-UpdateFileOperation([scriptblock]$Operation) {
  $delay = 100
  while ($true) {
    try { & $Operation; return } catch {
      $errorRecord = $_
      $exception = $_.Exception
      $sharing = $false
      while ($null -ne $exception) {
        $code = $exception.HResult -band 0xffff
        if ($exception -is [ComponentModel.Win32Exception]) { $code = $exception.NativeErrorCode }
        if ($code -eq 32 -or $code -eq 33) { $sharing = $true; break }
        $exception = $exception.InnerException
      }
      if (-not $sharing -or $script:UpdateFileWaitMs -ge 10000) { throw $errorRecord }
      $wait = [Math]::Min($delay, 10000 - $script:UpdateFileWaitMs)
      Write-InstallerDiagnostic "FILE_BUSY retryMs=$wait waitedMs=$script:UpdateFileWaitMs"
      Start-Sleep -Milliseconds $wait
      $script:UpdateFileWaitMs += $wait
      $delay = [Math]::Min(1000, $delay * 2)
    }
  }
}

function Set-InstallerTransactionOwner([hashtable]$Transaction) {
  $ownerPid = 0
  [void][int]::TryParse((Get-EnvironmentValue 'KUN_INSTALLER_SELF_PID'), [ref]$ownerPid)
  if ($ownerPid -le 0) { return }
  try {
    $owner = Get-Process -Id $ownerPid -ErrorAction Stop
    try { $birth = $owner.StartTime.ToUniversalTime() } finally { $owner.Dispose() }
    $birth = $birth.AddTicks(-($birth.Ticks % 10))
    $Transaction.InstallerPid = $ownerPid
    $Transaction.InstallerProcessIdentity = 'win32-v1:' + $birth.ToString('O')
  } catch {
    Write-InstallerDiagnostic 'INSTALLER_OWNER unavailable; cutover process checks remain required'
  }
}

function Stop-UpdatePayloadProcesses($Transaction) {
  $roots = @([string]$Transaction.Source, [string]$Transaction.Target, [string]$Transaction.OldPayloadRoot)
  $result = Stop-AppProcesses $roots
  if ($result.Outcome -ne 'stopped') {
    Write-BlockingProcessDiagnostic $result
    throw 'Application processes did not exit before update payload mutation.'
  }
}

# Readiness is checked inside the process that will perform recovery, after
# elevation when required, before asking the running GUI to release its files.
function Assert-UpdateRollbackReady {
  if ((Get-NormalizedInstallMode) -eq 'all') {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'All-users update rollback requires an elevated helper.'
    }
  }
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  if (@('prepared', 'payload_switched', 'awaiting_health', 'cleanup_pending', 'committed',
        'rollback_pending', 'rolling_back', 'rollback_incomplete', 'aborted', 'rolled_back') -notcontains [string]$transaction.Phase) {
    throw 'The automatic update transaction cannot be rolled back.'
  }
  Assert-InstallerRecoveryFields $transaction
  $root = if ([bool]$transaction.InPlace -and [string]$transaction.Phase -ne 'rolled_back') {
    Normalize-FullPath ([string]$transaction.BackupRoot)
  } else {
    Normalize-FullPath ([string]$transaction.Source)
  }
  Assert-RecoveryPayload $root
  Assert-NoReparsePointsInTree (Get-Item -LiteralPath $root) 'Automatic update recovery payload'
  $journal = Read-Journal
  if ($null -ne $journal) {
    foreach ($record in @(Get-JournalRecords $journal)) {
      Get-ValidatedJournalRecord $record | Out-Null
    }
  }
  if ([string]$transaction.Phase -ne 'rolled_back') {
    foreach ($record in @($transaction.Shortcuts)) {
      if (@($record.PSObject.Properties).Count -eq 0) { continue }
      $backup = [string]$record.Backup
      if (-not (Test-Path -LiteralPath $backup -PathType Leaf) -or (Test-ReparsePoint $backup)) {
        throw "The shortcut recovery file is unavailable: $backup"
      }
      $stream = [IO.File]::OpenRead($backup)
      $stream.Dispose()
    }
  }
  Invoke-InstallerFaultPoint 'rollback.before_ready'
}
