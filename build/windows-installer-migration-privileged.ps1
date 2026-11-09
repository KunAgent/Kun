param(
  [Parameter(Mandatory=$true)][string]$RequestBase64,
  [Parameter(Mandatory=$true)][ValidatePattern('^kun-update-operation-[a-f0-9-]+$')][string]$PipeName,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$Token
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
function Invoke-InstallerFaultPoint([string]$Point) { }
try {
  foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
    if ([string]$name -like 'KUN_INSTALLER_*' -or [string]$name -like 'KUN_PENDING_*') {
      [Environment]::SetEnvironmentVariable([string]$name,$null,'Process')
    }
  }
  $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
  if ($request.operation -notin @('inspect','finalize') -or $request.scope -ne 'all' -or
      $request.nonce -notmatch '^[a-f0-9-]{36}$') { throw 'Unsupported privileged update request.' }
  foreach ($module in @('paths','journal','filesystem','actions','recovery-env','transaction')) {
    . (Join-Path $PSScriptRoot ("windows-installer-migration-$module.ps1"))
  }
  $target = Normalize-FullPath ([string]$request.target)
  $exe = Normalize-FullPath ([string]$request.executable)
  $source = Normalize-FullPath ([string]$request.installDir)
  if (-not (Test-PathEqual $PSScriptRoot (Join-Path $target 'resources\installer-recovery')) -or
      -not (Test-PathEqual $exe (Join-Path $target ($request.productName + '.exe')))) { throw 'The helper does not belong to this installation.' }
  foreach ($p in @($target, $exe, $PSScriptRoot)) { Assert-NoReparsePathComponents $p 'Privileged updater identity' }
  $appId = switch ([string]$request.productName) {
    'Kun' { 'com.xingyuzhong.deepseekgui' }
    'kun-dv' { 'com.xingyuzhong.deepseekgui.dv' }
    default { throw 'Unknown update product.' }
  }
  $namespaceHex = '50e065bc313411e69bab38c9862bdaf3'
  $namespace = [byte[]]@(for ($i=0; $i -lt 32; $i+=2) { [Convert]::ToByte($namespaceHex.Substring($i,2),16) })
  $sha = [Security.Cryptography.SHA1]::Create()
  try { $hash = $sha.ComputeHash([byte[]]($namespace + [Text.Encoding]::UTF8.GetBytes($appId))) } finally { $sha.Dispose() }
  $hash[6] = ($hash[6] -band 15) -bor 80
  $hash[8] = ($hash[8] -band 63) -bor 128
  $hex = -join ($hash[0..15] | ForEach-Object { $_.ToString('x2') })
  $guid = $hex.Substring(0,8)+'-'+$hex.Substring(8,4)+'-'+$hex.Substring(12,4)+'-'+$hex.Substring(16,4)+'-'+$hex.Substring(20)
  if ($request.appGuid -ne $guid -or [string]::IsNullOrWhiteSpace($request.oldVersion) -or
      [string]::IsNullOrWhiteSpace($request.newVersion)) { throw 'The application GUID or version request does not match.' }
  $root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'KunInstallerRecovery'
  $transactionPath = Join-Path $root ($guid + '-update.json')
  $values = @{
    KUN_INSTALLER_APP_GUID=$guid; KUN_INSTALLER_INSTALL_MODE='all'; KUN_INSTALLER_AUTOMATIC_UPDATE='1'
    KUN_INSTALLER_SOURCE=$source; KUN_INSTALLER_UPDATE_SOURCE=$source; KUN_INSTALLER_TARGET=$target
    KUN_INSTALLER_CANONICAL_LEAF=[string]$request.productName; KUN_INSTALLER_PRODUCT_NAME=[string]$request.productName
    KUN_INSTALLER_APP_EXECUTABLE=($request.productName + '.exe'); KUN_INSTALLER_TRANSACTION=$transactionPath
    KUN_INSTALLER_JOURNAL=(Join-Path $root ($guid + '.json')); KUN_INSTALLER_INSTALL_REGISTRY_KEY=('Software\'+$guid)
    KUN_INSTALLER_UNINSTALL_REGISTRY_KEY=('Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid)
    KUN_INSTALLER_COMMON_DESKTOP=[Environment]::GetFolderPath('CommonDesktopDirectory')
    KUN_INSTALLER_COMMON_PROGRAMS=[Environment]::GetFolderPath('CommonPrograms')
    KUN_PENDING_UPDATE_RESULT=[string]$request.pendingResult
  }
  foreach ($name in $values.Keys) { [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process') }
  # Never infer deletion from access failure or accept caller-supplied recovery paths.
  Assert-UpdateTransactionStorage
  $transaction = Read-TrustedUpdateTransaction
  $completed = $false
  $receiptPath = Join-Path $root ($guid + '-finalized.json')
  if ($null -eq $transaction) {
    # A protected intent survives a lost pipe response. The authority is removed
    # only as the final native finalize operation, never by the ordinary GUI.
    if (-not (Test-JournalAclSecure $receiptPath 'all')) { throw 'There is no authoritative finalization proof.' }
    Assert-NoReparsePathComponents $receiptPath 'Privileged finalization proof'
    $transaction = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ([int]$transaction.SchemaVersion -ne 4 -or $transaction.AppGuid -ne $guid -or
        $transaction.InstallMode -ne 'all') { throw 'Invalid finalization proof identity.' }
    $completed = $true
  }
  if ($transaction.OldVersion -ne $request.oldVersion -or $transaction.NewVersion -ne $request.newVersion -or
      -not (Test-PathEqual ([string]$transaction.Source) $source)) { throw 'Transaction installation/version mismatch.' }
  $transactionTarget = Resolve-LegacySourceTarget $source
  if ([string]::IsNullOrWhiteSpace($transactionTarget)) { $transactionTarget = $source }
  if (-not (Test-PathEqual ([string]$transaction.Target) $transactionTarget)) { throw 'Transaction target is not authorized.' }
  # Version authority follows the validated phase and restored payload location,
  # not the attempted new version. A rolled-back Source still owns cleanup.
  $oldPayload = [string]$transaction.Phase -in @('prepared','rolled_back')
  $runningDirectory = if ($oldPayload) { $source } else { $transactionTarget }
  $runningVersion = if ($oldPayload) { [string]$transaction.OldVersion } else { [string]$transaction.NewVersion }
  if (-not (Test-PathEqual $target $runningDirectory) -or $request.runningVersion -ne $runningVersion -or
      (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $runningVersion) { throw 'The running payload version or location does not match the authoritative phase.' }
  $target = $transactionTarget
  [Environment]::SetEnvironmentVariable('KUN_INSTALLER_TARGET',$target,'Process')
  $registered = $false
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
    try {
      $key = $base.OpenSubKey('Software\'+$guid)
      if ($null -ne $key) {
        try { $location = [string]$key.GetValue('InstallLocation','')
          if ((Test-PathEqual $location $source) -or (Test-PathEqual $location $target) -or
              (Test-PathEqual $location ([string]$transaction.StageRoot))) { $registered=$true }
        } finally { $key.Dispose() }
      }
    } finally { $base.Dispose() }
  }
  if (-not $registered) { throw 'No matching all-users installation registration.' }
  $environment = Get-InstallerRestartRecoveryEnvironment $transaction
  foreach ($name in $environment.Keys) { [Environment]::SetEnvironmentVariable($name,$environment[$name],'Process') }
  Assert-UpdateTransactionPaths $transaction
  if ($request.operation -eq 'finalize') {
    if ([string]$transaction.Phase -notin @('committed','rolled_back','finalizing')) { throw 'The transaction is not terminal.' }
    if (-not $completed) {
      $temporary = "$receiptPath.$PID.tmp"
      $transaction | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $temporary -Encoding UTF8
      Set-SecureJournalFileAcl $temporary 'all'
      Move-Item -LiteralPath $temporary -Destination $receiptPath -Force
      Finalize-TerminalUpdateTransaction
      if ($null -ne (Read-UpdateTransaction)) { throw 'Finalization did not remove the authoritative transaction.' }
    }
  }
  $reply = @{ token=$Token; request=$request; transaction=$transaction
    outcome=$(if ($request.operation -eq 'finalize') { 'finalized' } else { 'inspected' }) }
  $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [IO.Pipes.PipeDirection]::Out)
  try {
    $pipe.Connect(5000)
    $writer = [IO.StreamWriter]::new($pipe,[Text.UTF8Encoding]::new($false))
    $writer.WriteLine(($reply | ConvertTo-Json -Depth 16 -Compress)); $writer.Flush()
  } finally { $pipe.Dispose() }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
