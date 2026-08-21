import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const rootPackage = require('../../package.json')
const afterPack = require('../../scripts/after-pack.cjs')
const nativeBuildEnv = require('../../scripts/electron-native-build-env.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')
const officeCliPrepare = require('../../scripts/prepare-officecli.cjs')

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ds-gui-packaging-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
}

function preloadSourceFiles(dir = join(process.cwd(), 'src/preload')): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return preloadSourceFiles(path)
    if (
      path.endsWith('.d.ts') ||
      path.endsWith('.test.ts') ||
      path.endsWith('.spec.ts')
    ) {
      return []
    }
    return path.endsWith('.ts') ? [path] : []
  })
}

function forbiddenPreloadImports(source: string): string[] {
  const builtins = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')))
  const imports = source.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)
  return [...imports]
    .map((match) => match[1])
    .filter((specifier) => {
      const moduleName = specifier.replace(/^node:/, '')
      return specifier.startsWith('node:') ||
        builtins.has(moduleName) ||
        builtins.has(moduleName.split('/')[0] ?? moduleName)
    })
}

async function visiblePixelBounds(path: string): Promise<{
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
} | undefined> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3] ?? 0
      if (alpha === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (right < left || bottom < top) return undefined
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1
  }
}

function loadBuilderConfigWithEnv(env: Record<string, string | undefined>): typeof builderConfig {
  const configPath = require.resolve('../../electron-builder.config.cjs')
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  delete require.cache[configPath]
  try {
    return require(configPath)
  } finally {
    delete require.cache[configPath]
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    require(configPath)
  }
}

function createMacPackContext(root: string): {
  appOutDir: string
  electronPlatformName: string
  arch: string
  packager: { appInfo: { productFilename: string } }
} {
  return {
    appOutDir: join(root, 'mac-arm64'),
    electronPlatformName: 'darwin',
    arch: 'arm64',
    packager: {
      appInfo: {
        productFilename: 'Kun'
      }
    }
  }
}

function createWindowsPackContext(root: string, signIf: (path: string) => Promise<boolean>) {
  return {
    appOutDir: join(root, 'win-unpacked'),
    electronPlatformName: 'win32',
    arch: 'x64',
    packager: {
      appInfo: {
        productFilename: 'Kun'
      },
      signIf
    }
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('electron-builder Kun packaging', () => {
it('passes the nested OfficeCLI executable through the Windows signing manager', async () => {
    const root = tempRoot()
    const signedPaths: string[] = []
    const context = createWindowsPackContext(root, async (path) => {
      signedPaths.push(path)
      return true
    })

    await expect(afterPack._internals.maybeSignBundledOfficeCli(context)).resolves.toBe(true)
    expect(signedPaths).toEqual([
      join(context.appOutDir, 'resources', 'officecli', 'officecli.exe')
    ])
  })

  it('validates the unpacked Kun runtime before release artifacts are created', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    expect(afterPack.KUN_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'kun/node_modules/typescript/package.json',
      'kun/node_modules/typescript/lib/typescript.js',
      'kun/node_modules/typescript-language-server/package.json',
      'kun/node_modules/typescript-language-server/lib/cli.mjs'
    ]))

    for (const relativePath of afterPack.KUN_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }
    touch(join(unpackedRoot, 'kun/node_modules/@cursor/sdk-darwin-arm64/package.json'))
    touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).not.toThrow()

    rmSync(join(unpackedRoot, 'kun/node_modules/zod'), { recursive: true, force: true })

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).toThrow(
      /kun\/node_modules\/zod\/package\.json/
    )
  })

  it('runs npm through cmd.exe during Windows afterPack hooks', () => {
    expect(afterPack._internals.npmCommand(['prune'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', 'prune']
    })
    expect(afterPack._internals.npmCommand(['prune'], 'darwin')).toEqual({
      command: 'npm',
      args: ['prune']
    })
  })

  it('uses the rounded Kun icon for Windows installers and shortcuts', () => {
    // Windows ships a multi-size .ico (16/24/32/48/64/72/96/128/256) generated
    // from the rounded kun_mac.png so Explorer/desktop render crisp small icons
    // instead of downscaling a single 1024px PNG (#222). The .ico still carries
    // the rounded Kun artwork — it is derived from kun_mac.png.
    expect(builderConfig.win.icon).toBe('./build/icon.ico')
  })

  it('keeps the macOS Dock icon inside the platform artwork safe area', async () => {
    const iconPath = join(process.cwd(), 'src/asset/img/kun_mac.png')

    expect(builderConfig.mac.icon).toBe('./src/asset/img/kun_mac.png')
    await expect(sharp(iconPath).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
      hasAlpha: true
    })
    await expect(visiblePixelBounds(iconPath)).resolves.toEqual({
      left: 100,
      top: 100,
      right: 923,
      bottom: 923,
      width: 824,
      height: 824
    })
  })

  it('ships compact 1x and 2x macOS menu-bar artwork', async () => {
    const icon1xPath = join(process.cwd(), 'src/asset/img/kun_tray_mac.png')
    const icon2xPath = join(process.cwd(), 'src/asset/img/kun_tray_mac@2x.png')

    await expect(sharp(icon1xPath).metadata()).resolves.toMatchObject({
      width: 16,
      height: 16,
      hasAlpha: true
    })
    await expect(sharp(icon2xPath).metadata()).resolves.toMatchObject({
      width: 32,
      height: 32,
      hasAlpha: true
    })
  })

  it('migrates Windows install roots without changing identity or touching user data', () => {
    const installerScript = ['installer.nsh', 'installer-process-check.nsh'].map((fileName) =>
      readFileSync(join(process.cwd(), 'build', fileName), 'utf8').replace(/\r\n/g, '\n')
    ).join('\n')
    const migrationScript = [
      'windows-installer-migration.ps1',
      'windows-installer-migration-paths.ps1',
      'windows-installer-migration-journal.ps1',
      'windows-installer-migration-filesystem.ps1',
      'windows-installer-migration-actions.ps1'
    ].map((fileName) =>
      readFileSync(join(process.cwd(), 'build', fileName), 'utf8')
    ).join('\n')
    const updaterSource = ['gui-updater.ts', 'gui-updater-support.ts']
      .map((fileName) => readFileSync(join(process.cwd(), 'src/main', fileName), 'utf8'))
      .join('\n')

    expect(builderConfig.appId).toBe('com.xingyuzhong.deepseekgui')
    expect(builderConfig.productName).toBe('Kun')
    expect(builderConfig.nsis.include).toBe('build/installer.nsh')
    expect(builderConfig.nsis.allowToChangeInstallationDirectory).toBe(false)
    expect(builderConfig.nsis.deleteAppDataOnUninstall).toBe(false)
    expect(builderConfig.nsis.createDesktopShortcut).toBe('always')
    expect(installerScript).toContain('!include "${PROJECT_DIR}\\build\\installer-process-check.nsh"')
    expect(installerScript).toContain('!macro customInit')
    expect(installerScript).toContain('${if} ${isUpdated}')
    expect(installerScript).toContain('SetSilent silent')
    expect(installerScript).toContain('customPageAfterChangeDir')
    expect(installerScript).toContain('MUI_PAGE_CUSTOMFUNCTION_PRE KunInstallDirectoryPagePre')
    expect(installerScript).toContain('MUI_PAGE_CUSTOMFUNCTION_LEAVE KunInstallDirectoryPageLeave')
    expect(installerScript).toContain('MUI_PAGE_CUSTOMFUNCTION_PRE KunInstallFilesPagePre')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerSourceDir')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerPrimarySourceDir')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerSecondarySourceDir')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerTargetDir')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerSnapshotMode')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerPrimarySourceStale')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerSecondarySourceStale')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerCandidateExplicit')
    expect(installerScript).toContain('Function KunSelectAutomaticUpdateMode')
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper ResolveUpdateScope')
    expect(installerScript).toContain(
      'Automatic update selected the only registered current-user ${PRODUCT_NAME} installation.'
    )
    expect(installerScript).toContain(
      'Automatic update selected the only registered all-users ${PRODUCT_NAME} installation.'
    )
    expect(installerScript).toContain(
      'Automatic update source marker is unavailable with registrations in both scopes; keeping the requested install mode.'
    )
    expect(installerScript).toContain('KUN_INSTALLER_CURRENT_USER_SOURCE')
    expect(installerScript).toContain('KUN_INSTALLER_ALL_USERS_SOURCE')
    expect(installerScript).toContain('KUN_INSTALLER_CANDIDATE_EXPLICIT')
    expect(installerScript).toContain('KUN_INSTALLER_CANONICAL_LEAF')
    expect(installerScript).toContain('KUN_INSTALLER_APP_EXECUTABLE')
    expect(installerScript).toContain('KUN_INSTALLER_PRODUCT_NAME')
    expect(installerScript).toContain('KUN_INSTALLER_INSTALL_MODE')
    expect(installerScript).toContain('KUN_INSTALLER_APP_GUID')
    expect(installerScript).toContain('Call KunRefreshInstallPaths')
    expect(installerScript).toContain(
      'ReadRegStr $R9 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString'
    )
    expect(installerScript).toContain('Function KunReadMigrationResult')
    expect(installerScript).toContain('IfErrors KunMigrationResultMissing')
    expect(installerScript).toContain('-ResultPath "$KunInstallerResultPath"')
    expect(installerScript).toContain('Function KunResolveRegisteredSource')
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper ResolveSource')
    expect(installerScript).toContain('KUN_INSTALLER_UNINSTALL_STRING')
    expect(installerScript).toContain('!macro kunSetEnvironmentFromRegister NAME REGISTER')
    expect(installerScript).toContain(
      '!insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_UNINSTALL_STRING" $R9'
    )
    expect(installerScript).toContain(
      '!insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_CURRENT_USER_UNINSTALL_STRING" $R1'
    )
    expect(installerScript).toContain(
      '!insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_ALL_USERS_UNINSTALL_STRING" $R3'
    )
    expect(installerScript).not.toContain(
      'SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_UNINSTALL_STRING", "$R9")'
    )
    expect(installerScript).toContain('${if} $KunInstallerSnapshotMode != $installMode')
    expect(installerScript).toContain('${andIf} $installMode != "all"')
    expect(installerScript).not.toContain('KUN_INSTALLER_RESULT')
    expect(installerScript).not.toContain('!insertmacro kunRunMigrationHelper Recover')
    expect(installerScript).toContain('Function KunInstallDirectoryPagePre')
    expect(installerScript).toContain('Function KunInstallDirectoryPageLeave')
    expect(installerScript).toContain('Function KunInstallFilesPagePre')
    expect(installerScript).toContain('FileReadUTF16LE $KunInstallerResultHandle')
    expect(installerScript).toContain('${andIf} ${Silent}\n    Call KunPrepareInstallMigration')
    expect(installerScript).toContain('StrCpy $appExe "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"')
    expect(installerScript).toContain('customCheckAppRunning')
    expect(installerScript).toContain('customUnInstallCheck')
    expect(installerScript).toContain('customUnInstallCheckCurrentUser')
    expect(installerScript).toContain('Function KunRetireSelectedShellState')
    expect(installerScript).toContain('Function KunRetireCurrentUserShellState')
    expect(installerScript).toContain(
      'ReadRegStr $KunInstallerCurrentUserShortcutName HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" ShortcutName'
    )
    expect(installerScript).toContain('Delete "$DESKTOP\\${SHORTCUT_NAME}.lnk"')
    expect(installerScript).toContain('Delete "$SMPROGRAMS\\${SHORTCUT_NAME}.lnk"')
    expect(installerScript).toContain('SetShellVarContext current')
    expect(installerScript).toContain('SetShellVarContext all')
    expect(installerScript).toContain(
      'DeleteRegKey HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}"'
    )
    expect(installerScript).toContain(
      'DeleteRegKey HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}"'
    )
    expect(installerScript).toContain('KunHandleOldUninstallerResult')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerInPlaceUpdate')
    expect(installerScript).toContain('Function KunMarkInPlaceAutomaticUpdate')
    expect(installerScript).toContain('${if} $KunInstallerInPlaceUpdate == 1')
    expect(installerScript).toContain(
      'skipping pre-install removal of $KunInstallerPrimarySourceDir'
    )
    expect(installerScript).toContain(
      'suppressed the selected-scope uninstaller until the new payload is installed'
    )
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper CleanupInPlaceLeftovers')
    expect(installerScript).toContain('!insertmacro addDesktopLink "false"')
    expect(installerScript.indexOf('!insertmacro kunRunMigrationHelper ValidatePayload')).toBeLessThan(
      installerScript.indexOf('!insertmacro addDesktopLink "false"')
    )
    expect(installerScript).toContain('KUN_INSTALLER_IN_PLACE_UPDATE')
    expect(installerScript).toContain('Function KunSecureSelectedUninstallRegistration')
    expect(installerScript).toContain('Function KunSecureCurrentUserUninstallRegistration')
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper ResolveUninstaller')
    expect(installerScript).toContain(
      'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString'
    )
    expect(installerScript).toContain('FallbackCleanup')
    expect(installerScript).toContain('Restore')
    expect(installerScript).toContain('UpdatePath')
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper StopProcesses')
    expect(installerScript).toContain('Var /GLOBAL KunInstallerStopDiagnosticPath')
    expect(installerScript).toContain(
      'StrCpy $KunInstallerStopDiagnosticPath "$TEMP\\Kun-installer-process-check-$KunInstallerCurrentPid.log"'
    )
    expect(installerScript).toContain('KUN_INSTALLER_DIAGNOSTIC_PATH')
    expect(installerScript).toContain('${elseIf} $KunInstallerStopResult == 2')
    expect(installerScript).toContain('windows-installer-migration-paths.ps1')
    expect(installerScript).toContain('windows-installer-migration-journal.ps1')
    expect(installerScript).toContain('windows-installer-migration-filesystem.ps1')
    expect(installerScript).toContain('windows-installer-migration-actions.ps1')
    expect(installerScript).toContain('!ifdef BUILD_UNINSTALLER')
    expect(installerScript).toContain('${ifNot} ${isUpdated}')
    expect(installerScript).toContain('MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)"')
    expect(installerScript).toContain(
      'could not safely check whether an older installation is still using files.'
    )
    expect(installerScript).not.toContain('MessageBox MB_RETRYCANCEL|MB_ICONSTOP "$KunInstallerHelperOutput')
    expect(installerScript).not.toContain('RMDir /r "$INSTDIR"')
    expect(installerScript).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"')
    expect(installerScript).toContain('DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"')
    expect(installerScript).toContain('$KunInstallerPrimarySourceStale != 1')
    expect(installerScript).toContain('$KunInstallerSecondarySourceStale != 1')
    expect(installerScript).toContain('without modifying $KunInstallerPrimarySourceDir')
    expect(installerScript).toContain('KUN_INSTALLER_PRIMARY_SOURCE_STALE')
    expect(installerScript).toContain('KUN_INSTALLER_SECONDARY_SOURCE_STALE')
    expect(installerScript).not.toContain('Stop-Process -Id')

    expect(migrationScript).toContain("'ResolveUpdateScope', 'ResolveUninstaller', 'StopProcesses'")
    expect(migrationScript).toContain("'CleanupInPlaceLeftovers', 'CleanupJournal', 'UpdatePath'")
    expect(migrationScript).toContain('function Invoke-CleanupInPlaceLeftovers')
    expect(migrationScript).toContain('function Test-RetainedInPlaceKnownEntry')
    expect(migrationScript).toContain("Get-EnvironmentValue 'KUN_INSTALLER_IN_PLACE_UPDATE'")
    expect(migrationScript).not.toContain("'old-uninstaller.exe'")
    expect(migrationScript).toContain("Join-Path $PSScriptRoot 'kun-windows-installer-result.txt'")
    expect(migrationScript).toContain('function Test-AppOwnedProcessPath')
    expect(migrationScript).toContain('Test-AppOwnedProcessPath $candidate.ExecutablePath $Roots')
    expect(migrationScript).toContain('function Get-VerifiedAppProcesses')
    expect(migrationScript).toContain('Get-CimInstance Win32_Process -ErrorAction Stop')
    expect(migrationScript).not.toContain('Get-CimInstance Win32_Process -ErrorAction SilentlyContinue')
    expect(migrationScript).toContain('& "$env:SystemRoot\\System32\\taskkill.exe" /PID $process.ProcessId /T /F')
    expect(migrationScript).toContain('function Stop-InstallRootProcesses')
    expect(migrationScript).toContain("Assert-SafeInstallRoot $root 'Application root'")
    expect(migrationScript).toContain("if ($stopResult.Outcome -eq 'running')")
    expect(migrationScript).toContain('KUN_INSTALLER_STOP_RESULT=running pids=$processIds')
    expect(migrationScript).toContain('KUN_INSTALLER_STOP_RESULT=inspection-failed')
    expect(migrationScript).toContain('STOP_PROCESSES outcome=inspection-failed')
    expect(migrationScript).toContain('Unable to stop verified application processes before migration.')
    expect(migrationScript).toContain('Test-LegacyLeaf')
    expect(migrationScript).toContain('function Resolve-LegacySourceTarget')
    expect(migrationScript).toContain('Test-ReparsePoint')
    expect(migrationScript).toContain('Test-KnownApplicationEntry')
    expect(migrationScript).toContain('function Assert-NoReparsePathComponents')
    expect(migrationScript).toContain('function Assert-ApplicationSourceIdentity')
    expect(migrationScript).toContain('function Test-RecoverableApplicationSource')
    expect(migrationScript).toContain('function Assert-RecoverableApplicationSource')
    expect(migrationScript).toContain('function Test-AppSpecificUninstaller')
    expect(migrationScript).toContain('not a verifiable Kun installation')
    expect(migrationScript).toContain('Write-InstallerResult ([string]$staleSourceMask)')
    expect(migrationScript).toContain("Get-EnvironmentValue 'KUN_INSTALLER_PRIMARY_SOURCE_STALE'")
    expect(migrationScript).toContain('$pathSources += Join-Path $source (Get-CanonicalLeaf)')
    expect(migrationScript).toContain('function Assert-FallbackCleanupSource')
    expect(migrationScript).toContain('The cleanup source does not match the preservation journal')
    expect(migrationScript).toContain('function Write-InstallerDiagnostic')
    expect(migrationScript).toContain("Get-EnvironmentValue 'KUN_INSTALLER_DIAGNOSTIC_PATH'")
    expect(migrationScript).toContain('$preparedSources += @{')
    expect(migrationScript).toContain('if ($set.Unknown.Count -eq 0)')
    expect(migrationScript).toContain('function Assert-TrustedSecondarySource')
    expect(migrationScript).toContain('function Assert-PackagedApplicationPayload')
    expect(migrationScript).toContain("Join-Path $Source 'resources'")
    expect(migrationScript).toContain("'app.asar'")
    expect(migrationScript).toContain('Ignoring missing current-user installation source')
    expect(migrationScript).toContain('function Assert-NoReparsePointsInTree')
    expect(migrationScript).toContain(
      "Assert-NoReparsePointsInTree $directory 'Recognized application directory'"
    )
    expect(migrationScript).toContain('Get-ValidatedJournalRecord')
    expect(migrationScript).toContain("Get-EnvironmentValue 'KUN_INSTALLER_SECONDARY_SOURCE'")
    expect(migrationScript).toContain('Invoke-RestoreJournal')
    expect(migrationScript).toContain('function Resolve-AutomaticUpdateScope')
    expect(migrationScript).toContain('function Resolve-TrustedAppUninstaller')
    expect(migrationScript).toContain('function Assert-TargetVolumeReadyAndWritable')
    expect(migrationScript).toContain('Assert-TargetVolumeReadyAndWritable $target')
    expect(migrationScript).toContain('function Assert-JournalStorageTrusted')
    expect(migrationScript).toContain('function Assert-JournalContext')
    expect(migrationScript).toContain('$Journal.SchemaVersion = 3')
    expect(migrationScript).toContain('function Get-ApplicationIdentityFiles')
    expect(migrationScript).toContain('function Get-AppSpecificUninstallerFiles')
    expect(migrationScript).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')")
    expect(migrationScript).not.toMatch(/Remove-Item[^\n]*(?:APPDATA|USERPROFILE|\.kun|\.deepseekgui)/i)

    expect(updaterSource).toContain("const WINDOWS_INSTALLER_UPDATE_SOURCE_ENV = 'KUN_INSTALLER_UPDATE_SOURCE'")
    expect(updaterSource).toContain('restoreInstallerUpdateSource = setWindowsInstallerUpdateSource()')
    expect(updaterSource).toContain('autoUpdater.quitAndInstall(true, true)')
  })

  it('builds kun-dv with an isolated application identity and no production updater feed', () => {
    const developmentConfig = loadBuilderConfigWithEnv({ KUN_APP_FLAVOR: 'development' })

    expect(developmentConfig.appId).toBe('com.xingyuzhong.deepseekgui.dv')
    expect(developmentConfig.productName).toBe('kun-dv')
    expect(developmentConfig.artifactName).toContain('kun-dv-')
    expect(developmentConfig.nsis.shortcutName).toBe('kun-dv')
    expect(developmentConfig.extraMetadata.kunAppFlavor).toBe('development')
    expect(developmentConfig.publish).toEqual([])
  })

  it('stamps the DMG volume name with the same artifact version as artifactName', () => {
    // No release env override: electron-builder expands the ${version} macro
    // from package.json when it mounts the volume.
    expect(builderConfig.dmg.title).toBe('Kun Installer ${version}')
    expect(builderConfig.artifactName).toContain('Kun-${version}-')

    const releaseConfig = loadBuilderConfigWithEnv({
      KUN_APP_VERSION: '1.2.3',
      KUN_ARTIFACT_VERSION: undefined
    })
    expect(releaseConfig.dmg.title).toBe('Kun Installer 1.2.3')
    expect(releaseConfig.artifactName).toContain('Kun-1.2.3-')

    const dailyConfig = loadBuilderConfigWithEnv({
      KUN_APP_VERSION: '0.0.0-dev-20260819-1200',
      KUN_ARTIFACT_VERSION: '20260819.1200'
    })
    expect(dailyConfig.dmg.title).toBe('Kun Installer 20260819.1200')
    expect(dailyConfig.artifactName).toContain('Kun-20260819.1200-')

    const developmentConfig = loadBuilderConfigWithEnv({
      KUN_APP_FLAVOR: 'development',
      KUN_APP_VERSION: '1.2.3'
    })
    expect(developmentConfig.dmg.title).toBe('kun-dv Installer 1.2.3')
    expect(developmentConfig.artifactName).toContain('kun-dv-1.2.3-')
  })

  it('keeps sandboxed preload free of Node builtin imports', () => {
    for (const sourcePath of preloadSourceFiles()) {
      expect(forbiddenPreloadImports(readFileSync(sourcePath, 'utf8'))).toEqual([])
    }
  })

  it('requires Apple secure timestamps when Developer ID signing is enabled', () => {
    const signedConfig = loadBuilderConfigWithEnv({
      MAC_SIGN: '1'
    })

    expect(signedConfig.mac.identity).toBeUndefined()
    expect(signedConfig.mac.hardenedRuntime).toBe(true)
    expect(signedConfig.mac.forceCodeSigning).toBe(true)
    expect(signedConfig.mac.timestamp).toBe('http://timestamp.apple.com/ts01')
  })

  it('checks timestamp candidates across nested macOS signed code', () => {
    const root = tempRoot()
    const appBundle = join(root, 'Kun.app')
    const mainExecutable = join(appBundle, 'Contents/MacOS/Kun')
    const framework = join(appBundle, 'Contents/Frameworks/Electron Framework.framework')
    const nativeAddon = join(
      appBundle,
      'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    )
    const resourceScript = join(appBundle, 'Contents/Resources/postinstall.sh')

    touch(mainExecutable)
    touch(join(framework, 'Versions/A/Electron Framework'))
    touch(nativeAddon)
    touch(resourceScript)
    chmodSync(mainExecutable, 0o755)
    chmodSync(resourceScript, 0o755)

    expect(macNotarize._internals.collectSignedCodeCandidates(appBundle)).toEqual([
      appBundle,
      framework,
      mainExecutable,
      nativeAddon
    ])
  })
})
