import { app } from 'electron'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { readPackagedAppFlavor } from './app-identity'
import { appIdentityForFlavor } from '../shared/app-environment'

/** electron-builder NSIS derives APP_GUID with UUID v5 from its appId. */
export function installerAppGuid(appId: string): string {
  const namespace = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')
  const bytes = createHash('sha1').update(namespace).update(appId).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function installerRecoveryIdentity() {
  const identity = appIdentityForFlavor(readPackagedAppFlavor(app.getAppPath()) ?? 'production')
  return { appGuid: installerAppGuid(identity.appId), executable: app.getPath('exe'), productName: identity.appName }
}

// Explicit win32 semantics for Windows paths, even in cross-platform tests.
// Native temp filesystem paths must remain native when platform is injected.
export function recoveryPathApi(value: string): typeof path {
  return /^[a-z]:[\\/]|^\\\\/iu.test(value) ? path.win32 as typeof path : path
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 5000, maxBuffer: 16_384 },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
  })
}

/** Use the OS known folder, not a user-supplied ProgramData environment override. */
export async function commonInstallerRecoveryRoot(): Promise<string | null> {
  try {
    const root = await powershell("[Environment]::GetFolderPath('CommonApplicationData')")
    const paths = recoveryPathApi(root)
    return paths.isAbsolute(root) ? paths.join(root, 'KunInstallerRecovery') : null
  } catch { return null }
}

export async function registeredInstallerLocations(appGuid: string): Promise<Array<{ scope: string; installDir: string }>> {
  if (!/^[a-f0-9-]+$/iu.test(appGuid)) return []
  try {
    const output = await powershell(`$ErrorActionPreference = 'Stop'
$locations = @()
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
  foreach ($scope in @('all', 'current')) {
    $hive = if ($scope -eq 'all') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      $key = $base.OpenSubKey('Software\\${appGuid}')
      if ($null -ne $key) {
        try {
          $location = $key.GetValue('InstallLocation', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          if ($location -is [string] -and $location) { $locations += @{scope=$scope; installDir=$location} }
        } finally { $key.Dispose() }
      }
    } finally { $base.Dispose() }
  }
}
ConvertTo-Json -InputObject @($locations) -Compress`)
    const parsed: unknown = JSON.parse(output)
    return Array.isArray(parsed) ? parsed.filter((item): item is { scope: string; installDir: string } =>
      item && typeof item === 'object' && ['all', 'current'].includes(item.scope) && typeof item.installDir === 'string') : []
  } catch { return [] }
}

/** A public recovery record must not be replaceable/writable by another user. */
export async function trustedCommonRecoveryFile(root: string, file: string): Promise<boolean> {
  const quote = (value: string) => `'${value.replace(/'/gu, "''")}'`
  try {
    return await powershell(`$ErrorActionPreference = 'Stop'
$trusted = @('S-1-5-18', 'S-1-5-32-544')
foreach ($p in @(${quote(root)}, ${quote(file)})) {
  $item = Get-Item -LiteralPath $p -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 1 }
  $acl = Get-Acl -LiteralPath $p
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin $trusted) { exit 1 }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
    if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -in $trusted) { continue }
    # Root may allow users to create subdirectories, but not files or replace the root.
    $mask = if ($item.PSIsContainer) { 0xD0152 } else { 0xD0156 }
    if ([int]$rule.FileSystemRights -band $mask) { exit 1 }
  }
}
'OK'`) === 'OK'
  } catch { return false }
}
