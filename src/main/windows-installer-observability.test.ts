import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

describe('Windows installer boundary observability (static NSIS contracts)', () => {
  it('records preparation before extraction and cutover before the switch helper', () => {
    const prepare = installer.slice(installer.indexOf('  Function KunPrepareInstallMigration'))
    expect(prepare.indexOf('StrCpy $KunInstallerMigrationPrepared 1')).toBeLessThan(
      prepare.indexOf('Call KunRecordPreparedAutomaticUpdate')
    )
    expect(prepare.indexOf('Call KunRecordPreparedAutomaticUpdate')).toBeLessThan(
      prepare.indexOf('StrCpy $INSTDIR $KunInstallerStageDir')
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
    expect(body).toContain('FileWrite $R8 "NSIS update-boundary=$KunInstallerUpdateBoundary$\\r$\\n"')
    expect(body).toContain('ClearErrors\n    ${if} $R9 == 1\n      SetErrors')
    expect(body).toContain('Pop $R9\n    Pop $R8')
    expect(body).not.toMatch(/\b(?:Quit|Abort|Delete|RMDir)\b/)
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
