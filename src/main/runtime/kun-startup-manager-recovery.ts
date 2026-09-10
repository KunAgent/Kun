import { logInfo } from '../logger'
import { ensureServiceManagerWithStartLockHeld, type EnsureServiceManagerInput, type ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import { inspectServiceManager } from '../../../kun/src/manager/manager-resolution.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import { defaultKunControlDir, readManagerHandoffDiscoveryStrict, withManagerStartLock } from '../../../kun/src/manager/manager-discovery.js'
import { drainKunOwnersForHandoffWithLock } from './kun-installed-build-handoff'
import { logKunHandoffEvent } from './kun-handoff-logging'

/** Trusted launch inputs are captured before initialization can fail, never parsed from an error. */
let startupInput: EnsureServiceManagerInput | undefined
export function rememberManagerStartupInput(input: EnsureServiceManagerInput): void {
  startupInput = input
  logInfo('startup', 'Service Manager launch identity selected.', {
    entry: input.launch?.args[0], buildId: input.buildId?.slice(0, 12), flavor: input.flavor
  })
}

export async function recoverStartupManager(forceReplacement = false): Promise<ServiceManagerConnection> {
  if (!startupInput) throw new Error('Manager startup context is unavailable. Quit and launch the installed application again.')
  return recoverManager(startupInput, forceReplacement)
}

export async function recoverManager(
  input: EnsureServiceManagerInput,
  forceReplacement = false,
  deps = {
    lock: withManagerStartLock,
    read: readManagerHandoffDiscoveryStrict,
    inspect: inspectServiceManager,
    drain: drainKunOwnersForHandoffWithLock,
    ensure: ensureServiceManagerWithStartLockHeld
  }
): Promise<ServiceManagerConnection> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  return deps.lock(controlDir, async () => {
    const record = await deps.read(controlDir)
    if (record && (!sameCanonicalPath(record.dataDir, input.dataDir) ||
      (input.settingsPath && !sameCanonicalPath(record.settingsPath, input.settingsPath)))) {
      throw new Error('Service Manager recovery scope does not match the installed application.')
    }
    const result = await deps.inspect(controlDir, input.fetch ?? fetch, { attempts: 3 })
    logInfo('startup', 'Service Manager recovery probe completed.', result.state === 'unavailable'
      ? { state: result.state, kind: result.error.kind, pid: result.error.pid }
      : { state: result.state })
    if (result.state === 'ready' &&
      (!sameCanonicalPath(result.discovery.dataDir, input.dataDir) ||
        (input.settingsPath && !sameCanonicalPath(result.discovery.settingsPath, input.settingsPath)))) {
      throw new Error('Service Manager recovery scope does not match the installed application.')
    }
    if (result.state === 'ready' && !forceReplacement &&
      (!input.buildId || result.discovery.buildId === input.buildId)) {
      return { discovery: result.discovery }
    }
    // This coordinator proves both flavor slots and identities before replacing anything.
    // Unavailable authenticated status is deliberately NOT interpreted as empty slots.
    await deps.drain({
      reason: 'startup-retry', controlDir, dataDirs: [input.dataDir],
      settingsPath: input.settingsPath, fetch: input.fetch,
      onEvent: logKunHandoffEvent
    })
    return deps.ensure(input)
  })
}
