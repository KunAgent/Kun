import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRoot = dirname(require.resolve('app-builder-lib/package.json'))
const nsis = join(builderRoot, 'templates/nsis')
const section = readFileSync(join(nsis, 'installSection.nsh'), 'utf8')
const extraction = readFileSync(join(nsis, 'include/extractAppPackage.nsh'), 'utf8')
const files = readFileSync(join(nsis, 'include/installer.nsh'), 'utf8')
const hooks = readFileSync(join(process.cwd(), 'build/installer-update-extraction.nsh'), 'utf8')
const automatic = readFileSync(join(process.cwd(), 'build/installer-automatic-update.nsh'), 'utf8')
const installer = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8')

describe('Windows embedded extraction registration boundary (static/symbolic contracts)', () => {
  it('uses the pinned builder post-decompression hooks before registry publication', () => {
    expect(require('app-builder-lib/package.json').version).toBe('26.16.1')
    const config = require('../../electron-builder.config.cjs')
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(readFileSync(join(builderRoot, 'out/targets/nsis/NsisTarget.js'), 'utf8'))
      .toContain('const USE_NSIS_BUILT_IN_COMPRESSOR = false;')
    expect(extraction.indexOf('!insertmacro decompress')).toBeLessThan(
      extraction.indexOf('!insertmacro custom_files_post_decompression')
    )
    for (const arch of ['x64', 'ia32', 'arm64']) {
      expect(extraction).toContain(`!insertmacro customFiles_${arch}`)
      expect(hooks).toContain(`!macro customFiles_${arch}\n  !insertmacro KunPrepareAutomaticUpdateRegistration`)
    }
    expect(files.indexOf('!insertmacro extractEmbeddedAppPackage')).toBeLessThan(
      files.indexOf('File "/oname=${UNINSTALL_FILENAME}"')
    )
    expect(section.indexOf('!insertmacro installApplicationFiles')).toBeLessThan(
      section.indexOf('!insertmacro registryAddInstallInfo')
    )
    expect(section.indexOf('!insertmacro registryAddInstallInfo')).toBeLessThan(
      section.indexOf('!insertmacro customInstall')
    )
  })

  it('gates the automatic-only hook and resolves the original executable before publication', () => {
    expect(hooks).toContain('${if} ${isUpdated}\n    Call KunRestorePreCutoverRegistrationTarget')
    expect(hooks).toContain('${if} $KunInstallerMigrationPrepared != 1')
    expect(hooks).toContain('${orIf} $KunInstallerPrimarySourceDir == ""')
    expect(hooks).toContain('${orIf} $KunInstallerStageDir == ""')
    expect(hooks.indexOf('!insertmacro kunRunMigrationHelper ResolveRecoveryExecutable')).toBeLessThan(
      hooks.indexOf('StrCpy $INSTDIR $KunInstallerPrimarySourceDir')
    )
    expect(hooks).toContain('StrCpy $appExe $KunInstallerHelperOutput')
    expect(hooks).not.toMatch(/^\s*(?:SetOutPath|StrCpy \$OUTDIR|Call KunFinishAutomaticUpdateTransaction)/m)
    expect(automatic).toContain('!insertmacro KunAutomaticUpdateExtractionFunctions')
    expect(installer).toContain('Call KunFinishAutomaticUpdateTransaction')
  })

  it.each([
    ['C:\\Users\\test\\AppData\\Local\\Programs\\Kun', 'Kun.exe'],
    ['C:\\Users\\test\\AppData\\Local\\Programs\\DeepSeek GUI', 'DeepSeek GUI.exe']
  ])('keeps uninstaller output staged and registration at original source: %s', (source, executable) => {
    // Symbolically evaluate the real hook's two assignments and the builder's
    // variable consumers. This is not execution of NSIS or a native installer.
    const stage = 'C:\\Users\\test\\AppData\\Local\\Programs\\Kun.kun-stage-123'
    const state: Record<string, string> = {
      INSTDIR: stage,
      OUTDIR: stage,
      appExe: win32.join(stage, 'Kun.exe'),
      KunInstallerPrimarySourceDir: source,
      KunInstallerHelperOutput: win32.join(source, executable)
    }
    for (const match of hooks.matchAll(/^\s*StrCpy \$(INSTDIR|appExe) \$(\w+)$/gm)) {
      state[match[1]] = state[match[2]]
    }
    expect(files).toContain('File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"')
    expect(files).toContain('WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"')
    expect(files).toContain('CreateShortCut "$newStartMenuLink" "$appExe"')
    expect(win32.join(state.OUTDIR, 'Uninstall Kun.exe')).toBe(win32.join(stage, 'Uninstall Kun.exe'))
    expect(state.INSTDIR).toBe(source)
    expect(state.appExe).toBe(win32.join(source, executable))
    expect(state.INSTDIR).not.toContain('.kun-stage-')
    expect(state.appExe).not.toContain('.kun-stage-')
  })
})
