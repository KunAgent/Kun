import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallerRecoveryEnvironment } from './gui-updater-pending'

export type UpdateTransactionHelperDeps = {
  platform: NodeJS.Platform
  isPackaged: () => boolean
  resourcesPath: () => string
  cwd: () => string
  run: (scriptPath: string, action: 'RecoverUpdateTransaction' | 'FinalizeUpdateTransaction', environment: InstallerRecoveryEnvironment) => Promise<void>
  scheduleRollback: (scriptPath: string, environment: InstallerRecoveryEnvironment, pid: number) => Promise<void>
}

const defaultDeps: UpdateTransactionHelperDeps = {
  platform: process.platform,
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
  cwd: () => process.cwd(),
  run: (scriptPath, action, environment) => new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', action], {
      windowsHide: true,
      env: { ...process.env, ...environment }
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Update transaction ${action} exited with ${code}.`)))
  }),
  scheduleRollback: (scriptPath, environment, pid) => new Promise((resolve, reject) => {
    const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64')
    const assignments = Object.entries(environment).map(([key, value]) =>
      `$env:${key}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(value)}'))`
    )
    const command = [
      `$script=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(scriptPath)}'))`,
      `$waitPid=${pid}`,
      ...assignments,
      'Wait-Process -Id $waitPid -ErrorAction SilentlyContinue',
      '& $script -Action RecoverUpdateTransaction',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      '$exe=((& $script -Action ResolveRecoveryExecutable | Select-Object -Last 1).Trim())',
      'if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($exe)) { exit 1 }',
      '& $script -Action FinalizeUpdateTransaction',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      'Start-Process -FilePath $exe'
    ].join('; ')
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    const elevated = environment.KUN_INSTALLER_INSTALL_MODE === 'all'
    const args = elevated
      ? ['-NoProfile', '-Command', `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`]
      : ['-NoProfile', '-EncodedCommand', encoded]
    const child = spawn('powershell.exe', args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

async function resolveScript(deps: UpdateTransactionHelperDeps): Promise<string> {
  const root = deps.isPackaged() ? join(deps.resourcesPath(), 'installer-recovery') : join(deps.cwd(), 'build')
  const script = join(root, 'windows-installer-migration.ps1')
  await access(script)
  return script
}

export async function runUpdateTransactionHelper(
  action: 'RecoverUpdateTransaction' | 'FinalizeUpdateTransaction',
  environment: InstallerRecoveryEnvironment,
  deps: UpdateTransactionHelperDeps = defaultDeps
): Promise<void> {
  if (deps.platform !== 'win32') return
  await deps.run(await resolveScript(deps), action, environment)
}

export async function scheduleUpdateRollbackAfterExit(
  environment: InstallerRecoveryEnvironment,
  pid = process.pid,
  deps: UpdateTransactionHelperDeps = defaultDeps
): Promise<void> {
  if (deps.platform !== 'win32') return
  await deps.scheduleRollback(await resolveScript(deps), environment, pid)
}
