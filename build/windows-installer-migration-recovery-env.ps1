function Get-InstallerRecoveryFieldMap {
  return [ordered]@{
    AppExecutable = 'KUN_INSTALLER_APP_EXECUTABLE'
    AppGuid = 'KUN_INSTALLER_APP_GUID'
    AutomaticUpdate = 'KUN_INSTALLER_AUTOMATIC_UPDATE'
    CanonicalLeaf = 'KUN_INSTALLER_CANONICAL_LEAF'
    CommonDesktop = 'KUN_INSTALLER_COMMON_DESKTOP'
    CommonPrograms = 'KUN_INSTALLER_COMMON_PROGRAMS'
    CurrentDesktop = 'KUN_INSTALLER_CURRENT_DESKTOP'
    CurrentPrograms = 'KUN_INSTALLER_CURRENT_PROGRAMS'
    InstallMode = 'KUN_INSTALLER_INSTALL_MODE'
    InstallRegistryKey = 'KUN_INSTALLER_INSTALL_REGISTRY_KEY'
    JournalPath = 'KUN_INSTALLER_JOURNAL'
    BackupRoot = 'KUN_INSTALLER_PAYLOAD_BACKUP'
    PreserveOtherScope = 'KUN_INSTALLER_PRESERVE_OTHER_SCOPE'
    ProductName = 'KUN_INSTALLER_PRODUCT_NAME'
    SecondarySource = 'KUN_INSTALLER_SECONDARY_SOURCE'
    Source = 'KUN_INSTALLER_SOURCE'
    Target = 'KUN_INSTALLER_TARGET'
    UninstallRegistryKey = 'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY'
    StageRoot = 'KUN_INSTALLER_STAGE'
    HealthResult = 'KUN_INSTALLER_HEALTH_RESULT'
  }
}

function Set-InstallerRecoveryFieldsFromEnvironment([hashtable]$Transaction) {
  $map = Get-InstallerRecoveryFieldMap
  foreach ($field in $map.Keys) {
    if (-not $Transaction.ContainsKey($field)) {
      $Transaction[$field] = Get-EnvironmentValue $map[$field]
    }
  }
}

function Assert-InstallerRecoveryFields($Transaction) {
  $required = @(
    'AppExecutable', 'AppGuid', 'AutomaticUpdate', 'CanonicalLeaf', 'InstallMode',
    'InstallRegistryKey', 'JournalPath', 'ProductName', 'Source', 'StageRoot',
    'Target', 'UninstallRegistryKey', 'HealthResult'
  )
  if ((Get-NormalizedInstallMode) -eq 'all') {
    $required += @('CommonDesktop', 'CommonPrograms')
  } else {
    $required += @('CurrentDesktop', 'CurrentPrograms')
  }
  foreach ($field in $required) {
    if ([string]::IsNullOrWhiteSpace([string]$Transaction.$field)) {
      throw "The automatic update transaction recovery field is required: $field"
    }
  }
}
