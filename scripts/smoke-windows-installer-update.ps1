# Dot-sourced only by the clean-CI installer smoke. This exercises the compiled
# --updated path, not a real cross-version upgrade or a normal desktop launch.
# Runtime health data is temporary; Electron may write disposable CI-profile caches.
function Invoke-SmokeAutomaticUpdate([string]$Scenario) {
  Assert-True ($script:installLocation.StartsWith($script:root + '\', [StringComparison]::OrdinalIgnoreCase)) `
    'The automatic update smoke must own its temporary installation.'
  Find-KunRegistration
  $version = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
  $sentinel = Join-Path $script:installLocation 'smoke-preserved-user-file.txt'
  $sentinelValue = 'owned smoke user file ' + [Guid]::NewGuid().ToString('N')
  Set-Content -LiteralPath $sentinel -Value $sentinelValue -Encoding UTF8
  $beforeLog = if (Test-Path -LiteralPath $script:diagnosticPath) {
    (Get-Content -LiteralPath $script:diagnosticPath -Raw).Length
  } else { 0 }
  $recoveryRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'KunInstallerRecovery'
  $guid = (Get-Item -LiteralPath $script:installRegistryPath).PSChildName
  $transactionPath = Join-Path $recoveryRoot ($guid + '-update.json')
  Assert-True (-not (Test-Path -LiteralPath $transactionPath)) 'The compiled update smoke must not adopt an existing transaction.'
  $previousBackups = @(Get-ChildItem -LiteralPath $recoveryRoot -Directory -Filter 'update-backup-*' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName })
  $environment = @{
    KUN_INSTALLER_UPDATE_SOURCE = $script:installLocation
    KUN_INSTALLER_OLD_VERSION = $version
    KUN_INSTALLER_NEW_VERSION = $version
    KUN_PENDING_UPDATE_RESULT = $null
    KUN_PENDING_UPDATE_PATH = $null
  }
  $previous = @{}
  try {
    foreach ($name in $environment.Keys) {
      $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    # No --force-run: only the installer's bounded health probe launches.
    # Without a GUI pending-result owner, the existing installer completion
    # path finalizes after its health probe; do not bypass that lifecycle here.
    Invoke-CheckedProcess $Scenario $script:InstallerPath @('/S', '/currentuser', '--updated')
  } finally {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
  }
  # Health publishes its result just before app.exit. Wait for fixture-owned
  # processes to finish naturally before the next scenario renames the payload.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        ([string]$_.ExecutablePath).StartsWith($script:installLocation + '\', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($owned.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  Assert-True ($owned.Count -eq 0) "[$Scenario] Fixture health processes did not exit naturally."
  $log = (Get-Content -LiteralPath $script:diagnosticPath -Raw).Substring($beforeLog)
  $cursor = 0
  foreach ($marker in @(
    'NSIS update-boundary=prepared',
    'SUCCESS action=StageExtractedUpdatePayload',
    'START action=ResolveRecoveryExecutable',
    'NSIS update-boundary=registration-original',
    'NSIS update-boundary=cutover',
    'SUCCESS action=SwitchUpdatePayload',
    'SUCCESS action=ValidateCutover',
    'SUCCESS action=CommitUpdateTransaction',
    'SUCCESS action=FinalizeUpdateTransaction'
  )) {
    $found = $log.IndexOf($marker, $cursor, [StringComparison]::Ordinal)
    Assert-True ($found -ge 0) "[$Scenario] Missing or out-of-order native marker: $marker"
    $cursor = $found + $marker.Length
  }
  Find-KunRegistration
  Assert-True ((Get-Content -LiteralPath $sentinel -Raw).Trim() -eq $sentinelValue) "[$Scenario] User file was not preserved."
  Assert-True (-not (Test-Path -LiteralPath $transactionPath)) "[$Scenario] Transaction was not finalized."
  $newBackups = @(Get-ChildItem -LiteralPath $recoveryRoot -Directory -Filter 'update-backup-*' -ErrorAction SilentlyContinue |
    Where-Object { $previousBackups -notcontains $_.FullName })
  Assert-True ($newBackups.Count -eq 0) "[$Scenario] Recovery backups remain after finalization."
  foreach ($suffix in @('.kun-stage-*', '.kun-old-*', '.kun-failed')) {
    $leftovers = @(Get-ChildItem -Path ($script:installLocation + $suffix) -ErrorAction SilentlyContinue)
    Assert-True ($leftovers.Count -eq 0) "[$Scenario] Recovery sibling remains: $suffix"
  }
  Assert-True (Test-Path -LiteralPath (Join-Path $script:installLocation 'Uninstall Kun.exe') -PathType Leaf) `
    "[$Scenario] The staged uninstaller did not reach the final payload."
}

function Move-SmokeInstallationToActiveStageName {
  $original = $script:installLocation
  $active = $original + '.kun-stage-424242'
  Assert-True ($original.StartsWith($script:root + '\', [StringComparison]::OrdinalIgnoreCase)) 'The fixture must remain under its temporary root.'
  Assert-True (-not (Test-Path -LiteralPath $active)) 'The active-stage fixture path is already occupied.'
  Find-KunRegistration
  $location = Get-ItemPropertyValue -LiteralPath $script:installRegistryPath -Name InstallLocation
  Assert-True (Test-PathEqual $location $original) 'The fixture no longer owns its install registration.'
  $uninstallValues = @{}
  foreach ($name in @('UninstallString', 'QuietUninstallString', 'DisplayIcon')) {
    $value = [string](Get-ItemPropertyValue -LiteralPath $script:uninstallRegistryPath -Name $name)
    Assert-True ($value.IndexOf($original, [StringComparison]::OrdinalIgnoreCase) -ge 0) "The fixture does not own uninstall value $name."
    $uninstallValues[$name] = $value
  }
  $originalBin = Join-Path $original 'bin'
  $activeBin = Join-Path $active 'bin'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathParts = @($userPath -split ';')
  $ownedPathParts = @($pathParts | Where-Object {
    [string]::Equals($_.Trim().TrimEnd('\'), $originalBin, [StringComparison]::OrdinalIgnoreCase)
  })
  Assert-True ($ownedPathParts.Count -gt 0) 'The fixture does not own its original user PATH entry.'
  Move-Item -LiteralPath $original -Destination $active
  $script:installLocation = $active
  Assert-True (Test-PathEqual (Get-ItemPropertyValue -LiteralPath $script:installRegistryPath -Name InstallLocation) $original) `
    'Install registration changed while preparing the fixture.'
  Set-ItemProperty -LiteralPath $script:installRegistryPath -Name InstallLocation -Value $active
  foreach ($name in $uninstallValues.Keys) {
    Assert-True ((Get-ItemPropertyValue -LiteralPath $script:uninstallRegistryPath -Name $name) -eq $uninstallValues[$name]) `
      "Uninstall registration changed while preparing the fixture: $name"
    $value = [string]$uninstallValues[$name]
    $offset = $value.IndexOf($original, [StringComparison]::OrdinalIgnoreCase)
    $updated = $value.Substring(0, $offset) + $active + $value.Substring($offset + $original.Length)
    Set-ItemProperty -LiteralPath $script:uninstallRegistryPath -Name $name -Value $updated
  }
  Assert-True ([string]::Equals([Environment]::GetEnvironmentVariable('Path', 'User'), $userPath, [StringComparison]::Ordinal)) `
    'User PATH changed while preparing the fixture.'
  $updatedPathParts = @($pathParts | ForEach-Object {
    if ([string]::Equals($_.Trim().TrimEnd('\'), $originalBin, [StringComparison]::OrdinalIgnoreCase)) {
      $activeBin
    } else {
      $_
    }
  })
  [Environment]::SetEnvironmentVariable('Path', ($updatedPathParts -join ';'), 'User')
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @('DesktopDirectory', 'Programs')) {
    $shortcutRoot = [Environment]::GetFolderPath($folder)
    foreach ($file in @(Get-ChildItem -LiteralPath $shortcutRoot -Filter 'Kun.lnk' -Recurse -File -ErrorAction SilentlyContinue)) {
      $shortcut = $shell.CreateShortcut($file.FullName)
      if ([string]::IsNullOrWhiteSpace([string]$shortcut.TargetPath)) { continue }
      if (-not (Test-PathEqual $shortcut.TargetPath (Join-Path $original 'Kun.exe'))) { continue }
      $shortcut.TargetPath = Join-Path $active 'Kun.exe'
      $shortcut.WorkingDirectory = $active
      $shortcut.IconLocation = (Join-Path $active 'Kun.exe') + ',0'
      $shortcut.Save()
    }
  }
  Find-KunRegistration
}
