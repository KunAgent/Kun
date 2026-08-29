function Get-UpdateTransactionPath {
  $configured = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TRANSACTION')
  if ([string]::IsNullOrWhiteSpace($configured)) {
    throw 'KUN_INSTALLER_TRANSACTION is required for automatic update transactions.'
  }
  return $configured
}

function Get-UpdateStageRoot {
  $configured = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_STAGE')
  if (-not [string]::IsNullOrWhiteSpace($configured)) { return $configured }
  return (Get-JournalTarget) + '.kun-stage-' + (Get-EnvironmentValue 'KUN_INSTALLER_SELF_PID')
}

function Get-UpdateHealthResultPath {
  $configured = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_HEALTH_RESULT')
  if (-not [string]::IsNullOrWhiteSpace($configured)) { return $configured }
  return (Get-UpdateTransactionPath) + '.health.json'
}

function Convert-RegistryValueForJson($Value) {
  if ($Value -is [byte[]]) {
    return @{ Encoding = 'base64'; Value = [Convert]::ToBase64String($Value) }
  }
  return @{ Encoding = 'json'; Value = $Value }
}

function Convert-RegistryValueFromJson($Record) {
  if ([string]::Equals([string]$Record.Encoding, 'base64', [StringComparison]::Ordinal)) {
    # PowerShell enumerates arrays returned from functions. Preserve the typed
    # array object required by RegistryKey.SetValue for binary registry data.
    return ,([Convert]::FromBase64String([string]$Record.Value))
  }
  if ([string]$Record.Kind -eq 'MultiString') {
    # REG_MULTI_SZ requires String[], not the Object[] PowerShell would build
    # after enumerating a normal function return value.
    return ,([string[]]@($Record.Value))
  }
  if ([string]$Record.Kind -eq 'DWord') { return [int]$Record.Value }
  if ([string]$Record.Kind -eq 'QWord') { return [long]$Record.Value }
  return $Record.Value
}

function Open-TransactionRegistryHive([string]$HiveName = '') {
  if ([string]::IsNullOrWhiteSpace($HiveName)) {
    $HiveName = if ((Get-NormalizedInstallMode) -eq 'all') { 'LocalMachine' } else { 'CurrentUser' }
  }
  $hive = [Microsoft.Win32.RegistryHive]([Enum]::Parse([Microsoft.Win32.RegistryHive], $HiveName))
  return [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
}

function Get-TransactionRegistryKeyNames {
  $installKey = (Get-EnvironmentValue 'KUN_INSTALLER_INSTALL_REGISTRY_KEY').Trim()
  $uninstallKey = (Get-EnvironmentValue 'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY').Trim()
  if ([string]::IsNullOrWhiteSpace($installKey) -or [string]::IsNullOrWhiteSpace($uninstallKey)) {
    throw 'Installer registry key names are required for automatic update recovery.'
  }
  return @($installKey, $uninstallKey)
}

function Export-RegistryTree([Microsoft.Win32.RegistryKey]$Hive, [string]$PathValue) {
  $key = $Hive.OpenSubKey($PathValue, $false)
  if ($null -eq $key) { return @{ Path = $PathValue; Exists = $false; Values = @(); Children = @() } }
  try {
    $values = @()
    foreach ($name in @($key.GetValueNames())) {
      $kind = $key.GetValueKind($name)
      $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $encoded = Convert-RegistryValueForJson $value
      $values += @{
        Name = $name
        Kind = [string]$kind
        Encoding = $encoded.Encoding
        Value = $encoded.Value
      }
    }
    $children = @()
    foreach ($child in @($key.GetSubKeyNames())) {
      $children += Export-RegistryTree $Hive ($PathValue + '\' + $child)
    }
    return @{ Path = $PathValue; Exists = $true; Values = $values; Children = $children }
  } finally {
    $key.Dispose()
  }
}

function Restore-RegistryTree(
  [Microsoft.Win32.RegistryKey]$Hive,
  $Snapshot,
  [string]$AuthorizedRoot = ''
) {
  $path = [string]$Snapshot.Path
  if ([string]::IsNullOrWhiteSpace($AuthorizedRoot)) { $AuthorizedRoot = $path }
  if (-not [string]::Equals($path, $AuthorizedRoot, [StringComparison]::OrdinalIgnoreCase) -and
      -not $path.StartsWith($AuthorizedRoot.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "The registry recovery path is outside its authorized subtree: $path"
  }
  $Hive.DeleteSubKeyTree($path, $false)
  if (-not [bool]$Snapshot.Exists) { return }
  $key = $Hive.CreateSubKey([string]$Snapshot.Path, $true)
  try {
    foreach ($record in @($Snapshot.Values)) {
      $kind = [Microsoft.Win32.RegistryValueKind]([Enum]::Parse(
        [Microsoft.Win32.RegistryValueKind], [string]$record.Kind
      ))
      $key.SetValue([string]$record.Name, (Convert-RegistryValueFromJson $record), $kind)
    }
  } finally {
    $key.Dispose()
  }
  foreach ($child in @($Snapshot.Children)) {
    Restore-RegistryTree $Hive $child $AuthorizedRoot
  }
}

function Get-UserPathSnapshot {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
  if ($null -eq $key) { return @{ Exists = $false; Kind = ''; Value = $null } }
  try {
    if (-not ($key.GetValueNames() -contains 'Path')) {
      return @{ Exists = $false; Kind = ''; Value = $null }
    }
    $value = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $encoded = Convert-RegistryValueForJson $value
    return @{
      Exists = $true
      Kind = [string]$key.GetValueKind('Path')
      Encoding = $encoded.Encoding
      Value = $encoded.Value
    }
  } finally {
    $key.Dispose()
  }
}

function Restore-UserPathSnapshot($Snapshot) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment', $true)
  try {
    if (-not [bool]$Snapshot.Exists) {
      $key.DeleteValue('Path', $false)
      return
    }
    $kind = [Microsoft.Win32.RegistryValueKind]([Enum]::Parse(
      [Microsoft.Win32.RegistryValueKind], [string]$Snapshot.Kind
    ))
    $key.SetValue('Path', (Convert-RegistryValueFromJson $Snapshot), $kind)
  } finally {
    $key.Dispose()
  }
}

function Get-ShortcutRoots {
  if ((Get-NormalizedInstallMode) -eq 'all') {
    $roots = @(
      (Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_COMMON_DESKTOP')),
      (Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_COMMON_PROGRAMS'))
    )
  } else {
    $roots = @(
      (Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_CURRENT_DESKTOP')),
      (Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_CURRENT_PROGRAMS'))
    )
  }
  return $roots | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Get-ShortcutSnapshot([string]$BackupRoot) {
  $names = @('Kun.lnk', 'DeepSeek GUI.lnk')
  $records = @()
  $index = 0
  foreach ($root in @(Get-ShortcutRoots)) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($path in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $names -contains $_.Name } | ForEach-Object { $_.FullName })) {
      $backup = Join-Path $BackupRoot ('shortcut-' + $index + '.lnk')
      Copy-Item -LiteralPath $path -Destination $backup -Force
      $records += @{ Path = $path; Backup = $backup }
      $index += 1
    }
  }
  return $records
}

function Remove-TransactionShortcuts {
  foreach ($root in @(Get-ShortcutRoots)) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($path in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction Stop |
        Where-Object { @('Kun.lnk', 'DeepSeek GUI.lnk') -contains $_.Name })) {
      Remove-Item -LiteralPath $path.FullName -Force -ErrorAction Stop
    }
  }
}

function Assert-ShortcutPathAuthorized([string]$PathValue) {
  foreach ($root in @(Get-ShortcutRoots)) {
    if ((Test-PathWithin $PathValue $root) -and -not (Test-PathEqual $PathValue $root)) { return }
  }
  throw "The shortcut recovery path is outside the authorized shell roots: $PathValue"
}

function Restore-ShortcutSnapshot($Records) {
  Remove-TransactionShortcuts
  foreach ($record in @($Records)) {
    if (@($record.PSObject.Properties).Count -eq 0) { continue }
    $path = Normalize-FullPath ([string]$record.Path)
    Assert-ShortcutPathAuthorized $path
    $backup = Normalize-FullPath ([string]$record.Backup)
    if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
      throw "A shortcut recovery file is missing: $backup"
    }
    [IO.Directory]::CreateDirectory((Split-Path -Parent $path)) | Out-Null
    Copy-Item -LiteralPath $backup -Destination $path -Force
  }
}

function Assert-UpdateTransactionStorage {
  Assert-JournalStorageTrusted
  $path = Get-UpdateTransactionPath
  $parent = Split-Path -Parent $path
  $journalParent = Split-Path -Parent (Get-JournalPath)
  if (-not (Test-PathEqual $parent $journalParent)) {
    throw 'The automatic update transaction must share the trusted recovery journal directory.'
  }
  if ((Test-Path -LiteralPath $path) -and
      (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Test-ReparsePoint $path))) {
    throw "The automatic update transaction is not a trusted regular file: $path"
  }
  if ((Test-Path -LiteralPath $path -PathType Leaf) -and
      -not (Test-JournalAclSecure $path (Get-NormalizedInstallMode))) {
    throw "The automatic update transaction ACL is not trusted: $path"
  }
}

function Write-UpdateTransaction([hashtable]$Transaction) {
  Assert-UpdateTransactionStorage
  $path = Get-UpdateTransactionPath
  $parent = Split-Path -Parent $path
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  $temporary = "$path.$PID.tmp"
  $Transaction.SchemaVersion = 4
  $Transaction.AppGuid = Get-JournalAppGuid
  $Transaction.InstallMode = Get-NormalizedInstallMode
  $Transaction.UpdatedAt = [DateTime]::UtcNow.ToString('o')
  $Transaction | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $path -Force
  Set-SecureJournalFileAcl $path (Get-NormalizedInstallMode)
}

function Assert-UpdateTransactionPaths($Transaction) {
  $target = Get-JournalTarget
  $transactionPath = Get-UpdateTransactionPath
  $expected = @{
    Source = Get-RecoveryPayloadSource
    Target = $target
    BackupRoot = Get-InPlacePayloadBackupPath
    AssetsRoot = "$transactionPath.assets"
    HealthResult = Get-UpdateHealthResultPath
  }
  foreach ($name in $expected.Keys) {
    $actualPath = Normalize-FullPath ([string]$Transaction.$name)
    $expectedPath = Normalize-FullPath ([string]$expected[$name])
    if ([string]::IsNullOrWhiteSpace($actualPath) -or -not (Test-PathEqual $actualPath $expectedPath)) {
      throw "The automatic update transaction $name path is not authorized: $actualPath"
    }
  }
  $stage = Normalize-FullPath ([string]$Transaction.StageRoot)
  if (-not (Test-PathEqual $stage (Get-UpdateStageRoot))) {
    throw "The automatic update transaction StageRoot path is not authorized: $stage"
  }
  $targetParent = Split-Path -Parent $target
  $targetLeaf = Split-Path -Leaf $target
  foreach ($name in @('OldPayloadRoot', 'FailedPayloadRoot')) {
    $actualPath = Normalize-FullPath ([string]$Transaction.$name)
    $actualLeaf = Split-Path -Leaf $actualPath
    $expectedLeaf = switch ($name) {
      'OldPayloadRoot' { '^' + [Regex]::Escape($targetLeaf + '.kun-old-') + '[0-9]+$' }
      'FailedPayloadRoot' { '^' + [Regex]::Escape($targetLeaf + '.kun-failed') + '$' }
    }
    $isAuthorized = (Test-PathEqual (Split-Path -Parent $actualPath) $targetParent) -and
      $actualLeaf -match $expectedLeaf
    if ([string]::IsNullOrWhiteSpace($actualPath) -or -not $isAuthorized) {
      throw "The automatic update transaction $name path is not authorized: $actualPath"
    }
  }
  foreach ($record in @($Transaction.Shortcuts)) {
    if (@($record.PSObject.Properties).Count -eq 0) { continue }
    $backup = Normalize-FullPath ([string]$record.Backup)
    if (-not (Test-PathWithin $backup ([string]$expected.AssetsRoot)) -or
        (Test-PathEqual $backup ([string]$expected.AssetsRoot))) {
      throw "The shortcut recovery file is outside the transaction assets directory: $backup"
    }
    Assert-ShortcutPathAuthorized (Normalize-FullPath ([string]$record.Path))
  }
}

function Read-UpdateTransaction {
  $path = Get-UpdateTransactionPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  Assert-UpdateTransactionStorage
  if (Test-ReparsePoint $path) { throw "The update transaction is a reparse point: $path" }
  $transaction = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ([int]$transaction.SchemaVersion -ne 4) { throw 'The automatic update transaction schema is unsupported.' }
  if (-not [string]::Equals([string]$transaction.AppGuid, (Get-JournalAppGuid), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The automatic update transaction application identity does not match.'
  }
  if (-not [string]::Equals([string]$transaction.InstallMode, (Get-NormalizedInstallMode), [StringComparison]::Ordinal)) {
    throw 'The automatic update transaction installation mode does not match.'
  }
  Assert-UpdateTransactionPaths $transaction
  return $transaction
}

function Recover-PendingUpdateTransaction {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { return }
  if (@('rolled_back', 'finalizing') -contains [string]$transaction.Phase) {
    Finalize-TerminalUpdateTransaction
    return
  }
  # A candidate can pass the installer probe yet fail before its first complete
  # application startup. Keep recovery data rollback-capable until the app
  # explicitly finalizes it after its runtime health check.
  Invoke-RollbackUpdateTransaction
}

function Set-UpdateTransactionPhase($Transaction, [string]$Phase) {
  $copy = @{}
  foreach ($property in $Transaction.PSObject.Properties) { $copy[$property.Name] = $property.Value }
  $copy.Phase = $Phase
  Write-UpdateTransaction $copy
  return (Read-UpdateTransaction)
}

function Initialize-UpdateTransaction {
  if (-not (Test-AutomaticUpdateRequested)) { return }
  Assert-UpdateTransactionStorage
  $existing = Read-UpdateTransaction
  if ($null -ne $existing -and @('committed', 'rolled_back') -contains [string]$existing.Phase) {
    Finalize-TerminalUpdateTransaction
    $existing = $null
  }
  if ($null -ne $existing) {
    Invoke-RollbackUpdateTransaction
  }

  $source = Get-RecoveryPayloadSource
  $target = Get-JournalTarget
  $stage = Get-UpdateStageRoot
  $backup = Get-InPlacePayloadBackupPath
  Assert-RecoveryPayload $source
  Assert-SafeInstallRoot $stage 'Automatic update stage'
  if (-not [string]::Equals([IO.Path]::GetPathRoot($stage), [IO.Path]::GetPathRoot($target), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The automatic update stage must be on the target volume.'
  }
  $transactionPath = Get-UpdateTransactionPath
  $assets = "$transactionPath.assets"
  foreach ($path in @($stage, ($target + '.kun-failed'), $assets)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  }
  [IO.Directory]::CreateDirectory($assets) | Out-Null

  $inPlace = [bool](Test-PathEqual $source $target)
  $recoveryRoot = $source
  if ($inPlace) {
    Backup-InPlacePayload
    $recoveryRoot = $backup
  }
  $registry = @()
  $hiveName = if ((Get-NormalizedInstallMode) -eq 'all') { 'LocalMachine' } else { 'CurrentUser' }
  $hive = Open-TransactionRegistryHive $hiveName
  try {
    foreach ($keyName in @(Get-TransactionRegistryKeyNames)) {
      $registry += @{ Hive = $hiveName; Snapshot = Export-RegistryTree $hive $keyName }
    }
  } finally { $hive.Dispose() }
  if ((Get-NormalizedInstallMode) -eq 'all' -and
      [string]::Equals((Get-EnvironmentValue 'KUN_INSTALLER_PRESERVE_OTHER_SCOPE'), '1', [StringComparison]::Ordinal)) {
    $uninstallKey = (Get-TransactionRegistryKeyNames)[1]
    $hive = Open-TransactionRegistryHive 'CurrentUser'
    try {
      $registry += @{ Hive = 'CurrentUser'; Snapshot = Export-RegistryTree $hive $uninstallKey }
    } finally { $hive.Dispose() }
  }
  $transaction = @{
    TransactionId = [Guid]::NewGuid().ToString('N')
    Phase = 'prepared'
    NewVersion = Get-EnvironmentValue 'KUN_INSTALLER_NEW_VERSION'
    OldVersion = Get-EnvironmentValue 'KUN_INSTALLER_OLD_VERSION'
    Source = $source
    Target = $target
    StageRoot = $stage
    OldPayloadRoot = $target + '.kun-old-' + (Get-EnvironmentValue 'KUN_INSTALLER_SELF_PID')
    FailedPayloadRoot = $target + '.kun-failed'
    BackupRoot = $backup
    AssetsRoot = $assets
    InPlace = $inPlace
    RecoveryExecutable = Find-RecoveryPayloadExecutable $recoveryRoot
    RecoveryAppAsar = Join-Path $recoveryRoot 'resources\app.asar'
    Registry = $registry
    UserPath = Get-UserPathSnapshot
    Shortcuts = @(Get-ShortcutSnapshot $assets)
    HealthResult = Get-UpdateHealthResultPath
    HealthToken = [Guid]::NewGuid().ToString('N')
    CompletedMutations = @()
    RollbackOutcome = 'not_started'
  }
  Write-UpdateTransaction $transaction
  Write-InstallerResult $stage
}

function Invoke-SwitchUpdatePayload {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  $stage = Normalize-FullPath ([string]$transaction.StageRoot)
  $target = Normalize-FullPath ([string]$transaction.Target)
  $old = Normalize-FullPath ([string]$transaction.OldPayloadRoot)
  Invoke-InstallerFaultPoint 'validate.before_check'
  Assert-PackagedInstallPayloadAt $stage
  if ([string]$transaction.Phase -eq 'payload_switched') { return }
  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
  if (Test-Path -LiteralPath $target) {
    if (Test-PathEqual ([string]$transaction.Source) $target) {
      Move-Item -LiteralPath $target -Destination $old
    } elseif (@(Get-ChildItem -LiteralPath $target -Force).Count -eq 0) {
      Remove-Item -LiteralPath $target -Force
    } else {
      throw "The automatic update target became occupied before payload cutover: $target"
    }
  }
  try {
    Move-Item -LiteralPath $stage -Destination $target
  } catch {
    if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $target)) {
      Move-Item -LiteralPath $old -Destination $target
    }
    throw
  }
  Assert-PackagedInstallPayloadAt $target
  Set-UpdateTransactionPhase $transaction 'payload_switched' | Out-Null
}

function Assert-PackagedInstallPayloadAt([string]$Root) {
  $previous = Get-EnvironmentValue 'KUN_INSTALLER_TARGET'
  try {
    [Environment]::SetEnvironmentVariable('KUN_INSTALLER_TARGET', $Root, 'Process')
    Assert-PackagedInstallPayload
  } finally {
    [Environment]::SetEnvironmentVariable('KUN_INSTALLER_TARGET', $previous, 'Process')
  }
}

function Test-ShortcutTarget([string]$PathValue, [string]$ExpectedExecutable) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($PathValue)
  return Test-PathEqual ([string]$shortcut.TargetPath) $ExpectedExecutable
}

function Assert-RegistryTreeNoStage($Hive, [string]$KeyName, [string]$Stage) {
  $key = $Hive.OpenSubKey($KeyName, $false)
  if ($null -eq $key) { return }
  try {
    foreach ($name in @($key.GetValueNames())) {
      $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($value -is [string] -and $value.IndexOf($Stage, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "The committed registry value references the staging directory: $KeyName/$name"
      }
    }
    foreach ($child in @($key.GetSubKeyNames())) {
      Assert-RegistryTreeNoStage $Hive ($KeyName + '\\' + $child) $Stage
    }
  } finally { $key.Dispose() }
}

function Assert-UpdateCutover {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  $target = Normalize-FullPath ([string]$transaction.Target)
  $stage = Normalize-FullPath ([string]$transaction.StageRoot)
  Assert-PackagedInstallPayloadAt $target
  $hive = Open-TransactionRegistryHive
  try {
    foreach ($keyName in @(Get-TransactionRegistryKeyNames)) {
      Assert-RegistryTreeNoStage $hive $keyName $stage
    }
    foreach ($keyName in @(Get-TransactionRegistryKeyNames)) {
      $key = $hive.OpenSubKey($keyName, $false)
      if ($null -eq $key) { throw "The committed installer registry key is missing: $keyName" }
      try {
        foreach ($name in @($key.GetValueNames())) {
          $value = [string]$key.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          if (-not [string]::IsNullOrWhiteSpace($stage) -and $value.IndexOf($stage, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "The committed registry value references the staging directory: $keyName/$name"
          }
        }
      } finally { $key.Dispose() }
    }
    $installKey = $hive.OpenSubKey((Get-TransactionRegistryKeyNames)[0], $false)
    try {
      if ($null -eq $installKey -or -not (Test-PathEqual ([string]$installKey.GetValue('InstallLocation')) $target)) {
        throw 'The committed InstallLocation does not reference the final target.'
      }
    } finally { if ($null -ne $installKey) { $installKey.Dispose() } }
  } finally { $hive.Dispose() }
  $expectedExecutable = Join-Path $target (Get-ExpectedApplicationExecutable)
  $shortcutCount = 0
  foreach ($root in @(Get-ShortcutRoots)) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($shortcut in @(Get-ChildItem -LiteralPath $root -Filter 'Kun.lnk' -File -Recurse -ErrorAction SilentlyContinue)) {
      $shortcutCount += 1
      if (-not (Test-ShortcutTarget $shortcut.FullName $expectedExecutable)) {
        throw "A committed Kun shortcut does not reference the final executable: $($shortcut.FullName)"
      }
    }
  }
  if ($shortcutCount -eq 0) {
    throw 'No committed Kun shortcut exists for the selected install scope.'
  }
  Set-UpdateTransactionPhase $transaction 'awaiting_health' | Out-Null
}

function Restore-TransactionPayloadBackup($Transaction) {
  $backup = Normalize-FullPath ([string]$Transaction.BackupRoot)
  $source = Normalize-FullPath ([string]$Transaction.Source)
  Assert-RecoveryPayload $backup
  Assert-SafeInstallRoot $source 'Automatic update recovery destination'
  [IO.Directory]::CreateDirectory($source) | Out-Null
  foreach ($entry in @(Get-ChildItem -LiteralPath $backup -Force)) {
    if ($entry.PSIsContainer) { Assert-NoReparsePointsInTree $entry 'Automatic update transaction backup' }
    elseif (Test-ReparsePoint $entry.FullName) { throw "Automatic update transaction backup is a reparse point: $($entry.FullName)" }
    Copy-Item -LiteralPath $entry.FullName -Destination $source -Recurse -Force
  }
  Assert-RecoveryPayload $source
}

function Invoke-RollbackUpdateTransaction {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) {
    return
  }
  try {
    $transaction = Set-UpdateTransactionPhase $transaction 'rolling_back'
    $target = Normalize-FullPath ([string]$transaction.Target)
    $old = Normalize-FullPath ([string]$transaction.OldPayloadRoot)
    $failed = Normalize-FullPath ([string]$transaction.FailedPayloadRoot)
    $stopResult = Stop-AppProcesses @($target)
    if ($stopResult.Outcome -ne 'stopped') {
      throw 'The candidate application could not be stopped before rollback.'
    }
    if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
    if (Test-Path -LiteralPath $target) {
      if ((Test-PathEqual ([string]$transaction.Source) $target) -and (Test-Path -LiteralPath $old)) {
        Move-Item -LiteralPath $target -Destination $failed
      } elseif (-not (Test-PathEqual ([string]$transaction.Source) $target)) {
        Move-Item -LiteralPath $target -Destination $failed
      }
    }
    if ([bool]$transaction.InPlace -and (Test-Path -LiteralPath $old)) {
      Move-Item -LiteralPath $old -Destination $target
    }
    if ([bool]$transaction.InPlace) {
      Restore-TransactionPayloadBackup $transaction
    } else {
      Assert-RecoveryPayload (Normalize-FullPath ([string]$transaction.Source))
    }
    $previousTarget = Get-EnvironmentValue 'KUN_INSTALLER_TARGET'
    [Environment]::SetEnvironmentVariable('KUN_INSTALLER_TARGET', [string]$transaction.Target, 'Process')
    try {
      if ([bool]$transaction.InPlace) {
        $unknownJournal = Read-Journal
        if ($null -ne $unknownJournal) {
          foreach ($record in @(Get-JournalRecords $unknownJournal)) {
            $validated = Get-ValidatedJournalRecord $record
            if (Test-Path -LiteralPath $validated.Stash) {
              Remove-Item -LiteralPath $validated.Stash -Recurse -Force
            }
          }
          Remove-Journal
        }
      } else {
        Invoke-RestoreJournal
      }
    } finally {
      [Environment]::SetEnvironmentVariable('KUN_INSTALLER_TARGET', $previousTarget, 'Process')
    }
    $authorizedRegistryRoots = @(Get-TransactionRegistryKeyNames)
    foreach ($record in @($transaction.Registry)) {
      $recordPath = [string]$record.Snapshot.Path
      if (-not ($authorizedRegistryRoots | Where-Object {
        [string]::Equals($_, $recordPath, [StringComparison]::OrdinalIgnoreCase)
      })) {
        throw "The registry recovery root is not authorized: $recordPath"
      }
      $hive = Open-TransactionRegistryHive ([string]$record.Hive)
      try { Restore-RegistryTree $hive $record.Snapshot $recordPath } finally { $hive.Dispose() }
    }
    Restore-ShortcutSnapshot $transaction.Shortcuts
    Restore-UserPathSnapshot $transaction.UserPath
    foreach ($path in @(
      ([string]$transaction.StageRoot),
      ([string]$transaction.FailedPayloadRoot),
      ([string]$transaction.AssetsRoot)
    )) {
      if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
        Remove-Item -LiteralPath $path -Recurse -Force
      }
    }
    Assert-RecoveryPayload (Normalize-FullPath ([string]$transaction.Source))
    $copy = @{}
    foreach ($property in $transaction.PSObject.Properties) { $copy[$property.Name] = $property.Value }
    $copy.Phase = 'rolled_back'
    $copy.RollbackOutcome = 'succeeded'
    Write-UpdateTransaction $copy
  } catch {
    $copy = @{}
    if ($null -ne $transaction) {
      foreach ($property in $transaction.PSObject.Properties) { $copy[$property.Name] = $property.Value }
      $copy.Phase = 'rollback_incomplete'
      $copy.RollbackOutcome = 'failed'
      $copy.RollbackError = $_.Exception.Message
      Write-UpdateTransaction $copy
    }
    throw
  }
}

function Resolve-UpdateHealthToken {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  Write-InstallerResult ([string]$transaction.HealthToken)
}

function Remove-LegacyTransactionShortcuts {
  foreach ($root in @(Get-ShortcutRoots)) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($path in @(Get-ChildItem -LiteralPath $root -Filter 'DeepSeek GUI.lnk' -File -Recurse -Force)) {
      Remove-Item -LiteralPath $path.FullName -Force
    }
  }
}

function Invoke-CommitUpdateTransaction {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  if ([string]$transaction.Phase -ne 'cleanup_pending') {
    Assert-UpdateHealthResult
    $transaction = Set-UpdateTransactionPhase $transaction 'cleanup_pending'
    Invoke-InstallerFaultPoint 'commit.after_journal'
  }
  Remove-LegacyTransactionShortcuts
  # Retain payload, registry/PATH, shortcut and journal recovery artifacts
  # through the first complete application startup. FinalizeUpdateTransaction
  # performs this cleanup only after the runtime health handshake succeeds.
  Set-UpdateTransactionPhase $transaction 'committed' | Out-Null
}

function Finalize-TerminalUpdateTransaction {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { return }
  if (@('committed', 'finalizing', 'rolled_back') -notcontains [string]$transaction.Phase) {
    throw 'The automatic update transaction is not terminal.'
  }
  if ([string]$transaction.Phase -eq 'committed') {
    $transaction = Set-UpdateTransactionPhase $transaction 'finalizing'
  }
  if ([string]$transaction.Phase -eq 'finalizing' -and -not [bool]$transaction.InPlace) {
    Remove-RetiredApplicationPayload (Normalize-FullPath ([string]$transaction.Source))
  }
  foreach ($path in @(
    ([string]$transaction.OldPayloadRoot),
    ([string]$transaction.FailedPayloadRoot),
    ([string]$transaction.StageRoot),
    ([string]$transaction.BackupRoot),
    ([string]$transaction.AssetsRoot),
    ([string]$transaction.HealthResult)
  )) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
  Remove-Item -LiteralPath (Get-UpdateTransactionPath) -Force
  Remove-Journal
}
