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
  throw 'This smoke mutates the current-user Kun installation and is restricted to clean CI runners. Use -AllowLocal only in a disposable Windows account.'
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('kun-installer-smoke-' + [guid]::NewGuid().ToString('N'))
$installParent = Join-Path $root 'installed app'
$installLocation = Join-Path $installParent 'Kun'
$diagnosticPath = Join-Path $root 'installer-diagnostics.log'
$previousDiagnosticPath = [Environment]::GetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', 'Process')
$installRegistryPath = $null
$uninstallRegistryPath = $null

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Test-PathEqual([string]$Left, [string]$Right) {
  $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd('\')
  $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd('\')
  return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-CheckedProcess(
  [string]$Scenario,
  [string]$Executable,
  [string[]]$Arguments,
  [int]$TimeoutSeconds = 10800
) {
  Write-Host "[$Scenario] $Executable $($Arguments -join ' ')"
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    throw "[$Scenario] Process $($process.Id) timed out after $TimeoutSeconds seconds."
  }
  Assert-True ($process.ExitCode -eq 0) "[$Scenario] Process exited with $($process.ExitCode)."
}

function Find-KunRegistration {
  $matches = @(Get-ChildItem 'HKCU:\Software' | ForEach-Object {
    try {
      $location = Get-ItemPropertyValue -LiteralPath $_.PSPath -Name InstallLocation -ErrorAction Stop
      if (Test-PathEqual $location $script:installLocation) { $_ }
    } catch {}
  })
  Assert-True ($matches.Count -eq 1) "Expected one Kun registration for $script:installLocation, found $($matches.Count)."
  $script:installRegistryPath = $matches[0].PSPath
  $script:uninstallRegistryPath = Join-Path `
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' $matches[0].PSChildName
  Assert-True (Test-Path -LiteralPath $script:uninstallRegistryPath) 'The Kun uninstall registration is missing.'
}

function Invoke-SmokeUninstaller {
  $installedUninstaller = Join-Path $script:installLocation 'Uninstall Kun.exe'
  if (-not (Test-Path -LiteralPath $installedUninstaller -PathType Leaf)) { return }
  $uninstallerCopy = Join-Path $script:root 'Uninstall Kun smoke.exe'
  Copy-Item -LiteralPath $installedUninstaller -Destination $uninstallerCopy -Force
  try {
    # _?= makes this process represent the full NSIS uninstall lifecycle.
    Invoke-CheckedProcess 'uninstall' $uninstallerCopy @(
      '/S',
      '/currentuser',
      ('_?={0}' -f $script:installLocation)
    )
  } finally {
    Remove-Item -LiteralPath $uninstallerCopy -Force -ErrorAction SilentlyContinue
  }
}

try {
  [IO.Directory]::CreateDirectory($root) | Out-Null
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', $diagnosticPath, 'Process')

  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $candidate = Get-ChildItem (Join-Path (Get-Location) 'dist') -Filter 'Kun-*-win-x64.exe' |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    Assert-True ($null -ne $candidate) 'No dist/Kun-*-win-x64.exe installer was found.'
    $script:InstallerPath = $candidate.FullName
  } else {
    $script:InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
  }

  $existingKun = @(@(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  ) | ForEach-Object { Get-ChildItem $_ -ErrorAction SilentlyContinue } | Where-Object {
    try {
      (Get-ItemPropertyValue -LiteralPath $_.PSPath -Name DisplayName -ErrorAction Stop) -in @('Kun', 'DeepSeek GUI')
    } catch {
      $false
    }
  })
  Assert-True ($existingKun.Count -eq 0) 'The smoke requires a clean Kun/DeepSeek GUI installation.'

  Invoke-CheckedProcess 'install' $script:InstallerPath @(
    '/S',
    '/currentuser',
    ('"/D={0}"' -f $installParent)
  )

  foreach ($requiredPath in @(
    (Join-Path $installLocation 'Kun.exe'),
    (Join-Path $installLocation 'Uninstall Kun.exe'),
    (Join-Path $installLocation 'resources\app.asar')
  )) {
    Assert-True (Test-Path -LiteralPath $requiredPath -PathType Leaf) "Installed file is missing: $requiredPath"
  }
  Find-KunRegistration

  & node (Join-Path $PSScriptRoot 'smoke-packaged-cli.cjs') `
    '--resources' (Join-Path $installLocation 'resources')
  Assert-True ($LASTEXITCODE -eq 0) 'The installed Kun CLI smoke failed.'

  Invoke-SmokeUninstaller
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $installLocation 'Kun.exe'))) `
    'Kun.exe remains after uninstall.'
  Assert-True (-not (Test-Path -LiteralPath $installRegistryPath)) `
    'The Kun install registration remains after uninstall.'
  Assert-True (-not (Test-Path -LiteralPath $uninstallRegistryPath)) `
    'The Kun uninstall registration remains after uninstall.'

  Write-Host 'Windows installer smoke passed.'
} catch {
  if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
    Write-Warning "Installer diagnostics:`n$(Get-Content -LiteralPath $diagnosticPath -Raw)"
  }
  throw
} finally {
  try {
    Invoke-SmokeUninstaller
  } catch {
    Write-Warning "Unable to clean up the smoke installation: $($_.Exception.Message)"
  }
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_DIAGNOSTIC_PATH', $previousDiagnosticPath, 'Process')
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
