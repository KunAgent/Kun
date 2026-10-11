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
