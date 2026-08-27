import { app } from 'electron'
import { join } from 'node:path'
import { defaultKunControlDir } from '../../kun/src/manager/manager-discovery.js'
import { resolveKunRuntimeBuildId } from './resolve-kun-binary'
import {
  resolveKunExecutableForCurrentApp,
  resolveKunManagerDataDirFromSettings
} from './kun-process'
import {
  drainKunOwnersForHandoff,
  KunHandoffError,
  type KunHandoffOwnerReport
} from './runtime/kun-installed-build-handoff'
import { logKunHandoffEvent } from './runtime/kun-handoff-logging'
import { SETTINGS_FILE_NAME } from './settings-file-paths'

export const PACKAGED_UPDATE_HANDOFF_SMOKE_ARG = '--kun-packaged-update-handoff-smoke'
export const PACKAGED_UPDATE_HANDOFF_SMOKE_READY = 'KUN_UPDATE_HANDOFF_SMOKE_READY '
export const PACKAGED_UPDATE_HANDOFF_SMOKE_FAILED = 'KUN_UPDATE_HANDOFF_SMOKE_FAILED '

export function packagedUpdateHandoffSmokeRequested(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  isPackaged: boolean = app.isPackaged
): boolean {
  return isPackaged &&
    env.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1' &&
    env.KUN_PACKAGED_UPDATE_HANDOFF_SMOKE === '1' &&
    argv.includes(PACKAGED_UPDATE_HANDOFF_SMOKE_ARG)
}

export async function runPackagedUpdateHandoffSmoke(): Promise<void> {
  await app.whenReady()
  const settingsPath = join(app.getPath('userData'), SETTINGS_FILE_NAME)
  const dataDir = await resolveKunManagerDataDirFromSettings(settingsPath)
  const targetBuildId = await resolveKunRuntimeBuildId(resolveKunExecutableForCurrentApp())
  if (!targetBuildId) throw new Error('The packaged Kun Runtime build identity is missing')

  const report = await drainKunOwnersForHandoff({
    reason: 'in-app-update',
    dataDirs: [dataDir],
    settingsPath,
    controlDir: defaultKunControlDir(),
    targetBuildId,
    fetch,
    onEvent: logKunHandoffEvent
  })
  process.stdout.write(`${PACKAGED_UPDATE_HANDOFF_SMOKE_READY}${JSON.stringify({
    targetBuildId,
    postcondition: 'drained',
    owners: report.owners.map(safeOwner)
  })}\n`)
}

export function packagedUpdateHandoffSmokeFailure(error: unknown): string {
  const payload = error instanceof KunHandoffError
    ? {
        code: error.code,
        phase: error.phase,
        retryable: error.retryable,
        ...(error.owner ? { owner: safeOwner(error.owner) } : {})
      }
    : {
        code: 'unexpected',
        phase: 'startup',
        retryable: false
      }
  return `${PACKAGED_UPDATE_HANDOFF_SMOKE_FAILED}${JSON.stringify(payload)}`
}

function safeOwner(owner: Omit<KunHandoffOwnerReport, 'result'> | KunHandoffOwnerReport): object {
  return {
    kind: owner.kind,
    ...(owner.flavor ? { flavor: owner.flavor } : {}),
    ...(owner.pid ? { pid: owner.pid } : {}),
    ...(owner.port ? { port: owner.port } : {}),
    ...(owner.buildId ? { buildId: owner.buildId.slice(0, 12) } : {}),
    ...('result' in owner ? { result: owner.result } : {})
  }
}
