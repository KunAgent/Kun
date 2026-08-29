param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('ResolvePath', 'ResolveSource', 'ResolveUpdateScope', 'ResolveUninstaller', 'ResolveRecoveryExecutable', 'RecoverUpdateTransaction', 'PrepareUpdateTransaction', 'SwitchUpdatePayload', 'ValidateCutover', 'RollbackUpdateTransaction', 'ResolveHealthToken', 'ValidateHealthResult', 'CommitUpdateTransaction', 'FinalizeUpdateTransaction', 'StopProcesses', 'Recover', 'Prepare', 'FallbackCleanup', 'Restore', 'ValidatePayload', 'BackupPayload', 'RestorePayloadBackup', 'CleanupInPlaceLeftovers', 'CleanupJournal', 'UpdatePath', 'WriteUpdateResult')]
  [string]$Action,
  [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0


. (Join-Path $PSScriptRoot 'windows-installer-migration-paths.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-migration-journal.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-migration-filesystem.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-migration-actions.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-migration-transaction.ps1')

function Invoke-InstallerFaultPoint([string]$Point) {
  if (-not [string]::Equals((Get-EnvironmentValue 'KUN_INSTALLER_FAULT_INJECTION'), '1', [StringComparison]::Ordinal)) {
    return
  }
  if (-not [string]::Equals((Get-EnvironmentValue 'KUN_INSTALLER_FAULT_POINT'), $Point, [StringComparison]::Ordinal)) {
    return
  }

  $temporaryRoot = Normalize-FullPath ([IO.Path]::GetTempPath())
  foreach ($pathValue in @(
    (Get-EnvironmentValue 'KUN_INSTALLER_SOURCE'),
    (Get-EnvironmentValue 'KUN_INSTALLER_TARGET'),
    (Get-EnvironmentValue 'KUN_INSTALLER_JOURNAL')
  )) {
    $path = Normalize-FullPath $pathValue
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-PathWithin $path $temporaryRoot)) {
      throw 'Installer fault injection is restricted to a temporary smoke-test transaction.'
    }
  }
  throw "KUN_INSTALLER_FAULT_INJECTION:$Point"
}

function Update-UserPath {
  # Missing secondary sources do not participate in filesystem migration, but
  # their stale bin entries should still be removed from the user PATH.
  $sources = @(Get-InstallSources $false $true)
  $target = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_TARGET')
  if ([string]::IsNullOrWhiteSpace($target)) {
    throw 'KUN_INSTALLER_TARGET is required for PATH reconciliation.'
  }

  $pathSources = @()
  foreach ($source in $sources) {
    $pathSources += $source
    if (Test-LegacyLeaf (Split-Path -Leaf $source)) {
      # Older assisted installers could register or add PATH for the falsely
      # nested child even though the application payload lived in the parent.
      $pathSources += Join-Path $source (Get-CanonicalLeaf)
    }
  }
  $sourceBins = @($pathSources | Select-Object -Unique | ForEach-Object { Join-Path $_ 'bin' })
  $targetBin = Join-Path $target 'bin'
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $kept = @($parts | Where-Object {
    $candidatePart = $_.TrimEnd('\')
    $isSourceBin = $sourceBins | Where-Object {
      [string]::Equals($candidatePart, $_.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
    }
    -not $isSourceBin -and
      -not [string]::Equals($candidatePart, $targetBin.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  })
  [Environment]::SetEnvironmentVariable('Path', (($kept + $targetBin) -join ';'), 'User')
  Invoke-InstallerFaultPoint 'path.after_write'
}

function Write-AutomaticUpdateResult {
  $path = Normalize-FullPath (Get-EnvironmentValue 'KUN_INSTALLER_PENDING_RESULT')
  if ([string]::IsNullOrWhiteSpace($path)) {
    throw 'KUN_INSTALLER_PENDING_RESULT is required for automatic update result reporting.'
  }
  $outcome = if ([string]::Equals((Get-EnvironmentValue 'KUN_INSTALLER_ABORT_CODE'), 'success', [StringComparison]::Ordinal)) { 'success' } else { 'aborted' }
  $transactionPath = Get-EnvironmentValue 'KUN_INSTALLER_TRANSACTION'
  $transaction = if ([string]::IsNullOrWhiteSpace($transactionPath)) { $null } else { Read-UpdateTransaction }
  $transactionState = if ($null -eq $transaction) { '' } else { [string]$transaction.Phase }
  $rollbackOutcome = if ($null -eq $transaction -or $null -eq $transaction.PSObject.Properties['RollbackOutcome']) {
    ''
  } else {
    [string]$transaction.RollbackOutcome
  }
  $recoveryEnvironment = [ordered]@{}
  foreach ($name in @(
    'KUN_INSTALLER_APP_EXECUTABLE',
    'KUN_INSTALLER_APP_GUID',
    'KUN_INSTALLER_AUTOMATIC_UPDATE',
    'KUN_INSTALLER_CANONICAL_LEAF',
    'KUN_INSTALLER_COMMON_DESKTOP',
    'KUN_INSTALLER_COMMON_PROGRAMS',
    'KUN_INSTALLER_CURRENT_DESKTOP',
    'KUN_INSTALLER_CURRENT_PROGRAMS',
    'KUN_INSTALLER_INSTALL_MODE',
    'KUN_INSTALLER_INSTALL_REGISTRY_KEY',
    'KUN_INSTALLER_JOURNAL',
    'KUN_INSTALLER_PAYLOAD_BACKUP',
    'KUN_INSTALLER_PRESERVE_OTHER_SCOPE',
    'KUN_INSTALLER_PRODUCT_NAME',
    'KUN_INSTALLER_SECONDARY_SOURCE',
    'KUN_INSTALLER_SOURCE',
    'KUN_INSTALLER_TARGET',
    'KUN_INSTALLER_TRANSACTION',
    'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY'
  )) {
    $value = Get-EnvironmentValue $name
    if (-not [string]::IsNullOrWhiteSpace($value)) { $recoveryEnvironment[$name] = $value }
  }
  $payload = [ordered]@{
    schemaVersion = 2
    outcome = $outcome
    code = (Get-EnvironmentValue 'KUN_INSTALLER_ABORT_CODE')
    message = (Get-EnvironmentValue 'KUN_INSTALLER_ABORT_MESSAGE')
    phase = (Get-EnvironmentValue 'KUN_INSTALLER_ABORT_PHASE')
    backupDir = (Get-EnvironmentValue 'KUN_INSTALLER_PAYLOAD_BACKUP')
    transactionState = $transactionState
    rollbackOutcome = $rollbackOutcome
    recoveryEnvironment = $recoveryEnvironment
    at = [DateTime]::UtcNow.ToString('o')
  }
  $parent = Split-Path -Parent $path
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  $temporaryPath = "$path.$PID.tmp"
  $payload | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $path -Force
}

try {
  Write-InstallerDiagnostic (
    "START action=$Action source=$(Get-EnvironmentValue 'KUN_INSTALLER_SOURCE') " +
    "target=$(Get-EnvironmentValue 'KUN_INSTALLER_TARGET') " +
    "journal=$(Get-EnvironmentValue 'KUN_INSTALLER_JOURNAL')"
  )
  switch ($Action) {
    'ResolvePath' {
      Write-ResolvedInstallTarget (Resolve-InstallTarget)
    }
    'ResolveSource' {
      Write-ResolvedInstallTarget (Resolve-RegisteredInstallSource)
    }
    'ResolveUpdateScope' {
      Write-InstallerResult (Resolve-AutomaticUpdateScope)
    }
    'ResolveUninstaller' {
      Write-InstallerResult (Resolve-TrustedAppUninstaller)
    }
    'ResolveRecoveryExecutable' {
      Write-InstallerResult (Resolve-RecoveryPayloadExecutable)
    }
    'RecoverUpdateTransaction' {
      Recover-PendingUpdateTransaction
    }
    'PrepareUpdateTransaction' {
      Initialize-UpdateTransaction
    }
    'SwitchUpdatePayload' {
      Invoke-SwitchUpdatePayload
    }
    'ValidateCutover' {
      Assert-UpdateCutover
    }
    'RollbackUpdateTransaction' {
      Invoke-RollbackUpdateTransaction
    }
    'ResolveHealthToken' {
      Resolve-UpdateHealthToken
    }
    'ValidateHealthResult' {
      Assert-UpdateHealthResult
    }
    'CommitUpdateTransaction' {
      Invoke-CommitUpdateTransaction
    }
    'FinalizeUpdateTransaction' {
      Finalize-TerminalUpdateTransaction
    }
    'StopProcesses' {
      $stopResult = Stop-InstallRootProcesses
      if ($stopResult.Outcome -eq 'running') {
        $processIds = @($stopResult.ProcessIds | ForEach-Object { [string]$_ }) -join ','
        Write-InstallerDiagnostic "STOP_PROCESSES outcome=running pids=$processIds"
        [Console]::Error.WriteLine("KUN_INSTALLER_STOP_RESULT=running pids=$processIds")
        exit 2
      }
      if ($stopResult.Outcome -ne 'stopped') {
        throw 'The installer received an unexpected process inspection result.'
      }
    }
    'Recover' {
      Invoke-RestoreJournal
    }
    'Prepare' {
      Invoke-Prepare
    }
    'FallbackCleanup' {
      Invoke-FallbackCleanup
    }
    'Restore' {
      Invoke-RestoreJournal
      Remove-EmptyLegacyContainers
    }
    'ValidatePayload' {
      Invoke-InstallerFaultPoint 'validate.before_check'
      Assert-PackagedInstallPayload
    }
    'BackupPayload' {
      Backup-InPlacePayload
    }
    'RestorePayloadBackup' {
      Restore-InPlacePayloadBackup
    }
    'WriteUpdateResult' {
      Write-AutomaticUpdateResult
    }
    'CleanupInPlaceLeftovers' {
      Invoke-CleanupInPlaceLeftovers
    }
    'CleanupJournal' {
      Invoke-CleanupJournal
    }
    'UpdatePath' {
      Update-UserPath
    }
  }
  Write-InstallerDiagnostic "SUCCESS action=$Action"
} catch {
  if ($Action -eq 'StopProcesses') {
    # The NSIS caller distinguishes this safe failure from a verified remaining
    # app process. Do not expose arbitrary PowerShell errors or install paths.
    Write-InstallerDiagnostic 'STOP_PROCESSES outcome=inspection-failed'
    [Console]::Error.WriteLine('KUN_INSTALLER_STOP_RESULT=inspection-failed')
    exit 1
  }
  $errorCategory = [string]$_.CategoryInfo.Category
  $scriptStackTrace = [string]$_.ScriptStackTrace
  Write-InstallerDiagnostic (
    "FAIL action=$Action category=$errorCategory error=$($_.Exception.Message) " +
    "ScriptStackTrace=$scriptStackTrace"
  )
  [Console]::Error.WriteLine("category=$errorCategory")
  [Console]::Error.WriteLine($_.Exception.Message)
  if (-not [string]::IsNullOrWhiteSpace($scriptStackTrace)) {
    [Console]::Error.WriteLine("ScriptStackTrace=$scriptStackTrace")
  }
  exit 1
}
