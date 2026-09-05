function Get-InstallSources(
  [bool]$ValidateSecondary = $true,
  [bool]$IncludeMissingSecondary = $false
) {
  $primary = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  $secondary = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SECONDARY_SOURCE')
  if (-not [string]::IsNullOrWhiteSpace($secondary)) {
    if (-not (Test-Path -LiteralPath $secondary)) {
      Write-InstallerDiagnostic "Ignoring missing current-user installation source: $secondary"
      if (-not $IncludeMissingSecondary) {
        $secondary = ''
      }
    } elseif (-not (Test-Path -LiteralPath $secondary -PathType Container)) {
      throw "The current-user installation source exists but is not a directory: $secondary"
    } elseif ($ValidateSecondary) {
      Assert-TrustedSecondarySource $secondary
    }
  }
  $sources = @($primary, $secondary)
  $normalizedSources = @()
  foreach ($sourceValue in $sources) {
    $source = Normalize-FullPath $sourceValue
    if ([string]::IsNullOrWhiteSpace($source)) {
      continue
    }
    if (-not ($normalizedSources | Where-Object { Test-PathEqual $_ $source })) {
      $normalizedSources += $source
    }
  }
  return $normalizedSources
}

function Get-JournalRecords($Journal) {
  if ($null -ne $Journal.PSObject.Properties['Records']) {
    return @($Journal.Records)
  }
  if ($null -ne $Journal.PSObject.Properties['Stash']) {
    return @($Journal)
  }
  throw 'The preservation journal contains no recovery records.'
}

function Get-ValidatedJournalRecord($Record) {
  $source = Normalize-FullPath ([string]$Record.Source)
  $target = Normalize-FullPath ([string]$Record.Target)
  $stash = Normalize-FullPath ([string]$Record.Stash)
  $destination = Normalize-FullPath ([string]$Record.RestoreDestination)
  if ([string]::IsNullOrWhiteSpace($source) -or [string]::IsNullOrWhiteSpace($target) -or
      [string]::IsNullOrWhiteSpace($stash) -or [string]::IsNullOrWhiteSpace($destination)) {
    throw 'The preservation journal contains an empty path.'
  }

  Assert-SafeInstallRoot $source 'Journal source'
  Assert-SafeInstallRoot $target 'Journal target'
  if (-not (Test-PathEqual $target (Get-JournalTarget))) {
    throw "The preservation journal record target does not match the current transaction: $target"
  }
  if (-not (Test-PathEqual $stash (Get-PreservationRoot $source))) {
    throw "The preservation journal references an unexpected recovery directory: $stash"
  }
  if (-not (Test-PathEqual $destination $source) -and -not (Test-PathEqual $destination $target)) {
    throw "The preservation journal references an unexpected restore destination: $destination"
  }
  if (Test-ReparsePoint $stash) {
    throw "The preservation directory is a reparse point: $stash"
  }
  $content = Join-Path $stash 'content'
  if (Test-ReparsePoint $content) {
    throw "The preservation content directory is a reparse point: $content"
  }

  return @{
    Source = $source
    Target = $target
    RestoreDestination = $destination
    Stash = $stash
    Content = $content
  }
}

function Invoke-RestoreJournal {
  $journal = Read-Journal
  if ($null -eq $journal) {
    return
  }

  $validatedRecords = @()
  $collisionNames = @()
  foreach ($recordValue in (Get-JournalRecords $journal)) {
    $record = Get-ValidatedJournalRecord $recordValue
    $validatedRecords += $record
    if (-not (Test-Path -LiteralPath $record.Content -PathType Container)) {
      continue
    }
    Assert-SafeInstallRoot $record.RestoreDestination 'Restore destination'
    foreach ($entry in @(Get-ChildItem -LiteralPath $record.Content -Force)) {
      if (Test-Path -LiteralPath (Join-Path $record.RestoreDestination $entry.Name)) {
        $collisionNames += $entry.Name
      }
    }
  }

  if ($collisionNames.Count -gt 0) {
    $remainingRecords = @()
    foreach ($record in $validatedRecords) {
      if (-not (Test-Path -LiteralPath $record.Content -PathType Container)) {
        continue
      }
      $remainingRecords += @{
        Source = $record.Source
        Target = $record.Target
        RestoreDestination = $record.RestoreDestination
        Stash = $record.Stash
        Entries = @($record.Content | Get-ChildItem -Force | ForEach-Object { $_.Name })
      }
    }
    Write-Journal @{
      SchemaVersion = 3
      Phase = 'restore-conflict'
      Records = $remainingRecords
    }
    throw ('Preserved install content conflicts with existing paths: ' + ($collisionNames -join ', '))
  }

  $movedEntries = 0
  foreach ($record in $validatedRecords) {
    if (-not (Test-Path -LiteralPath $record.Content -PathType Container)) {
      if (Test-Path -LiteralPath $record.Stash) {
        Remove-Item -LiteralPath $record.Stash -Recurse -Force
      }
      continue
    }

    [IO.Directory]::CreateDirectory($record.RestoreDestination) | Out-Null
    foreach ($entry in @(Get-ChildItem -LiteralPath $record.Content -Force)) {
      Move-Item -LiteralPath $entry.FullName -Destination (Join-Path $record.RestoreDestination $entry.Name)
      $movedEntries += 1
      if ($movedEntries -eq 1) {
        Invoke-InstallerFaultPoint 'restore.after_first_entry'
      }
    }
    Remove-Item -LiteralPath $record.Stash -Recurse -Force
  }

  Remove-Journal
}

function Write-PrepareDiagnostic([string]$Phase) {
  Write-InstallerDiagnostic "PREPARE phase=$Phase"
}

function Invoke-Prepare {
  Write-PrepareDiagnostic 'restore-journal'
  Invoke-RestoreJournal

  Write-PrepareDiagnostic 'resolve-paths'
  $primarySource = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  $secondarySource = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SECONDARY_SOURCE')
  $registeredSources = @(Get-InstallSources $true $true)
  $sources = @()
  [int]$staleSourceMask = 0
  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'KUN_INSTALLER_TARGET is required.'
  }

  Write-PrepareDiagnostic 'validate-sources'
  Assert-SafeInstallRoot $target 'Target'
  if ((Test-Path -LiteralPath $target) -and -not (Test-Path -LiteralPath $target -PathType Container)) {
    throw "The target exists but is not a directory: $target"
  }
  Assert-TargetVolumeReadyAndWritable $target
  foreach ($source in $registeredSources) {
    Assert-SafeInstallRoot $source 'Source'
    if (-not (Test-Path -LiteralPath $source)) {
      if (Test-PathEqual $source $primarySource) {
        $staleSourceMask = $staleSourceMask -bor 1
      }
      if (Test-PathEqual $source $secondarySource) {
        $staleSourceMask = $staleSourceMask -bor 2
      }
      continue
    }
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
      throw "The registered source exists but is not a directory: $source"
    }

    $entries = @(Get-ChildItem -LiteralPath $source -Force)
    if ($entries.Count -eq 0) {
      if (Test-PathEqual $source $primarySource) {
        $staleSourceMask = $staleSourceMask -bor 1
      }
      if (Test-PathEqual $source $secondarySource) {
        $staleSourceMask = $staleSourceMask -bor 2
      }
      continue
    }

    Assert-RecoverableApplicationSource $source
    $sources += $source
  }

  $targetIsSource = $sources | Where-Object { Test-PathEqual $_ $target }
  if (-not $targetIsSource -and (Test-Path -LiteralPath $target -PathType Container)) {
    $targetEntries = @(Get-ChildItem -LiteralPath $target -Force)
    if ($targetEntries.Count -gt 0) {
      throw "The canonical target already contains files and cannot be merged safely: $target"
    }
  }

  Write-PrepareDiagnostic 'inspect-payloads'
  $preparedSources = @()
  foreach ($source in $sources) {
    $entries = @(Get-ChildItem -LiteralPath $source -Force)
    if (-not ($entries | Where-Object { Test-KnownApplicationEntry $_ })) {
      throw "The registered source has no recognized application payload: $source"
    }
    $knownDirectories = @($entries | Where-Object {
      $_.PSIsContainer -and (Test-KnownApplicationEntry $_)
    })
    foreach ($directory in $knownDirectories) {
      Assert-NoReparsePointsInTree $directory 'Recognized application directory'
    }
    $unknown = @($entries | Where-Object {
      -not (Test-KnownApplicationEntry $_) -and -not (Test-InstallerSelfEntry $_ $source)
    })
    $stash = Get-PreservationRoot $source
    if ($unknown.Count -gt 0) {
      if (Test-Path -LiteralPath $stash) {
        throw "A preservation directory already exists without a recoverable journal: $stash"
      }
    }
    $preparedSources += @{
      Source = $source
      Stash = $stash
      Unknown = $unknown
    }
  }

  Write-PrepareDiagnostic 'stop-processes'
  $stopResult = Stop-AppProcesses @($sources + $target)
  if ($stopResult.Outcome -ne 'stopped') {
    Write-BlockingProcessDiagnostic $stopResult
    throw 'Unable to stop verified application processes before migration.'
  }
  if (Test-AutomaticUpdateRequested) {
    Write-PrepareDiagnostic 'initialize-transaction'
    Initialize-UpdateTransaction
  }

  Write-PrepareDiagnostic 'preserve-user-files'
  $journal = @{
    SchemaVersion = 3
    Phase = 'preserving'
    Records = @()
  }
  foreach ($set in $preparedSources) {
    $record = @{
      Source = $set.Source
      Target = $target
      RestoreDestination = if (Test-PathEqual $set.Source $target) { $target } else { $set.Source }
      Stash = $set.Stash
      Entries = @($set.Unknown | ForEach-Object { $_.Name })
    }
    $journal.Records += $record
    Write-Journal $journal
    if ($set.Unknown.Count -eq 0) {
      continue
    }
    $content = Join-Path $set.Stash 'content'
    [IO.Directory]::CreateDirectory($content) | Out-Null
    $stashItem = Get-Item -LiteralPath $set.Stash -Force
    $stashItem.Attributes = $stashItem.Attributes -bor [IO.FileAttributes]::Hidden
    foreach ($entry in $set.Unknown) {
      Move-Item -LiteralPath $entry.FullName -Destination (Join-Path $content $entry.Name)
    }
  }

  $journal.Phase = 'preserved'
  if ($journal.Records.Count -gt 0) {
    Write-Journal $journal
  }
  Write-InstallerResult ([string]$staleSourceMask)
}

function Assert-FallbackCleanupSource([string]$Source) {
  $journal = Read-Journal
  if ($null -ne $journal) {
    $matchesJournal = Get-JournalRecords $journal | Where-Object {
      Test-PathEqual ([string]$_.Source) $Source
    }
    if ($matchesJournal) {
      return
    }
    throw "The cleanup source does not match the preservation journal: $Source"
  }

  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if (-not (Test-PathEqual $Source $target)) {
    throw "The cleanup source has no preservation journal and does not match the install target: $Source"
  }
  Assert-ApplicationSourceIdentity $Source
}

function Invoke-FallbackCleanup {
  $source = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path -LiteralPath $source -PathType Container)) {
    return
  }
  Assert-SafeInstallRoot $source 'Source'
  Assert-FallbackCleanupSource $source

  $knownEntries = @(Get-ChildItem -LiteralPath $source -Force | Where-Object {
    (Test-KnownApplicationEntry $_) -and -not (Test-InstallerSelfEntry $_ $source)
  })
  foreach ($entry in $knownEntries) {
    if ($entry.PSIsContainer) {
      Assert-NoReparsePointsInTree $entry 'Recognized application directory'
    }
  }
  foreach ($entry in $knownEntries) {
    Remove-KnownApplicationEntry $entry
  }

  if (@(Get-ChildItem -LiteralPath $source -Force).Count -eq 0) {
    Remove-Item -LiteralPath $source -Force
  }
}

function Remove-EmptyLegacyContainers {
  $candidates = @()
  $primary = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE')
  $secondary = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_SECONDARY_SOURCE')
  $primaryIsStale = [string]::Equals(
    (Get-EnvironmentValue 'KUN_INSTALLER_PRIMARY_SOURCE_STALE'),
    '1',
    [StringComparison]::Ordinal
  )
  $secondaryIsStale = [string]::Equals(
    (Get-EnvironmentValue 'KUN_INSTALLER_SECONDARY_SOURCE_STALE'),
    '1',
    [StringComparison]::Ordinal
  )
  # Prepare performs the positive secondary-source validation before cleanup.
  # Restore can run after the packaged payload has already been removed.
  foreach ($source in @(Get-InstallSources $false)) {
    if (($primaryIsStale -and (Test-PathEqual $source $primary)) -or
        ($secondaryIsStale -and (Test-PathEqual $source $secondary))) {
      continue
    }
    $candidates += $source
    $parent = Split-Path -Parent $source
    if (Test-LegacyLeaf (Split-Path -Leaf $parent)) {
      $candidates += $parent
    }
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if ((Test-Path -LiteralPath $candidate -PathType Container) -and
        @(Get-ChildItem -LiteralPath $candidate -Force).Count -eq 0) {
      Assert-SafeInstallRoot $candidate 'Empty legacy container'
      Remove-Item -LiteralPath $candidate -Force
    }
  }
}

function Assert-UpdateHealthResult {
  $transaction = Read-UpdateTransaction
  if ($null -eq $transaction) { throw 'The automatic update transaction is unavailable.' }
  $path = Normalize-FullPath ([string]$transaction.HealthResult)
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'The candidate application did not report update health.' }
  $result = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $messageProperty = $result.PSObject.Properties['message']
  $healthMessage = if ($null -eq $messageProperty) { '' } else { ([string]$messageProperty.Value -replace '[\r\n]+', ' ').Trim() }
  Write-InstallerDiagnostic "HEALTH_RESULT ok=$([bool]$result.ok) version=$([string]$result.version) message=$healthMessage"
  $versionMismatch = -not [string]::IsNullOrWhiteSpace([string]$transaction.NewVersion) -and
    -not [string]::Equals([string]$result.version, [string]$transaction.NewVersion, [StringComparison]::OrdinalIgnoreCase)
  if (-not [bool]$result.ok -or
      $versionMismatch -or
      -not [string]::Equals([string]$result.token, [string]$transaction.HealthToken, [StringComparison]::Ordinal) -or
      -not (Test-PathEqual ([string]$result.installDir) ([string]$transaction.Target))) {
    $detail = if ([string]::IsNullOrWhiteSpace($healthMessage)) { '' } else { " $healthMessage" }
    throw "The candidate application failed the update health handshake.$detail"
  }
}
