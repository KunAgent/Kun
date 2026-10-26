import { appendFileSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const installer = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8').replace(/\r\n/g, '\n')
const automatic = readFileSync(join(process.cwd(), 'build/installer-automatic-update.nsh'), 'utf8').replace(/\r\n/g, '\n')
const observations = readFileSync(join(process.cwd(), 'build/installer-update-observability.nsh'), 'utf8').replace(/\r\n/g, '\n')

function functionBody(name: string): string {
  const match = observations.match(new RegExp(`  Function ${name.replace(/\./g, '\\.')}\\n([\\s\\S]*?)  FunctionEnd`))
  expect(match, `missing NSIS function ${name}`).not.toBeNull()
  return match![1]
}

// Execute the success-path file instructions against real bytes using NSIS's
// documented FileOpen "a" semantics: preserve bytes, position initially zero.
// This models file offsets; it is not execution of a compiled NSIS installer.
function replayBoundaryFileInstructions(body: string, path: string, boundary: string): void {
  let descriptor: number | undefined
  let position = 0
  try {
    for (const instruction of body.split('\n').map((line) => line.trim())) {
      if (instruction === 'FileOpen $R8 "$KunInstallerDiagnosticPath" a') {
        descriptor = openSync(path, 'r+')
        position = 0
      } else if (instruction === 'FileSeek $R8 0 END') {
        position = fstatSync(descriptor!).size
      } else if (instruction.startsWith('FileWrite $R8 "')) {
        const bytes = Buffer.from(instruction.slice('FileWrite $R8 "'.length, -1)
          .replace('$KunInstallerUpdateBoundary', boundary)
          .replace(/\$\\r/g, '\r').replace(/\$\\n/g, '\n'), 'utf8')
        position += writeSync(descriptor!, bytes, 0, bytes.length, position)
      } else if (instruction === 'FileClose $R8') {
        closeSync(descriptor!)
        descriptor = undefined
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

describe('Windows installer boundary observability (static NSIS contracts)', () => {
  it('records preparation before extraction and cutover before the switch helper', () => {
    const prepare = installer.slice(installer.indexOf('  Function KunPrepareInstallMigration'))
    expect(prepare.indexOf('StrCpy $KunInstallerMigrationPrepared 1')).toBeLessThan(
      prepare.indexOf('Call KunRecordPreparedAutomaticUpdate')
    )
    expect(prepare.indexOf('Call KunRecordPreparedAutomaticUpdate')).toBeLessThan(
      prepare.indexOf('StrCpy $INSTDIR "$PLUGINSDIR\\kun-candidate"')
    )
    const install = installer.slice(installer.indexOf('!macro customInstall'), installer.indexOf('!macro customUnInstall\n'))
    expect(install.indexOf('Call KunRecordCutoverAutomaticUpdate')).toBeGreaterThan(-1)
    expect(install.indexOf('Call KunRecordCutoverAutomaticUpdate')).toBeLessThan(
      install.indexOf('Call KunFinishAutomaticUpdateTransaction')
    )
    const template = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')),
      'templates/nsis/installSection.nsh'), 'utf8').replace(/\r\n/g, '\n')
    expect(template.indexOf('!insertmacro installApplicationFiles')).toBeLessThan(
      template.indexOf('!insertmacro customInstall')
    )
  })

  it('preserves caller registers and the error flag while appending diagnostics', () => {
    const body = functionBody('KunRecordAutomaticUpdateBoundary')
    expect(body).toContain('Push $R8\n    Push $R9')
    expect(body).toContain('${if} ${Errors}\n      StrCpy $R9 1')
    expect(body).toContain('FileOpen $R8 "$KunInstallerDiagnosticPath" a')
    expect(body).toContain('FileSeek $R8 0 END\n        ${ifNot} ${Errors}\n          FileWrite')
    expect(body).toContain('FileWrite $R8 "NSIS update-boundary=$KunInstallerUpdateBoundary$\\r$\\n"')
    expect(body).toContain('ClearErrors\n    ${if} $R9 == 1\n      SetErrors')
    expect(body).toContain('Pop $R9\n    Pop $R8')
    expect(body).not.toMatch(/\b(?:Quit|Abort|Delete|RMDir)\b/)
  })

  it('preserves existing UTF-8 bytes and repeated boundaries interleaved with helper appends', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-nsis-log-offset-'))
    const path = join(root, 'diagnostic.log')
    const before = '\uFEFFmanual install diagnostics: \u4f60\u597d\r\n'
    const body = functionBody('KunRecordAutomaticUpdateBoundary')
    try {
      writeFileSync(path, before, 'utf8')
      let expected = before
      for (const boundary of ['prepared', 'registration-original', 'cutover']) {
        replayBoundaryFileInstructions(body, path, boundary)
        expected += `NSIS update-boundary=${boundary}\r\n`
        const helper = `2026-10-26 SUCCESS action=after-${boundary}\r\n`
        appendFileSync(path, helper, 'utf8')
        expected += helper
        expect(readFileSync(path)).toEqual(Buffer.from(expected, 'utf8'))
      }
      expect(readFileSync(path, 'utf8').slice(before.length)).toMatch(/^NSIS update-boundary=prepared\r\n/)

      // Negative control reproduces the original overwrite despite mode "a".
      writeFileSync(path, before, 'utf8')
      replayBoundaryFileInstructions(body.replace('FileSeek $R8 0 END', ''), path, 'cutover')
      expect(readFileSync(path, 'utf8').startsWith(before)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports only an observed automatic-update failure before cutover', () => {
    const body = functionBody('.onInstFailed')
    expect(body).toContain('${ifNot} ${isUpdated}\n      Return')
    expect(body).toContain('${if} $KunInstallerUpdateBoundary != "prepared"\n      Return')
    expect(body).toContain('StrCpy $KunInstallerUpdateBoundary "failed-before-cutover"')
    expect(body).toContain('StrCpy $KunInstallerAbortCode "installer_failed_before_cutover"')
    expect(body).toContain('${if} $KunInstallerPendingResultPath == ""\n      Return')
    expect(body.indexOf('ReadEnvStr $KunInstallerPendingResultPath')).toBeLessThan(
      body.indexOf('Call KunWriteAutomaticUpdateResult')
    )
    expect(body).not.toMatch(/Call Kun(?:Restore|TryRelaunch)|FinalizeUpdateTransaction|RollbackUpdateTransaction/)
    expect(observations).not.toContain('Function .onGUIEnd')
  })

  it('does not publish a speculative aborted result before installation completes', () => {
    expect(functionBody('KunRecordPreparedAutomaticUpdate')).not.toContain('KunWriteAutomaticUpdateResult')
    expect(functionBody('KunRecordCutoverAutomaticUpdate')).not.toContain('KunWriteAutomaticUpdateResult')
    expect(automatic).toContain('!insertmacro KunAutomaticUpdateObservabilityFunctions')
    expect(automatic).toContain('StrCpy $KunInstallerAbortCode "success"\n    Call KunWriteAutomaticUpdateResult')
  })
})
