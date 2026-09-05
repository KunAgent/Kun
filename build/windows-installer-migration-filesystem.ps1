function Get-PathHash([string]$PathValue) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes((Normalize-FullPath $PathValue).ToLowerInvariant())
    $hash = $sha.ComputeHash($bytes)
    return ([BitConverter]::ToString($hash).Replace('-', '').Substring(0, 16)).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-PreservationRoot([string]$Source) {
  $parent = Split-Path -Parent $Source
  return Join-Path $parent ('.kun-installer-preserved-' + (Get-PathHash $Source))
}

function Test-ReparsePoint([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) {
    return $false
  }
  $item = Get-Item -LiteralPath $PathValue -Force
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Get-UnsafeRoots {
  $userPrograms = $null
  if ($env:LOCALAPPDATA) {
    $userPrograms = Join-Path $env:LOCALAPPDATA 'Programs'
  }
  $candidates = @(
    $env:USERPROFILE,
    $env:LOCALAPPDATA,
    $env:APPDATA,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:ProgramW6432,
    $env:WINDIR,
    $env:SystemRoot,
    $env:TEMP,
    $userPrograms
  )

  return @($candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    Normalize-FullPath $_
  } | Select-Object -Unique)
}

function Assert-NoReparsePathComponents([string]$PathValue, [string]$Label) {
  $current = Normalize-FullPath $PathValue
  while (-not [string]::IsNullOrWhiteSpace($current)) {
    if ((Test-Path -LiteralPath $current) -and (Test-ReparsePoint $current)) {
      throw "$Label path contains a reparse point: $current"
    }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or (Test-PathEqual $parent $current)) {
      break
    }
    $current = $parent
  }
}

function Assert-NoReparsePointsInTree([IO.FileSystemInfo]$Entry, [string]$Label) {
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($Entry.FullName)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    if (Test-ReparsePoint $current) {
      throw "$Label contains a reparse point: $current"
    }
    if (-not (Test-Path -LiteralPath $current -PathType Container)) {
      continue
    }
    foreach ($child in @(Get-ChildItem -LiteralPath $current -Force)) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label contains a reparse point: $($child.FullName)"
      }
      if ($child.PSIsContainer) {
        $pending.Push($child.FullName)
      }
    }
  }
}

function Assert-SafeInstallRoot([string]$PathValue, [string]$Label) {
  $normalized = Normalize-FullPath $PathValue
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return
  }

  if (Test-PathEqual $normalized ([IO.Path]::GetPathRoot($normalized))) {
    throw "$Label path is a shared or protected root: $normalized"
  }

  foreach ($unsafe in (Get-UnsafeRoots)) {
    if (Test-PathEqual $normalized $unsafe) {
      throw "$Label path is a shared or protected root: $normalized"
    }
  }

  foreach ($systemRoot in @($env:WINDIR, $env:SystemRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($systemRoot) -and (Test-PathWithin $normalized $systemRoot)) {
      throw "$Label path is inside a Windows system directory: $normalized"
    }
  }

  Assert-NoReparsePathComponents $normalized $Label
}

function Assert-TargetVolumeReadyAndWritable([string]$Target) {
  $targetPath = Normalize-FullPath $Target
  $root = [IO.Path]::GetPathRoot($targetPath)
  if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "The target volume is unavailable: $root"
  }

  if ($root -match '^[A-Za-z]:\\$') {
    try {
      $drive = [IO.DriveInfo]::new($root)
      if (-not $drive.IsReady) {
        throw "The target volume is not ready: $root"
      }
    } catch {
      throw "The target volume is not ready: $root. $($_.Exception.Message)"
    }
  }

  $probeDirectory = $targetPath
  while (-not (Test-Path -LiteralPath $probeDirectory)) {
    $parent = Split-Path -Parent $probeDirectory
    if ([string]::IsNullOrWhiteSpace($parent) -or (Test-PathEqual $parent $probeDirectory)) {
      throw "No existing target directory is available for a write probe: $targetPath"
    }
    $probeDirectory = $parent
  }
  if (-not (Test-Path -LiteralPath $probeDirectory -PathType Container)) {
    throw "The nearest existing target ancestor is not a directory: $probeDirectory"
  }

  $probePath = Join-Path $probeDirectory ('.kun-installer-write-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $stream = [IO.File]::Open(
      $probePath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    $stream.Dispose()
    Remove-Item -LiteralPath $probePath -Force
  } catch {
    if (Test-Path -LiteralPath $probePath) {
      Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
    throw "The target directory is not writable: $probeDirectory. $($_.Exception.Message)"
  }
}

function Test-KnownApplicationEntry([IO.FileSystemInfo]$Entry) {
  if ($Entry.PSIsContainer) {
    return @('resources', 'locales', 'bin') -contains $Entry.Name.ToLowerInvariant()
  }

  $knownFiles = @(@(
    Get-ApplicationIdentityFiles
    Get-AppSpecificUninstallerFiles
  ) | ForEach-Object { $_.ToLowerInvariant() }) + @(
    'uninstallericon.ico',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll',
    'ffmpeg.dll',
    'icudtl.dat',
    'libegl.dll',
    'libglesv2.dll',
    'license.electron.txt',
    'licenses.chromium.html',
    'resources.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll'
  )
  return $knownFiles -contains $Entry.Name.ToLowerInvariant()
}

function Get-ExtendedLengthPath([string]$PathValue) {
  $normalized = Normalize-FullPath $PathValue
  if ($normalized.StartsWith('\\')) {
    return '\\?\UNC\' + $normalized.Substring(2)
  }
  return '\\?\' + $normalized
}

function Remove-KnownApplicationEntry([IO.FileSystemInfo]$Entry) {
  if ($Entry.PSIsContainer -and (Test-ReparsePoint $Entry.FullName)) {
    throw "Recognized application directory is a reparse point: $($Entry.FullName)"
  }

  try {
    Remove-Item -LiteralPath $Entry.FullName -Recurse -Force
    return
  } catch {
    if (-not (Test-Path -LiteralPath $Entry.FullName)) {
      return
    }
  }

  $extendedPath = Get-ExtendedLengthPath $Entry.FullName
  if ($Entry.PSIsContainer) {
    [IO.Directory]::Delete($extendedPath, $true)
  } else {
    [IO.File]::SetAttributes($extendedPath, [IO.FileAttributes]::Normal)
    [IO.File]::Delete($extendedPath)
  }
}

function Test-InstallerSelfEntry([IO.FileSystemInfo]$Entry, [string]$Source) {
  $selfPath = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SELF_PATH')
  if ([string]::IsNullOrWhiteSpace($selfPath) -or $Entry.PSIsContainer) {
    return $false
  }
  $parent = Normalize-FullPath (Split-Path -Parent $selfPath)
  return (Test-PathEqual $parent $Source) -and (Test-PathEqual $Entry.FullName $selfPath)
}

function Remove-RetiredApplicationPayload([string]$Source) {
  Assert-SafeInstallRoot $Source 'Retired application directory'
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  $cleanupCount = 0
  foreach ($entry in @(Get-ChildItem -LiteralPath $Source -Force | Where-Object {
    (Test-KnownApplicationEntry $_) -and -not (Test-InstallerSelfEntry $_ $Source)
  })) {
    if ($entry.PSIsContainer) { Assert-NoReparsePointsInTree $entry 'Retired application directory' }
    Remove-KnownApplicationEntry $entry
    $cleanupCount += 1
    if ($cleanupCount -eq 1) { Invoke-InstallerFaultPoint 'finalize.after_first_cleanup' }
  }
  if (@(Get-ChildItem -LiteralPath $Source -Force).Count -eq 0) {
    Remove-Item -LiteralPath $Source -Force
  }
}

function Test-AppOwnedProcessPath([string]$ExecutablePath, [string[]]$Roots) {
  if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
    return $false
  }

  $fullExecutable = Normalize-FullPath $ExecutablePath
  foreach ($rootValue in $Roots) {
    if ([string]::IsNullOrWhiteSpace($rootValue)) {
      continue
    }
    $root = Normalize-FullPath $rootValue
    $relative = $fullExecutable.Substring([Math]::Min($root.Length, $fullExecutable.Length)).TrimStart('\', '/')
    $isUnderRoot = $fullExecutable.Length -gt $root.Length -and
      $fullExecutable.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
    if (-not $isUnderRoot) {
      continue
    }

    $relativeLower = $relative.ToLowerInvariant()
    $identityMatch = Get-ApplicationIdentityFiles | Where-Object {
      [string]::Equals($_, $relative, [StringComparison]::OrdinalIgnoreCase)
    }
    if ($identityMatch -or
        $relativeLower.StartsWith('resources\') -or $relativeLower.StartsWith('bin\')) {
      return $true
    }
  }
  return $false
}

function Stop-AppProcesses([string[]]$Roots) {
  $currentPidValue = Get-EnvironmentValue 'KUN_INSTALLER_SELF_PID'
  $currentPid = 0
  [void][int]::TryParse($currentPidValue, [ref]$currentPid)

  for ($attempt = 0; $attempt -lt 6; $attempt += 1) {
    $processes = @(Get-VerifiedAppProcesses $Roots $currentPid)
    if ($processes.Count -eq 0) {
      return @{ Outcome = 'stopped'; ProcessIds = @(); Processes = @() }
    }

    foreach ($process in $processes) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $process.ProcessId /T /F | Out-Null
    }
    Start-Sleep -Milliseconds 500
  }

  $remaining = @(Get-VerifiedAppProcesses $Roots $currentPid)
  if ($remaining.Count -gt 0) {
    return @{
      Outcome = 'running'
      ProcessIds = @($remaining | ForEach-Object { [int]($_.ProcessId) })
      Processes = @($remaining | ForEach-Object { ConvertTo-BlockingProcessDiagnostic $_ })
    }
  }
  return @{ Outcome = 'stopped'; ProcessIds = @(); Processes = @() }
}

function ConvertTo-BlockingProcessDiagnostic($Process) {
  return [ordered]@{
    processId = [int]$Process.ProcessId
    parentProcessId = [int]$Process.ParentProcessId
    name = [string]$Process.Name
    executablePath = [string]$Process.ExecutablePath
  }
}

function Write-BlockingProcessDiagnostic($StopResult) {
  if ($null -eq $StopResult -or $StopResult.Outcome -ne 'running') {
    return
  }
  $processJson = ConvertTo-Json -InputObject @($StopResult.Processes) -Compress -Depth 3
  Write-InstallerDiagnostic "STOP_PROCESSES outcome=running processes=$processJson"
}

function Get-VerifiedAppProcesses([string[]]$Roots, [int]$CurrentPid) {
  try {
    $candidates = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  } catch {
    throw 'The installer could not inspect Windows processes.'
  }

  $owned = @()
  foreach ($candidate in $candidates) {
    if ($candidate.ProcessId -eq $CurrentPid) {
      continue
    }
    try {
      if (Test-AppOwnedProcessPath $candidate.ExecutablePath $Roots) {
        $owned += $candidate
      }
    } catch {
      throw 'The installer could not validate application process ownership.'
    }
  }
  return @($owned)
}

function Stop-InstallRootProcesses {
  $root = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_APP_ROOT')
  if ([string]::IsNullOrWhiteSpace($root)) {
    return @{ Outcome = 'stopped'; ProcessIds = @(); Processes = @() }
  }
  Assert-SafeInstallRoot $root 'Application root'
  Stop-AppProcesses @($root)
}

function Test-ApplicationSourceIdentity([string]$Source) {
  if ([string]::IsNullOrWhiteSpace($Source) -or
      -not (Test-Path -LiteralPath $Source -PathType Container)) {
    return $false
  }
  $identityFiles = Get-ApplicationIdentityFiles
  return [bool]($identityFiles | Where-Object {
    Test-Path -LiteralPath (Join-Path $Source $_) -PathType Leaf
  })
}

function Assert-ApplicationSourceIdentity([string]$Source) {
  if (-not (Test-ApplicationSourceIdentity $Source)) {
    throw "The registered source has no application identity executable: $Source"
  }
}

function Test-PackagedApplicationPayload([string]$Source) {
  if ([string]::IsNullOrWhiteSpace($Source)) {
    return $false
  }
  $packagedPayload = Join-Path (Join-Path $Source 'resources') 'app.asar'
  return (Test-Path -LiteralPath $packagedPayload -PathType Leaf)
}

function Assert-PackagedApplicationPayload([string]$Source) {
  if (-not (Test-PackagedApplicationPayload $Source)) {
    throw "The external current-user installation source is not a recognized packaged Kun installation: $Source"
  }
}

function Get-ExpectedApplicationExecutable {
  $configured = (Get-EnvironmentValue 'KUN_INSTALLER_APP_EXECUTABLE').Trim()
  $executable = if ([string]::IsNullOrWhiteSpace($configured)) {
    (Get-CanonicalLeaf) + '.exe'
  } else {
    $configured
  }
  if ([string]::IsNullOrWhiteSpace($executable) -or
      -not [string]::Equals([IO.Path]::GetFileName($executable), $executable, [StringComparison]::Ordinal) -or
      $executable.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
    throw "The configured application executable is invalid: $executable"
  }
  return $executable
}

function Assert-NonEmptyPayloadFile([string]$PathValue, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "The installed Kun payload is missing ${Label}: $PathValue"
  }

  $item = Get-Item -LiteralPath $PathValue -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "The installed Kun payload must not use a reparse point for ${Label}: $PathValue"
  }
  if ($item.Length -le 0) {
    throw "The installed Kun payload is empty for ${Label}: $PathValue"
  }
}

function Assert-PackagedInstallPayload {
  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'The installed Kun payload target is not configured.'
  }
  Assert-SafeInstallRoot $target 'Installed application root'
  if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    throw "The installed Kun payload directory is missing: $target"
  }

  Assert-NonEmptyPayloadFile (Join-Path $target (Get-ExpectedApplicationExecutable)) 'the application executable'
  Assert-NonEmptyPayloadFile (Join-Path $target 'resources\app.asar') 'resources\app.asar'
  Assert-NonEmptyPayloadFile (
    Join-Path $target 'resources\app.asar.unpacked\kun\dist\cli\serve-entry.js'
  ) 'the unpacked Kun runtime entry'
  Assert-NonEmptyPayloadFile (
    Join-Path $target 'resources\app.asar.unpacked\kun\dist\manager\manager-entry.js'
  ) 'the unpacked Kun service manager entry'
}

function Get-RecoveryPayloadSource {
  $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  if (-not [string]::IsNullOrWhiteSpace($source)) {
    return $source
  }
  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'KUN_INSTALLER_SOURCE or KUN_INSTALLER_TARGET is required for automatic update backup.'
  }
  return $target
}

function Find-RecoveryPayloadExecutable([string]$Root) {
  $candidates = @(
    (Get-ExpectedApplicationExecutable),
    'DeepSeek GUI.exe',
    'deepseek-gui.exe'
  ) | Select-Object -Unique
  foreach ($name in $candidates) {
    $path = Join-Path $Root $name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Assert-NonEmptyPayloadFile $path 'the recovery application executable'
      return $path
    }
  }
  throw "The automatic update backup has no recognized application executable: $Root"
}

function Assert-RecoveryPayload([string]$Root) {
  Assert-SafeInstallRoot $Root 'Automatic update recovery root'
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "The automatic update recovery payload directory is missing: $Root"
  }
  Find-RecoveryPayloadExecutable $Root | Out-Null
  Assert-NonEmptyPayloadFile (Join-Path $Root 'resources\\app.asar') 'the recovery resources\\app.asar'
}

function Get-InPlacePayloadBackupPath {
  $configured = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_PAYLOAD_BACKUP')
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    return $configured
  }
  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'KUN_INSTALLER_TARGET is required for in-place update backup.'
  }
  $recoveryRoot = Join-Path $env:APPDATA 'KunInstallerRecovery'
  return Join-Path $recoveryRoot ("update-backup-" + (Get-EnvironmentValue 'KUN_INSTALLER_SELF_PID'))
}

function Set-InPlacePayloadBackupEnvironment([string]$PathValue) {
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_PAYLOAD_BACKUP', $PathValue, 'Process')
}

function Backup-InPlacePayload {
  if (-not (Test-AutomaticUpdateRequested)) { return }
  $source = Get-RecoveryPayloadSource
  Assert-RecoveryPayload $source
  $backup = Get-InPlacePayloadBackupPath
  if (Test-Path -LiteralPath $backup) {
    Remove-Item -LiteralPath $backup -Recurse -Force
  }
  [IO.Directory]::CreateDirectory($backup) | Out-Null
  foreach ($entry in @(Get-ChildItem -LiteralPath $source -Force)) {
    if ($entry.PSIsContainer) { Assert-NoReparsePointsInTree $entry 'Automatic update backup source' }
    elseif (Test-ReparsePoint $entry.FullName) { throw "Automatic update backup source is a reparse point: $($entry.FullName)" }
    Copy-Item -LiteralPath $entry.FullName -Destination $backup -Recurse -Force
  }
  Assert-RecoveryPayload $backup
  Set-InPlacePayloadBackupEnvironment $backup
}

function Restore-InPlacePayloadBackup {
  if (-not (Test-AutomaticUpdateRequested)) { return }
  $backup = Get-InPlacePayloadBackupPath
  if (-not (Test-Path -LiteralPath $backup -PathType Container)) {
    throw 'The automatic update backup is unavailable.'
  }
  $source = Get-RecoveryPayloadSource
  Assert-SafeInstallRoot $source 'Automatic update recovery destination'
  [IO.Directory]::CreateDirectory($source) | Out-Null
  foreach ($entry in @(Get-ChildItem -LiteralPath $backup -Force)) {
    if ($entry.PSIsContainer) { Assert-NoReparsePointsInTree $entry 'Automatic update backup' }
    elseif (Test-ReparsePoint $entry.FullName) { throw "Automatic update backup is a reparse point: $($entry.FullName)" }
    Copy-Item -LiteralPath $entry.FullName -Destination $source -Recurse -Force
  }
  Assert-RecoveryPayload $source
  Set-InPlacePayloadBackupEnvironment $backup
}

function Resolve-RecoveryPayloadExecutable {
  $transactionPath = Get-EnvironmentValue 'KUN_INSTALLER_TRANSACTION'
  if (-not [string]::IsNullOrWhiteSpace($transactionPath) -and
      (Test-Path -LiteralPath $transactionPath -PathType Leaf)) {
    $transaction = Read-UpdateTransaction
    if ($null -ne $transaction) {
      $source = Normalize-FullPath ([string]$transaction.Source)
      Assert-RecoveryPayload $source
      return Find-RecoveryPayloadExecutable $source
    }
  }
  $backup = Get-InPlacePayloadBackupPath
  $source = Get-RecoveryPayloadSource
  if (Test-Path -LiteralPath $source -PathType Container) {
    try {
      Assert-RecoveryPayload $source
      return Find-RecoveryPayloadExecutable $source
    } catch {
      Write-InstallerDiagnostic "Recovery source is not runnable yet: $($_.Exception.Message)"
    }
  }
  Assert-RecoveryPayload $backup
  return Find-RecoveryPayloadExecutable $backup
}

function Test-AutomaticUpdateRequested {
  return [string]::Equals(
    (Get-EnvironmentValue 'KUN_INSTALLER_AUTOMATIC_UPDATE').Trim(),
    '1',
    [StringComparison]::Ordinal
  )
}

function Test-InPlaceUpdateRequested {
  return [string]::Equals(
    (Get-EnvironmentValue 'KUN_INSTALLER_IN_PLACE_UPDATE').Trim(),
    '1',
    [StringComparison]::Ordinal
  )
}

function Get-CurrentProductUninstallerFile {
  $configured = (Get-EnvironmentValue 'KUN_INSTALLER_PRODUCT_NAME').Trim()
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    return 'Uninstall ' + $configured + '.exe'
  }
  return 'Uninstall ' + (Get-CanonicalLeaf) + '.exe'
}

function Test-RetainedInPlaceKnownEntry([IO.FileSystemInfo]$Entry) {
  if ($Entry.PSIsContainer) {
    # Keep packaged directories that the new payload still uses.
    return @('resources', 'locales', 'bin') -contains $Entry.Name.ToLowerInvariant()
  }

  $expectedExecutable = Get-ExpectedApplicationExecutable
  if ([string]::Equals($Entry.Name, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  $currentUninstaller = Get-CurrentProductUninstallerFile
  if ([string]::Equals($Entry.Name, $currentUninstaller, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  # Electron runtime files from the newly extracted package stay in place.
  $runtimeFiles = @(
    'uninstallericon.ico',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll',
    'ffmpeg.dll',
    'icudtl.dat',
    'libegl.dll',
    'libglesv2.dll',
    'license.electron.txt',
    'licenses.chromium.html',
    'resources.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll'
  )
  return $runtimeFiles -contains $Entry.Name.ToLowerInvariant()
}

function Invoke-CleanupInPlaceLeftovers {
  if (-not (Test-InPlaceUpdateRequested)) {
    return
  }

  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'KUN_INSTALLER_TARGET is required for in-place leftover cleanup.'
  }
  if (-not [string]::IsNullOrWhiteSpace($source) -and -not (Test-PathEqual $source $target)) {
    throw "In-place leftover cleanup requires the source and target to match: $source -> $target"
  }

  Assert-PackagedInstallPayload

  $legacyEntries = @(Get-ChildItem -LiteralPath $target -Force | Where-Object {
    (Test-KnownApplicationEntry $_) -and
      -not (Test-RetainedInPlaceKnownEntry $_) -and
      -not (Test-InstallerSelfEntry $_ $target)
  })
  foreach ($entry in $legacyEntries) {
    if ($entry.PSIsContainer) {
      Assert-NoReparsePointsInTree $entry 'Obsolete in-place application directory'
    } elseif (Test-ReparsePoint $entry.FullName) {
      throw "Obsolete in-place application file is a reparse point: $($entry.FullName)"
    }
  }
  foreach ($entry in $legacyEntries) {
    Remove-KnownApplicationEntry $entry
  }
}

function Test-AppSpecificUninstaller([string]$Source) {
  if ([string]::IsNullOrWhiteSpace($Source)) {
    return $false
  }
  return [bool](Get-AppSpecificUninstallerFiles | Where-Object {
    Test-Path -LiteralPath (Join-Path $Source $_) -PathType Leaf
  })
}

function Test-RecoverableApplicationSource([string]$Source) {
  if (Test-ApplicationSourceIdentity $Source) {
    return $true
  }
  return (Test-AppSpecificUninstaller $Source) -and (Test-PackagedApplicationPayload $Source)
}

function Assert-RecoverableApplicationSource([string]$Source) {
  if (-not (Test-RecoverableApplicationSource $Source)) {
    throw (
      "The registered source contains files but is not a verifiable Kun installation: $Source. " +
      'No files or registration were changed.'
    )
  }
}

function Assert-TrustedSecondarySource([string]$Source) {
  $profile = Normalize-FullPath $env:USERPROFILE
  if (-not [string]::IsNullOrWhiteSpace($profile) -and (Test-PathWithin $Source $profile) -and
      -not (Test-PathEqual $Source $profile)) {
    return
  }

  Assert-SafeInstallRoot $Source 'External current-user installation source'
  if (@(Get-ChildItem -LiteralPath $Source -Force).Count -eq 0) {
    return
  }
  Assert-RecoverableApplicationSource $Source
  Assert-PackagedApplicationPayload $Source
}
