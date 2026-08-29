function Get-EnvironmentValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($null -eq $value) {
    return ''
  }
  return [string]$value
}

function Get-CanonicalLeaf {
  $value = (Get-EnvironmentValue 'KUN_INSTALLER_CANONICAL_LEAF').Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return 'Kun'
  }
  if ($value.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
      $value.Contains('\') -or $value.Contains('/')) {
    throw "The canonical application directory leaf is invalid: $value"
  }
  return $value
}

function Test-ProductionInstallerIdentity {
  return [string]::Equals((Get-CanonicalLeaf), 'Kun', [StringComparison]::OrdinalIgnoreCase)
}

function Get-ApplicationIdentityFiles {
  $configured = (Get-EnvironmentValue 'KUN_INSTALLER_APP_EXECUTABLE').Trim()
  $values = @()
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    $values += $configured
  } else {
    $values += ((Get-CanonicalLeaf) + '.exe')
  }
  if (Test-ProductionInstallerIdentity) {
    $values += @('Kun.exe', 'DeepSeek GUI.exe')
  }
  return @($values | Select-Object -Unique)
}

function Get-AppSpecificUninstallerFiles {
  $configured = (Get-EnvironmentValue 'KUN_INSTALLER_PRODUCT_NAME').Trim()
  $values = @()
  if (-not [string]::IsNullOrWhiteSpace($configured)) {
    $values += ('Uninstall ' + $configured + '.exe')
  } else {
    $values += ('Uninstall ' + (Get-CanonicalLeaf) + '.exe')
  }
  if (Test-ProductionInstallerIdentity) {
    $values += @('Uninstall Kun.exe', 'Uninstall DeepSeek GUI.exe')
  }
  return @($values | Select-Object -Unique)
}

function Write-InstallerDiagnostic([string]$Message) {
  $diagnosticPath = Get-EnvironmentValue 'KUN_INSTALLER_DIAGNOSTIC_PATH'
  if ([string]::IsNullOrWhiteSpace($diagnosticPath)) {
    return
  }

  try {
    $fullPath = [IO.Path]::GetFullPath($diagnosticPath)
    [IO.Directory]::CreateDirectory((Split-Path -Parent $fullPath)) | Out-Null
    [IO.File]::AppendAllText(
      $fullPath,
      ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine),
      [Text.Encoding]::UTF8
    )
  } catch {
    # Diagnostics are opt-in test evidence and must never change installer behavior.
  }
}

function Normalize-FullPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return ''
  }

  $trimmedPath = $PathValue.Trim()
  if (-not [IO.Path]::IsPathRooted($trimmedPath)) {
    throw "Installer paths must be absolute: $trimmedPath"
  }
  $fullPath = [IO.Path]::GetFullPath($trimmedPath)
  $root = [IO.Path]::GetPathRoot($fullPath)
  while ($fullPath.Length -gt $root.Length -and ($fullPath.EndsWith('\') -or $fullPath.EndsWith('/'))) {
    $fullPath = $fullPath.Substring(0, $fullPath.Length - 1)
  }
  return $fullPath
}

function Test-PathEqual([string]$Left, [string]$Right) {
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
    return $false
  }
  return [string]::Equals(
    (Normalize-FullPath $Left),
    (Normalize-FullPath $Right),
    [StringComparison]::OrdinalIgnoreCase
  )
}

function Test-PathWithin([string]$PathValue, [string]$RootValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue) -or [string]::IsNullOrWhiteSpace($RootValue)) {
    return $false
  }
  $path = Normalize-FullPath $PathValue
  $root = Normalize-FullPath $RootValue
  return (Test-PathEqual $path $root) -or
    $path.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Test-LegacyLeaf([string]$Leaf) {
  if (-not (Test-ProductionInstallerIdentity)) {
    return $false
  }
  return [string]::Equals($Leaf, 'DeepSeek GUI', [StringComparison]::OrdinalIgnoreCase) -or
    [string]::Equals($Leaf, 'deepseek-gui', [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-LegacySourceTarget([string]$Source) {
  if ([string]::IsNullOrWhiteSpace($Source)) {
    return ''
  }
  $sourceLeaf = Split-Path -Leaf $Source
  $sourceParent = Split-Path -Parent $Source
  $canonicalLeaf = Get-CanonicalLeaf
  if (Test-LegacyLeaf $sourceLeaf) {
    return Join-Path $sourceParent $canonicalLeaf
  }
  if ([string]::Equals($sourceLeaf, $canonicalLeaf, [StringComparison]::OrdinalIgnoreCase) -and
      (Test-LegacyLeaf (Split-Path -Leaf $sourceParent))) {
    return Join-Path (Split-Path -Parent $sourceParent) $canonicalLeaf
  }
  return ''
}

function Resolve-InstallTarget {
  $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  $candidate = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_CANDIDATE')
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    throw 'The candidate installation path is empty.'
  }

  $candidateIsExplicit = [string]::Equals(
    (Get-EnvironmentValue 'KUN_INSTALLER_CANDIDATE_EXPLICIT'),
    '1',
    [StringComparison]::Ordinal
  )
  if (-not $candidateIsExplicit) {
    $legacySourceTarget = Resolve-LegacySourceTarget $source
    if (-not [string]::IsNullOrWhiteSpace($legacySourceTarget)) {
      return $legacySourceTarget
    }
  }

  $canonicalLeaf = Get-CanonicalLeaf
  $leaf = Split-Path -Leaf $candidate
  $parent = Split-Path -Parent $candidate

  if ([string]::Equals($leaf, $canonicalLeaf, [StringComparison]::OrdinalIgnoreCase)) {
    $parentLeaf = Split-Path -Leaf $parent
    if (Test-LegacyLeaf $parentLeaf) {
      return Join-Path (Split-Path -Parent $parent) $canonicalLeaf
    }
    return $candidate
  }

  if (Test-LegacyLeaf $leaf) {
    return Join-Path $parent $canonicalLeaf
  }

  if (-not [string]::IsNullOrWhiteSpace($source) -and (Test-PathEqual $source $candidate)) {
    return $candidate
  }

  return Join-Path $candidate $canonicalLeaf
}

function Try-NormalizeRegisteredPath([string]$PathValue, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return ''
  }
  try {
    return Normalize-FullPath $PathValue
  } catch {
    Write-InstallerDiagnostic "Ignoring malformed $Label metadata: $($_.Exception.Message)"
    return ''
  }
}

function Get-UninstallCommandSource([string]$UninstallCommand, [string]$Label) {
  $uninstallSource = ''
  if (-not [string]::IsNullOrWhiteSpace($uninstallCommand)) {
    $match = [Text.RegularExpressions.Regex]::Match(
      $uninstallCommand.Trim(),
      '^(?:"(?<path>[^"]+)"|(?<path>.*?\.exe))(?:\s|$)',
      [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
      $uninstaller = Try-NormalizeRegisteredPath $match.Groups['path'].Value "$Label uninstall command"
      $leaf = if ([string]::IsNullOrWhiteSpace($uninstaller)) { '' } else { Split-Path -Leaf $uninstaller }
      if (Get-AppSpecificUninstallerFiles | Where-Object {
        [string]::Equals($_, $leaf, [StringComparison]::OrdinalIgnoreCase)
      }) {
        $uninstallSource = Split-Path -Parent $uninstaller
      }
    }
  }
  return $uninstallSource
}

function Resolve-RegisteredInstallSourceValues(
  [string]$SourceValue,
  [string]$UninstallCommand,
  [string]$Label
) {
  $source = Try-NormalizeRegisteredPath $SourceValue "$Label install location"
  $uninstallSource = Get-UninstallCommandSource $UninstallCommand $Label

  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($source)) {
    $candidates += $source
    $sourceParent = Split-Path -Parent $source
    if ([string]::Equals((Split-Path -Leaf $source), (Get-CanonicalLeaf), [StringComparison]::OrdinalIgnoreCase) -and
        (Test-LegacyLeaf (Split-Path -Leaf $sourceParent))) {
      $candidates += $sourceParent
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($uninstallSource)) {
    $candidates += $uninstallSource
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (Test-RecoverableApplicationSource $candidate) {
      return $candidate
    }
  }

  # Keep an unverified registered path so Prepare can distinguish an empty or
  # missing stale registration from a non-empty directory that must fail closed.
  if (-not [string]::IsNullOrWhiteSpace($source)) {
    return $source
  }
  if (-not [string]::IsNullOrWhiteSpace($uninstallSource)) {
    return $uninstallSource
  }
  if (-not [string]::IsNullOrWhiteSpace($SourceValue) -or
      -not [string]::IsNullOrWhiteSpace($UninstallCommand)) {
    throw "The $Label registration contains no valid absolute Kun program directory."
  }
  return ''
}

function Resolve-RegisteredInstallSource {
  return Resolve-RegisteredInstallSourceValues `
    (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE') `
    (Get-EnvironmentValue 'KUN_INSTALLER_UNINSTALL_STRING') `
    'selected-scope'
}

function Resolve-AutomaticUpdateScope {
  $runningSource = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_UPDATE_SOURCE')
  if ([string]::IsNullOrWhiteSpace($runningSource)) {
    throw 'The automatic update did not provide its running application directory.'
  }
  Assert-SafeInstallRoot $runningSource 'Running application'
  Assert-RecoverableApplicationSource $runningSource

  $matches = @()
  foreach ($candidate in @(
    @{
      Scope = 'current'
      Source = Get-EnvironmentValue 'KUN_INSTALLER_CURRENT_USER_SOURCE'
      Uninstall = Get-EnvironmentValue 'KUN_INSTALLER_CURRENT_USER_UNINSTALL_STRING'
    },
    @{
      Scope = 'all'
      Source = Get-EnvironmentValue 'KUN_INSTALLER_ALL_USERS_SOURCE'
      Uninstall = Get-EnvironmentValue 'KUN_INSTALLER_ALL_USERS_UNINSTALL_STRING'
    }
  )) {
    try {
      $registeredSource = Resolve-RegisteredInstallSourceValues `
        ([string]$candidate.Source) ([string]$candidate.Uninstall) ($candidate.Scope + '-user')
      if (-not [string]::IsNullOrWhiteSpace($registeredSource) -and
          (Test-PathEqual $registeredSource $runningSource) -and
          (Test-RecoverableApplicationSource $registeredSource)) {
        $matches += $candidate.Scope
      }
    } catch {
      Write-InstallerDiagnostic "Automatic update ignored invalid $($candidate.Scope) registration: $($_.Exception.Message)"
    }
  }

  if ($matches.Count -ne 1) {
    throw "The automatic update source did not match exactly one verified Kun registration: $runningSource"
  }
  return $matches[0]
}
