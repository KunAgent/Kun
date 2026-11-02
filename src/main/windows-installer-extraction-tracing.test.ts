import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRoot = dirname(require.resolve('app-builder-lib/package.json'))
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
const original = read(join(builderRoot, 'templates/nsis/include/extractAppPackage.nsh'))
const instrumented = read('build/installer-extraction-template.nsh')
const tracing = read('build/installer-extraction-tracing.nsh')
const processCheck = read('build/installer-process-check.nsh')

describe('pinned installer extraction tracing (static contracts, not native execution)', () => {
  it('retains exactly the pinned extraction operations after removing diagnostic calls', () => {
    expect(require('app-builder-lib/package.json').version).toBe('26.16.1')
    const withoutTracing = instrumented.split('\n').filter((line) =>
      !line.startsWith(';') && !/^\s*!insertmacro KunTraceExtraction "/.test(line)
    ).join('\n')
    expect(withoutTracing).toBe(original)
    expect(read('build/installer-extraction-LICENSE')).toBe(read('node_modules/electron-builder/LICENSE'))
  })

  it('replaces every stock macro only after definition and before extraction expansion', () => {
    const names = [...original.matchAll(/^!macro (\w+)/gm)].map((match) => match[1])
    expect([...tracing.matchAll(/^ {2}!macroundef (\w+)/gm)].map((match) => match[1])).toEqual(names)
    const section = read(join(builderRoot, 'templates/nsis/installSection.nsh'))
    expect(section.indexOf('!include installer.nsh')).toBeLessThan(section.indexOf('!insertmacro CHECK_APP_RUNNING'))
    expect(section.indexOf('!insertmacro CHECK_APP_RUNNING')).toBeLessThan(section.indexOf('!insertmacro installApplicationFiles'))
    expect(read(join(builderRoot, 'templates/nsis/include/installer.nsh'))).toContain('!include "extractAppPackage.nsh"')
    expect(processCheck).toContain('!include "${PROJECT_DIR}\\build\\installer-extraction-tracing.nsh"')
    expect(processCheck).toContain('  !else\n    !insertmacro KunInstallExtractionTracing\n    Call KunPrepareInstallMigration')
    expect(tracing).toContain('!include "${PROJECT_DIR}\\build\\installer-extraction-template.nsh"')
  })

  it.each([
    ['archive-write', '!insertmacro compute_files_for_current_arch'],
    ['decompression', '!insertmacro decompress'],
    ['7z-extract', 'Nsis7z::Extract "${FILE}"'],
    ['shell-copy', 'CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR'],
    ['fallback-cleanup', 'RMDir /r "$PLUGINSDIR\\7z-out"'],
    ['fallback-extract', 'Nsis7z::Extract "${FILE}"']
  ])('wraps %s without changing the native operation', (step, operation) => {
    const start = instrumented.indexOf(`!insertmacro KunTraceExtraction "${step}-start"`)
    const end = instrumented.indexOf(`!insertmacro KunTraceExtraction "${step}-returned"`)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(instrumented.slice(start, end)).toContain(operation)
  })

  it('keeps the phase sentinel, registers and caller error flag owned by existing logger', () => {
    const body = tracing.slice(tracing.indexOf('!macro KunTraceExtraction STEP'))
    expect(body).toContain('${if} $KunInstallerTransactionPath != ""')
    expect(body).not.toContain('${isUpdated}')
    expect(body).toContain('Push $KunInstallerUpdateBoundary')
    expect(body).toContain('Call KunRecordAutomaticUpdateBoundary\n    Pop $KunInstallerUpdateBoundary')
    expect(body).not.toMatch(/ClearErrors|SetErrors|\$(?:R\d|\d)|Quit|Abort|Sleep|Exec|Delete|RMDir/)
    expect(body).not.toMatch(/INSTDIR|PLUGINSDIR|APPDATA|ReadEnvStr/)
  })
})
