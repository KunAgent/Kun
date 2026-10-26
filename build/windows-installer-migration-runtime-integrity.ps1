# Verifies the packaged Kun runtime against the manifest that after-pack writes
# next to app.asar. A payload can keep every bootstrap file and still lose a
# package under app.asar.unpacked\kun\node_modules; the app then starts but its
# runtime child exits with ERR_MODULE_NOT_FOUND. Names and sizes are checked for
# every recorded file, plus the package directories the runtime resolves.
#
# The manifest never contains absolute paths, so each entry is validated as a
# normalized relative path before it is joined onto the install root.
function Test-SafeRuntimeManifestPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $false }
  if ($PathValue.IndexOf('\') -ge 0) { return $false }
  if ($PathValue.StartsWith('/')) { return $false }
  if ($PathValue -match '^[A-Za-z]:') { return $false }
  foreach ($segment in $PathValue.Split('/')) {
    if ($segment -eq '' -or $segment -eq '.' -or $segment -eq '..') { return $false }
  }
  return $true
}

function Write-RuntimeFileInspection([string]$PathValue, [string]$RelativePath) {
  try {
    . (Join-Path $PSScriptRoot 'windows-installer-migration-payload-copy.ps1')
    $inspection = [KunInstallerPayloadCopy]::InspectLiteralFile($PathValue)
    Write-InstallerDiagnostic "RUNTIME_FILE_CHECK relative=$RelativePath pathLength=$($PathValue.Length) native=$inspection"
  } catch {
    # Evidence must never turn a strict integrity failure into success or replace
    # its original error. The native probe also refuses reparse-path ancestors.
    Write-InstallerDiagnostic "RUNTIME_FILE_CHECK relative=$RelativePath pathLength=$($PathValue.Length) nativeInspectionError=$($_.Exception.Message)"
  }
}

function Assert-PackagedRuntimeIntegrity([string]$Root) {
  $manifestPath = Join-Path $Root 'resources\kun-runtime-integrity.json'
  # Older installs shipped no manifest. The caller still enforces its required
  # file list, and a rollback may legitimately restore a payload built before
  # manifests existed, so an absent manifest is not an install failure.
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($null -eq $manifest -or [int]$manifest.schemaVersion -ne 1) {
    throw "The packaged Kun runtime integrity manifest is unreadable: $manifestPath"
  }

  foreach ($file in @($manifest.files)) {
    if (-not (Test-SafeRuntimeManifestPath ([string]$file.path))) {
      throw "The packaged Kun runtime integrity manifest has an unsafe path: $($file.path)"
    }
    $path = Join-Path $Root ('resources\' + ([string]$file.path).Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      Write-RuntimeFileInspection $path ([string]$file.path)
      throw "The installed Kun runtime is missing a packaged file: $($file.path)"
    }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "The installed Kun runtime file must not use a reparse point: $($file.path)"
    }
    if ($item.Length -ne [int64]$file.size) {
      Write-RuntimeFileInspection $path ([string]$file.path)
      throw "The installed Kun runtime file is truncated: $($file.path)"
    }
  }

  foreach ($module in @($manifest.modules)) {
    if (-not (Test-SafeRuntimeManifestPath ([string]$module.dir))) {
      throw "The packaged Kun runtime integrity manifest has an unsafe package path: $($module.dir)"
    }
    $path = Join-Path $Root ('resources\' + ([string]$module.dir).Replace('/', '\') + '\package.json')
    try {
      Assert-NonEmptyPayloadFile $path "the runtime package $($module.name)"
    } catch {
      Write-RuntimeFileInspection $path (([string]$module.dir) + '/package.json')
      throw
    }
  }
}
