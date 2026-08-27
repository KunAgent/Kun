param(
  [string]$InstallerPath = '',
  [switch]$AllowLocal
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This smoke test requires 64-bit Windows.'
}
if (-not $AllowLocal -and $env:CI -ne 'true') {
  throw 'This smoke mutates the current-user Kun uninstall registration and is restricted to clean CI runners. Use -AllowLocal only in a disposable Windows account.'
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('kun-installer-migration-smoke-' + [guid]::NewGuid().ToString('N'))
$diagnosticPath = Join-Path $root 'installer-helper-diagnostics.log'
$previousDiagnosticPath = [Environment]::GetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', 'Process')
$previousUpdateSource = [Environment]::GetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', 'Process')
$previousAttackMarker = [Environment]::GetEnvironmentVariable('KUN_INSTALLER_ATTACK_MARKER', 'Process')
$markerName = '.kun-installer-migration-smoke-' + [guid]::NewGuid().ToString('N')
$installRegistryPath = $null
$uninstallRegistryPath = $null
$installRegistryPaths = @()
$uninstallRegistryPaths = @()
$sentinels = @()
$currentScenario = 'smoke setup'
$substDrive = ''

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw "[$script:currentScenario] $Message"
  }
}

function Normalize-Path([string]$PathValue) {
  return [IO.Path]::GetFullPath($PathValue).TrimEnd('\')
}

function Test-PathEqual([string]$Left, [string]$Right) {
  return [string]::Equals((Normalize-Path $Left), (Normalize-Path $Right), [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Installer(
  [string]$Scenario,
  [string[]]$Arguments,
  [int]$ExpectedExitCode = 0
) {
  $script:currentScenario = $Scenario
  $argumentText = $Arguments -join ' '
  $accessViolationExitCode = -1073741819
  $maximumAttempts = 2
  $process = $null
  for ($attempt = 1; $attempt -le $maximumAttempts; $attempt += 1) {
    Write-Host "[$Scenario] Starting installer (attempt $attempt/$maximumAttempts): $argumentText"
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $script:InstallerPath -ArgumentList $Arguments -Wait -PassThru
    $stopwatch.Stop()
    Write-Host "[$Scenario] Installer exited with $($process.ExitCode) after $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s."
    if ($process.ExitCode -ne $accessViolationExitCode -or $attempt -eq $maximumAttempts) {
      break
    }
    Write-Warning "[$Scenario] Installer hit Windows access violation 0xC0000005; retrying once after 2 seconds."
    Start-Sleep -Seconds 2
  }
  if ($process.ExitCode -ne $ExpectedExitCode -and (Test-Path -LiteralPath $script:diagnosticPath -PathType Leaf)) {
    Write-Host "[$Scenario] Installer helper diagnostics:"
    Write-Host (Get-Content -LiteralPath $script:diagnosticPath -Raw)
  }
  Assert-True ($process.ExitCode -eq $ExpectedExitCode) "Installer exited with $($process.ExitCode), expected $ExpectedExitCode. Arguments: $argumentText"
}

function Invoke-Uninstaller(
  [string]$Scenario,
  [string]$InstallLocation,
  [ValidateSet('/currentuser', '/allusers')][string]$Mode
) {
  $script:currentScenario = $Scenario
  $source = Join-Path $InstallLocation 'Uninstall Kun.exe'
  $copy = Join-Path $script:root ('kun-smoke-uninstaller-' + [guid]::NewGuid().ToString('N') + '.exe')
  Copy-Item -LiteralPath $source -Destination $copy
  try {
    # NSIS uninstallers normally launch a temporary child and let the original
    # process exit early. Running our own copy with _?= as the final, unquoted
    # argument makes -Wait observe the real uninstall lifecycle.
    $arguments = @('/S', $Mode, ('_?={0}' -f $InstallLocation))
    Write-Host "[$Scenario] Starting copied uninstaller: $($arguments -join ' ')"
    $process = Start-Process -FilePath $copy -ArgumentList $arguments -Wait -PassThru
    Assert-True ($process.ExitCode -eq 0) "Uninstaller exited with $($process.ExitCode)."
  } finally {
    Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
  }
}

function Find-KunRegistration(
  [string]$ExpectedLocation,
  [ValidateSet('HKCU', 'HKLM')][string]$Hive = 'HKCU'
) {
  $softwarePath = if ($Hive -eq 'HKLM') { 'HKLM:\Software' } else { 'HKCU:\Software' }
  $uninstallRoot = if ($Hive -eq 'HKLM') {
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  } else {
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  }
  $matches = @(Get-ChildItem -Path $softwarePath | ForEach-Object {
    try {
      $value = Get-ItemPropertyValue -LiteralPath $_.PSPath -Name InstallLocation -ErrorAction Stop
      if (Test-PathEqual $value $ExpectedLocation) { $_ }
    } catch {}
  })
  Assert-True ($matches.Count -eq 1) "Expected one Kun install registration for $ExpectedLocation, found $($matches.Count)."
  $script:installRegistryPath = $matches[0].PSPath
  $script:uninstallRegistryPath = Join-Path $uninstallRoot $matches[0].PSChildName
  $script:installRegistryPaths += $script:installRegistryPath
  $script:uninstallRegistryPaths += $script:uninstallRegistryPath
  Assert-True (Test-Path -LiteralPath $script:uninstallRegistryPath) 'The matching Kun uninstall registration is missing.'
}

function Set-RegisteredLocation([string]$Location) {
  $uninstaller = Join-Path $Location 'Uninstall Kun.exe'
  Set-ItemProperty -LiteralPath $script:installRegistryPath -Name InstallLocation -Value $Location
  Set-ItemProperty -LiteralPath $script:uninstallRegistryPath -Name UninstallString -Value ('"' + $uninstaller + '" /currentuser')
  Set-ItemProperty -LiteralPath $script:uninstallRegistryPath -Name QuietUninstallString -Value ('"' + $uninstaller + '" /currentuser /S')
  Set-ItemProperty -LiteralPath $script:uninstallRegistryPath -Name DisplayIcon -Value ((Join-Path $Location 'Kun.exe') + ',0')
}

function Move-RegisteredInstall(
  [string]$From,
  [string]$To,
  [string]$RegisteredLocation = ''
) {
  [IO.Directory]::CreateDirectory((Split-Path -Parent $To)) | Out-Null
  Move-Item -LiteralPath $From -Destination $To
  $registeredTarget = if ([string]::IsNullOrWhiteSpace($RegisteredLocation)) {
    $To
  } else {
    $RegisteredLocation
  }
  Set-RegisteredLocation $registeredTarget

  $fromBin = Join-Path $From 'bin'
  $toBin = Join-Path $registeredTarget 'bin'
  $pathValue = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($pathValue -split ';' | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and
    -not [string]::Equals($_.TrimEnd('\'), $fromBin.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  })
  [Environment]::SetEnvironmentVariable('Path', (($parts + $toBin) -join ';'), 'User')
}

function New-TemporarySubstDrive([string]$BackingDirectory) {
  [IO.Directory]::CreateDirectory($BackingDirectory) | Out-Null
  foreach ($code in (90..80)) {
    $drive = ([char]$code).ToString() + ':'
    if (Test-Path -LiteralPath ($drive + '\')) {
      continue
    }
    & "$env:SystemRoot\System32\subst.exe" $drive $BackingDirectory | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath ($drive + '\'))) {
      return $drive
    }
  }
  throw 'No free drive letter was available for the external-install smoke scenario.'
}

function New-SmokeMarkerExecutable([string]$PathValue) {
  $source = @'
using System;
using System.IO;

public static class KunInstallerSmokeAttacker
{
    public static void Main()
    {
        var marker = Environment.GetEnvironmentVariable("KUN_INSTALLER_ATTACK_MARKER");
        if (!String.IsNullOrWhiteSpace(marker))
        {
            File.WriteAllText(marker, "executed");
        }
    }
}
'@
  Add-Type -TypeDefinition $source -OutputAssembly $PathValue -OutputType ConsoleApplication
}

function Assert-RegisteredLocation([string]$ExpectedLocation) {
  $actual = Get-ItemPropertyValue -LiteralPath $script:installRegistryPath -Name InstallLocation
  Assert-True (Test-PathEqual $actual $ExpectedLocation) "Registered location is $actual, expected $ExpectedLocation."
  Assert-True (Test-Path -LiteralPath (Join-Path $ExpectedLocation 'Kun.exe')) "Kun.exe is missing from $ExpectedLocation."
}

function Assert-PathReconciled([string]$ExpectedLocation, [string[]]$RejectedLocations) {
  $parts = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_)
  })
  $expectedBin = Join-Path $ExpectedLocation 'bin'
  $expectedCount = @($parts | Where-Object {
    [string]::Equals($_.TrimEnd('\'), $expectedBin.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  }).Count
  Assert-True ($expectedCount -eq 1) "Expected exactly one PATH entry for $expectedBin, found $expectedCount."
  foreach ($location in $RejectedLocations) {
    $rejectedBin = Join-Path $location 'bin'
    Assert-True (-not ($parts | Where-Object {
      [string]::Equals($_.TrimEnd('\'), $rejectedBin.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
    })) "Stale PATH entry remains for $rejectedBin."
  }
}

function Assert-PathEntryRemoved([string]$InstallLocation) {
  $parts = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_)
  })
  $binPath = Join-Path $InstallLocation 'bin'
  $remaining = @($parts | Where-Object {
    [string]::Equals($_.TrimEnd('\'), $binPath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  })
  Assert-True ($remaining.Count -eq 0) "PATH entry remains after uninstall: $binPath"
}

function Get-ShortcutPaths([ValidateSet('CurrentUser', 'AllUsers')][string]$Scope) {
  if ($Scope -eq 'AllUsers') {
    return @(
      (Join-Path $env:PUBLIC 'Desktop\Kun.lnk'),
      (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Kun.lnk')
    )
  }
  return @(
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Kun.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Kun.lnk')
  )
}

function Assert-KunShortcuts([ValidateSet('CurrentUser', 'AllUsers')][string]$Scope) {
  foreach ($shortcut in @(Get-ShortcutPaths $Scope)) {
    Assert-True (Test-Path -LiteralPath $shortcut) "Kun shortcut is missing: $shortcut"
    $legacyShortcut = Join-Path (Split-Path -Parent $shortcut) 'DeepSeek GUI.lnk'
    Assert-True (-not (Test-Path -LiteralPath $legacyShortcut)) "Legacy shortcut remains: $legacyShortcut"
  }
}

function Assert-NoKunShortcuts([ValidateSet('CurrentUser', 'AllUsers')][string]$Scope) {
  foreach ($shortcut in @(Get-ShortcutPaths $Scope)) {
    Assert-True (-not (Test-Path -LiteralPath $shortcut)) "Kun shortcut remains: $shortcut"
    $legacyShortcut = Join-Path (Split-Path -Parent $shortcut) 'DeepSeek GUI.lnk'
    Assert-True (-not (Test-Path -LiteralPath $legacyShortcut)) "Legacy shortcut remains: $legacyShortcut"
  }
}

function Convert-ShortcutsToLegacy {
  foreach ($shortcut in @(Get-ShortcutPaths 'CurrentUser')) {
    if (Test-Path -LiteralPath $shortcut) {
      Move-Item -LiteralPath $shortcut -Destination (Join-Path (Split-Path -Parent $shortcut) 'DeepSeek GUI.lnk')
    }
  }
  Set-ItemProperty -LiteralPath $script:installRegistryPath -Name ShortcutName -Value 'DeepSeek GUI'
  Set-ItemProperty -LiteralPath $script:installRegistryPath -Name KeepShortcuts -Value 'true'
}

function Add-DataSentinel([string]$Directory) {
  [IO.Directory]::CreateDirectory($Directory) | Out-Null
  $path = Join-Path $Directory $script:markerName
  Set-Content -LiteralPath $path -Value 'preserve' -Encoding UTF8
  $script:sentinels += $path
}

try {
  [IO.Directory]::CreateDirectory($root) | Out-Null
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', $diagnosticPath, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $null, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_ATTACK_MARKER', $null, 'Process')
  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $candidate = Get-ChildItem -Path (Join-Path (Get-Location) 'dist') -Filter 'Kun-*-win-x64.exe' |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if ($null -eq $candidate) {
      throw 'No dist/Kun-*-win-x64.exe installer was found.'
    }
    $script:InstallerPath = $candidate.FullName
  } else {
    $script:InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
  }

  $existingKun = @(@(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  ) | ForEach-Object { Get-ChildItem $_ -ErrorAction SilentlyContinue } | ForEach-Object {
    try {
      $displayName = Get-ItemPropertyValue -LiteralPath $_.PSPath -Name DisplayName -ErrorAction Stop
      if ($displayName -eq 'Kun' -or $displayName -eq 'DeepSeek GUI') { $_ }
    } catch {}
  })
  Assert-True ($existingKun.Count -eq 0) 'The smoke requires a clean current-user Kun/DeepSeek GUI registration.'

  Add-DataSentinel (Join-Path $env:APPDATA 'Kun')
  Add-DataSentinel (Join-Path $env:APPDATA 'DeepSeek GUI')
  Add-DataSentinel (Join-Path $HOME '.kun')
  Add-DataSentinel (Join-Path $HOME '.deepseekgui')

  $unicodeDirectoryName = -join @(
    [char]0x4E2D # U+4E2D
    [char]0x6587 # U+6587
    [char]0x20
    [char]0x5B89 # U+5B89
    [char]0x88C5 # U+88C5
    [char]0x76EE # U+76EE
    [char]0x5F55 # U+5F55
  )
  $unicodeParent = Join-Path $root $unicodeDirectoryName
  $unicodeTarget = Join-Path $unicodeParent 'Kun'
  Invoke-Installer 'Unicode current-user install' @('/S', '/currentuser', ('"/D={0}"' -f $unicodeParent))
  Find-KunRegistration $unicodeTarget
  Assert-RegisteredLocation $unicodeTarget
  Assert-PathReconciled $unicodeTarget @()
  $script:currentScenario = 'Unicode packaged CLI smoke'
  & node (Join-Path $PSScriptRoot 'smoke-packaged-cli.cjs') '--resources' (Join-Path $unicodeTarget 'resources')
  Assert-True ($LASTEXITCODE -eq 0) 'The packaged CLI did not run from the Unicode install directory.'
  Invoke-Uninstaller 'Unicode current-user uninstall' $unicodeTarget '/currentuser'
  Assert-PathEntryRemoved $unicodeTarget
  Assert-NoKunShortcuts 'CurrentUser'

  $seedParent = Join-Path $root 'seed'
  $seed = Join-Path $seedParent 'Kun'
  Invoke-Installer 'seed current-user install' @('/S', '/currentuser', "/D=$seedParent")
  Find-KunRegistration $seed
  Assert-RegisteredLocation $seed
  Assert-KunShortcuts 'CurrentUser'

  $legacySource = Join-Path $root 'legacy\DeepSeek GUI'
  $legacyTarget = Join-Path $root 'legacy\Kun'
  Move-RegisteredInstall $seed $legacySource
  Convert-ShortcutsToLegacy
  Set-ItemProperty -LiteralPath $script:installRegistryPath -Name InstallLocation -Value ''
  Set-Content -LiteralPath (Join-Path $legacySource 'legacy-note.txt') -Value 'keep legacy note'
  Invoke-Installer 'legacy uninstall-source recovery' @('--updated', '/currentuser')
  Assert-RegisteredLocation $legacyTarget
  Assert-True ((Get-Content -LiteralPath (Join-Path $legacySource 'legacy-note.txt') -Raw).Trim() -eq 'keep legacy note') 'Legacy unknown content was not preserved.'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $legacyTarget 'legacy-note.txt'))) 'Legacy unknown content leaked into the canonical target.'
  Assert-PathReconciled $legacyTarget @($seed, $legacySource)
  Assert-KunShortcuts 'CurrentUser'

  $falseNestedParent = Join-Path $root 'false-nested\DeepSeek GUI'
  $falseNestedSource = Join-Path $falseNestedParent 'Kun'
  $falseNestedTarget = Join-Path $root 'false-nested\Kun'
  Move-RegisteredInstall $legacyTarget $falseNestedParent $falseNestedSource
  [IO.Directory]::CreateDirectory($falseNestedSource) | Out-Null
  Invoke-Installer 'false nested legacy registration recovery' @('/S', '/currentuser')
  Assert-RegisteredLocation $falseNestedTarget
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $falseNestedParent 'Kun.exe'))) 'The recovered legacy parent still contains its application executable.'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $falseNestedParent 'DeepSeek GUI.exe'))) 'The recovered legacy parent still contains its legacy executable.'
  Assert-PathReconciled $falseNestedTarget @($legacyTarget, $falseNestedSource, $falseNestedParent)

  $nestedSource = Join-Path $root 'nested\DeepSeek GUI\Kun'
  $nestedTarget = Join-Path $root 'nested\Kun'
  Move-RegisteredInstall $falseNestedTarget $nestedSource
  Set-Content -LiteralPath (Join-Path $nestedSource 'nested-note.txt') -Value 'keep nested note'
  Invoke-Installer 'nested legacy path migration' @('/S', '/currentuser')
  Assert-RegisteredLocation $nestedTarget
  Assert-True (Test-Path -LiteralPath (Join-Path $nestedSource 'nested-note.txt')) 'Nested unknown content was not restored.'
  Assert-PathReconciled $nestedTarget @($falseNestedTarget, $nestedSource)

  $staleSource = Join-Path $root 'stale-empty\DeepSeek GUI\Kun'
  $staleTarget = Join-Path $root 'stale-empty\Kun'
  $orphanedInstall = Join-Path $root 'orphaned-valid-install'
  Move-RegisteredInstall $nestedTarget $orphanedInstall $staleSource
  [IO.Directory]::CreateDirectory($staleSource) | Out-Null
  Invoke-Installer 'empty stale registration recovery' @('/S', '/currentuser')
  Assert-RegisteredLocation $staleTarget
  Assert-True (Test-Path -LiteralPath $staleSource -PathType Container) 'Stale empty source directory was modified or removed.'
  Assert-True (@(Get-ChildItem -LiteralPath $staleSource -Force).Count -eq 0) 'Stale empty source directory received application files.'
  Assert-PathReconciled $staleTarget @($nestedTarget, $staleSource)

  $custom = Join-Path $root 'custom\My AI Tools'
  Move-RegisteredInstall $staleTarget $custom
  Set-Content -LiteralPath (Join-Path $custom 'custom-note.txt') -Value 'keep custom note'
  Invoke-Installer 'custom path reinstall' @('/S', '/currentuser')
  Assert-RegisteredLocation $custom
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'custom-note.txt')) 'Custom install content was not restored in place.'

  Move-Item -LiteralPath (Join-Path $custom 'Kun.exe') -Destination (Join-Path $custom 'Kun.exe.partial-missing')
  Invoke-Installer 'partially damaged packaged source recovery' @('/S', '/currentuser')
  Assert-RegisteredLocation $custom
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'Kun.exe.partial-missing')) 'Partial-source recovery deleted preserved content.'

  Move-Item -LiteralPath (Join-Path $custom 'Kun.exe') -Destination (Join-Path $custom 'Kun.exe.unverified')
  Move-Item -LiteralPath (Join-Path $custom 'Uninstall Kun.exe') -Destination (Join-Path $custom 'Uninstall Kun.exe.unverified')
  Move-Item -LiteralPath (Join-Path $custom 'resources\app.asar') -Destination (Join-Path $custom 'resources\app.asar.unverified')
  Invoke-Installer 'unverified non-empty source rejection' @('/S', '/currentuser') 2
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'Kun.exe.unverified')) 'Unverified-source rejection changed the program directory.'
  $unverifiedRegisteredLocation = Get-ItemPropertyValue -LiteralPath $script:installRegistryPath -Name InstallLocation
  Assert-True (Test-PathEqual $unverifiedRegisteredLocation $custom) 'Unverified-source rejection retired the existing registration.'
  Move-Item -LiteralPath (Join-Path $custom 'Kun.exe.unverified') -Destination (Join-Path $custom 'Kun.exe')
  Move-Item -LiteralPath (Join-Path $custom 'Uninstall Kun.exe.unverified') -Destination (Join-Path $custom 'Uninstall Kun.exe')
  Move-Item -LiteralPath (Join-Path $custom 'resources\app.asar.unverified') -Destination (Join-Path $custom 'resources\app.asar')

  $programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
  Set-RegisteredLocation $programsRoot
  Invoke-Installer 'protected root rejection' @('/S', '/currentuser') 2
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'Kun.exe')) 'Protected-root rejection changed the actual installation.'
  Set-RegisteredLocation $custom

  $junctionBacking = Join-Path $root 'junction-backing'
  $junctionTarget = Join-Path $root 'junction-target\Kun'
  [IO.Directory]::CreateDirectory($junctionBacking) | Out-Null
  [IO.Directory]::CreateDirectory((Split-Path -Parent $junctionTarget)) | Out-Null
  New-Item -ItemType Junction -Path $junctionTarget -Target $junctionBacking | Out-Null
  Invoke-Installer 'reparse target rejection' @('/S', '/currentuser', "/D=$junctionTarget") 2
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'Kun.exe')) 'Reparse-target rejection changed the source installation.'

  $linkedSource = Join-Path $root 'linked-source'
  New-Item -ItemType Junction -Path $linkedSource -Target $custom | Out-Null
  Set-RegisteredLocation $linkedSource
  Invoke-Installer 'reparse source rejection' @('/S', '/currentuser') 2
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'Kun.exe')) 'Reparse-source rejection changed the installation.'
  Set-RegisteredLocation $custom

  Move-Item -LiteralPath (Join-Path $custom 'Uninstall Kun.exe') -Destination (Join-Path $custom 'old-uninstaller.missing')
  Invoke-Installer 'missing uninstaller fallback cleanup' @('/S', '/currentuser')
  Assert-RegisteredLocation $custom
  Assert-True (Test-Path -LiteralPath (Join-Path $custom 'old-uninstaller.missing')) 'Fallback cleanup deleted preserved unknown content.'

  $conflictSource = Join-Path $root 'conflict\DeepSeek GUI'
  $conflictTarget = Join-Path $root 'conflict\Kun'
  Move-RegisteredInstall $custom $conflictSource
  [IO.Directory]::CreateDirectory($conflictTarget) | Out-Null
  Set-Content -LiteralPath (Join-Path $conflictTarget 'occupied.txt') -Value 'do not overwrite'
  Invoke-Installer 'occupied target rejection' @('/S', '/currentuser') 2
  Assert-True (Test-Path -LiteralPath (Join-Path $conflictSource 'Kun.exe')) 'Conflict handling changed the source installation.'
  Assert-True (Test-Path -LiteralPath (Join-Path $conflictTarget 'occupied.txt')) 'Conflict handling changed the target directory.'

  Remove-Item -LiteralPath $conflictTarget -Recurse -Force
  Invoke-Installer 'conflict retry migration' @('/S', '/currentuser')
  Assert-RegisteredLocation $conflictTarget

  $externalBacking = Join-Path $root 'external-drive'
  $script:substDrive = New-TemporarySubstDrive $externalBacking
  $externalBackingSource = Join-Path $externalBacking 'Kun'
  $externalSource = $script:substDrive + '\Kun'
  Move-RegisteredInstall $conflictTarget $externalBackingSource $externalSource
  Set-Content -LiteralPath (Join-Path $externalSource 'external-note.txt') -Value 'keep external note'
  Assert-RegisteredLocation $externalSource

  foreach ($sentinel in $sentinels) {
    Assert-True (Test-Path -LiteralPath $sentinel) "User-data sentinel was removed: $sentinel"
  }

  $previousUserInstallRegistryPath = $script:installRegistryPath
  $previousUserUninstallRegistryPath = $script:uninstallRegistryPath
  $machineParent = Join-Path $root 'machine'
  $machineTarget = Join-Path $machineParent 'Kun'
  Invoke-Installer 'current-user to all-users migration' @('/S', '/allusers', "/D=$machineParent")
  Assert-True (-not (Test-Path -LiteralPath $previousUserInstallRegistryPath)) 'The current-user install registration remains after all-users migration.'
  Assert-True (-not (Test-Path -LiteralPath $previousUserUninstallRegistryPath)) 'The current-user uninstall registration remains after all-users migration.'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $externalSource 'Kun.exe'))) 'The external current-user application payload remains after all-users migration.'
  Assert-True ((Get-Content -LiteralPath (Join-Path $externalSource 'external-note.txt') -Raw).Trim() -eq 'keep external note') 'External current-user content was not restored.'
  Assert-NoKunShortcuts 'CurrentUser'
  Find-KunRegistration $machineTarget 'HKLM'
  Assert-RegisteredLocation $machineTarget
  Assert-PathReconciled $machineTarget @($conflictTarget, $externalSource)
  Assert-KunShortcuts 'AllUsers'

  $machineInstallRegistryPath = $script:installRegistryPath
  $machineUninstallRegistryPath = $script:uninstallRegistryPath
  $otherUserParent = Join-Path $root 'other-current-user'
  $otherUserTarget = Join-Path $otherUserParent 'Kun'
  Invoke-Installer 'parallel current-user install' @('/S', '/currentuser', "/D=$otherUserParent")
  Find-KunRegistration $otherUserTarget 'HKCU'
  $otherUserInstallRegistryPath = $script:installRegistryPath
  $otherUserUninstallRegistryPath = $script:uninstallRegistryPath
  $otherUserUninstallString = Get-ItemPropertyValue -LiteralPath $otherUserUninstallRegistryPath -Name UninstallString
  $machineHashBeforeAmbiguousUpdate = (Get-FileHash -LiteralPath (Join-Path $machineTarget 'Kun.exe') -Algorithm SHA256).Hash
  $otherUserHashBeforeAmbiguousUpdate = (Get-FileHash -LiteralPath (Join-Path $otherUserTarget 'Kun.exe') -Algorithm SHA256).Hash
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', '', 'Process')
  Invoke-Installer 'ambiguous automatic update scope rejection' @('--updated', '/S') 2
  Assert-True (Test-PathEqual (Get-ItemPropertyValue -LiteralPath $machineInstallRegistryPath -Name InstallLocation) $machineTarget) 'Ambiguous scope rejection changed the all-users registration.'
  Assert-True (Test-PathEqual (Get-ItemPropertyValue -LiteralPath $otherUserInstallRegistryPath -Name InstallLocation) $otherUserTarget) 'Ambiguous scope rejection changed the current-user registration.'
  Assert-True ((Get-FileHash -LiteralPath (Join-Path $machineTarget 'Kun.exe') -Algorithm SHA256).Hash -eq $machineHashBeforeAmbiguousUpdate) 'Ambiguous scope rejection changed the all-users payload.'
  Assert-True ((Get-FileHash -LiteralPath (Join-Path $otherUserTarget 'Kun.exe') -Algorithm SHA256).Hash -eq $otherUserHashBeforeAmbiguousUpdate) 'Ambiguous scope rejection changed the current-user payload.'

  $attackerPath = Join-Path $root 'tampered-uninstaller.exe'
  $attackerMarker = Join-Path $root 'tampered-uninstaller-ran.txt'
  New-SmokeMarkerExecutable $attackerPath
  Set-ItemProperty -LiteralPath $machineUninstallRegistryPath -Name UninstallString -Value ('"' + $attackerPath + '"')
  Set-ItemProperty -LiteralPath $machineUninstallRegistryPath -Name QuietUninstallString -Value ('"' + $attackerPath + '" /S')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_ATTACK_MARKER', $attackerMarker, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $machineTarget, 'Process')
  Invoke-Installer 'in-app all-users automatic update scope' @('--updated', '/S', '--force-run')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $previousUpdateSource, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_ATTACK_MARKER', $previousAttackMarker, 'Process')

  Assert-True (-not (Test-Path -LiteralPath $attackerMarker)) 'The elevated update executed the tampered registry uninstaller.'
  $machineLocationAfterUpdate = Get-ItemPropertyValue -LiteralPath $machineInstallRegistryPath -Name InstallLocation
  Assert-True (Test-PathEqual $machineLocationAfterUpdate $machineTarget) 'The automatic update did not retain the all-users registration.'
  Assert-True (Test-Path -LiteralPath (Join-Path $machineTarget 'Kun.exe')) 'The automatic update left the all-users application executable missing.'
  Assert-True (Test-Path -LiteralPath (Join-Path $machineTarget 'resources\app.asar')) 'The automatic update left the all-users application payload incomplete.'
  $otherUserLocationAfterUpdate = Get-ItemPropertyValue -LiteralPath $otherUserInstallRegistryPath -Name InstallLocation
  Assert-True (Test-PathEqual $otherUserLocationAfterUpdate $otherUserTarget) 'The automatic update changed the unrelated current-user registration.'
  $otherUserUninstallAfterUpdate = Get-ItemPropertyValue -LiteralPath $otherUserUninstallRegistryPath -Name UninstallString
  Assert-True ($otherUserUninstallAfterUpdate -eq $otherUserUninstallString) 'The automatic update did not restore the unrelated current-user uninstall registration.'
  $machinePathBeforeAmbiguousUpdate = Get-ItemPropertyValue -LiteralPath $machineInstallRegistryPath -Name InstallLocation
  $otherUserPathBeforeAmbiguousUpdate = Get-ItemPropertyValue -LiteralPath $otherUserInstallRegistryPath -Name InstallLocation
  $userPathBeforeAmbiguousUpdate = [Environment]::GetEnvironmentVariable('Path', 'User')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $null, 'Process')
  Invoke-Installer 'dual-scope update without source marker' @('--updated', '/S', '--force-run') 2
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $machineTarget, 'Process')
  Assert-True ((Get-ItemPropertyValue -LiteralPath $machineInstallRegistryPath -Name InstallLocation) -eq $machinePathBeforeAmbiguousUpdate) 'The ambiguous update changed the all-users registration.'
  Assert-True ((Get-ItemPropertyValue -LiteralPath $otherUserInstallRegistryPath -Name InstallLocation) -eq $otherUserPathBeforeAmbiguousUpdate) 'The ambiguous update changed the current-user registration.'
  Assert-True (Test-Path -LiteralPath (Join-Path $machineTarget 'Kun.exe')) 'The ambiguous update removed the all-users application executable.'
  Assert-True (Test-Path -LiteralPath (Join-Path $machineTarget 'resources\\app.asar')) 'The ambiguous update removed the all-users application payload.'
  Assert-True (Test-Path -LiteralPath (Join-Path $otherUserTarget 'Kun.exe')) 'The ambiguous update removed the current-user application executable.'
  Assert-True (Test-Path -LiteralPath (Join-Path $otherUserTarget 'resources\\app.asar')) 'The ambiguous update removed the current-user application payload.'
  Assert-True ((Get-ItemPropertyValue -LiteralPath $otherUserUninstallRegistryPath -Name UninstallString) -eq $otherUserUninstallString) 'The ambiguous update changed the current-user uninstall registration.'
  Assert-True ([Environment]::GetEnvironmentVariable('Path', 'User') -eq $userPathBeforeAmbiguousUpdate) 'The ambiguous update changed the user PATH.'
  $automaticUpdateDiagnostics = Get-Content -LiteralPath $diagnosticPath -Raw
  Assert-True ($automaticUpdateDiagnostics -match [regex]::Escape("source=$machineTarget")) 'The automatic update did not validate the running all-users source.'
  Assert-True ($automaticUpdateDiagnostics -match 'SUCCESS action=CleanupInPlaceLeftovers') 'The automatic update did not run post-validate in-place leftover cleanup.'

  Invoke-Uninstaller 'all-users uninstall' $machineTarget '/allusers'
  Assert-PathEntryRemoved $machineTarget
  foreach ($sentinel in $sentinels) {
    Assert-True (Test-Path -LiteralPath $sentinel) "All-users uninstall removed a user-data sentinel: $sentinel"
  }

  Write-Host 'Windows installer migration smoke passed.'
} finally {
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', $previousDiagnosticPath, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_UPDATE_SOURCE', $previousUpdateSource, 'Process')
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_ATTACK_MARKER', $previousAttackMarker, 'Process')
  foreach ($sentinel in $sentinels) {
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
  }
  foreach ($registryPath in $installRegistryPaths) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($registryPath in $uninstallRegistryPaths) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not [string]::IsNullOrWhiteSpace($substDrive)) {
    & "$env:SystemRoot\System32\subst.exe" $substDrive /D | Out-Null
  }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
