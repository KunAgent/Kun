# Called twice, before and after the installer opens its read-share-only handle.
# Never creates, rewrites or removes GUI recovery metadata.
function Assert-PendingUpdateLease {
  $pendingPath = Get-EnvironmentValue 'KUN_PENDING_UPDATE_PATH'
  $resultPath = Get-EnvironmentValue 'KUN_PENDING_UPDATE_RESULT'
  foreach ($path in @($pendingPath, $resultPath)) {
    if ([string]::IsNullOrWhiteSpace($path) -or $path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])' -or
        -not (Test-PathEqual $path (Normalize-FullPath $path))) {
      throw 'The GUI update record path is not absolute.'
    }
    Assert-NoReparsePathComponents $path 'GUI update record'
  }
  if ([IO.Path]::GetFileName($pendingPath) -cne 'pending-update.json' -or
      [IO.Path]::GetFileName($resultPath) -cne 'pending-update-result.json' -or
      -not (Test-PathEqual (Split-Path -Parent $pendingPath) (Split-Path -Parent $resultPath))) {
    throw 'The GUI update record paths do not identify a single profile.'
  }
  $file = Get-Item -LiteralPath $pendingPath -Force
  if ($file.PSIsContainer -or $file.Length -gt 65536) { throw 'The GUI update record is not a bounded file.' }
  # Bound the actual read as well as the pre-open length, including a writer
  # racing the first validation before NSIS acquires the long-lived handle.
  $reader = [IO.File]::OpenText($pendingPath)
  try {
    $buffer = New-Object char[] 65537
    $count = $reader.ReadBlock($buffer, 0, $buffer.Length)
    if ($count -gt 65536) { throw 'The GUI update record exceeded its size limit.' }
    $text = [string]::new($buffer, 0, $count)
    try { $pending = $text | ConvertFrom-Json }
    catch { throw 'The GUI update record could not be parsed.' }
  } finally { $reader.Dispose() }
  if ($pending.schemaVersion -ne 1 -or $pending.state -cne 'installing') {
    throw 'The GUI update record is not an installing transaction.'
  }
  $oldVersion = Get-EnvironmentValue 'KUN_INSTALLER_OLD_VERSION'
  $newVersion = Get-EnvironmentValue 'KUN_INSTALLER_NEW_VERSION'
  if ([string]::IsNullOrWhiteSpace($oldVersion) -or [string]::IsNullOrWhiteSpace($newVersion) -or
      $pending.oldVersion -cne $oldVersion -or $pending.newVersion -cne $newVersion -or
      $newVersion -cne (Get-EnvironmentValue 'KUN_INSTALLER_PENDING_VERSION') -or
      -not (Test-PathEqual ([string]$pending.installDir) (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE'))) {
    throw 'The GUI update record does not match the selected source and versions.'
  }
  $installer = Get-EnvironmentValue 'KUN_INSTALLER_PENDING_EXECUTABLE'
  if ([string]::IsNullOrWhiteSpace($installer) -or
      -not (Test-PathEqual ([string]$pending.installerPath) $installer)) {
    throw 'The GUI update record does not match the running installer.'
  }
  Assert-NoReparsePathComponents $installer 'GUI update installer'
  $stream = [IO.File]::OpenRead($installer)
  $sha = [Security.Cryptography.SHA512]::Create()
  try { $digest = [Convert]::ToBase64String($sha.ComputeHash($stream)) }
  finally { $sha.Dispose(); $stream.Dispose() }
  if ($pending.installerSha512 -cne $digest) { throw 'The GUI update installer digest does not match.' }
}
