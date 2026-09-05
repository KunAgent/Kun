import { app } from 'electron'
import { defaultKunControlDir } from '../../../kun/src/manager/manager-discovery.js'
import { resolveCliRuntimeFlavor } from '../../../kun/src/cli/runtime-flavor.js'
import {
  resolveKunExecutable,
  resolveKunRuntimeBuildId
} from '../resolve-kun-binary'
import {
  drainKunOwnersForHandoff,
  installedBuildProbeError,
  probeInstalledBuildHandoff,
  KunHandoffError
} from './kun-installed-build-handoff'
import {
  createHandoffEventReporter,
  type HandoffEventListener
} from './kun-handoff-events'
import {
  recordHandoffBlocked,
  type HandoffOwnerHint
} from './kun-handoff-blocked-state'
import { handoffCleanupOverrides } from './kun-handoff-cleanup'

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export async function preparePackagedKunBuildHandoff(input: {
  dataDir: string
  settingsPath: string
  onHandoffEvent?: HandoffEventListener
}): Promise<boolean> {
  const flavor = resolveCliRuntimeFlavor({ env: process.env })
  if (!app.isPackaged || flavor !== 'production') return false
  const buildId = await resolveKunRuntimeBuildId(resolveKunExecutable(appRoot(), ''))
  const handoffInput = {
    reason: 'installed-build-change' as const,
    dataDirs: [input.dataDir],
    settingsPath: input.settingsPath,
    controlDir: defaultKunControlDir(),
    onEvent: createHandoffEventReporter(input.onHandoffEvent),
    ...(buildId ? { targetBuildId: buildId } : {})
  }
  const cleanupOverrides = handoffCleanupOverrides(app.getPath('userData'))
  const probe = await probeInstalledBuildHandoff(handoffInput, cleanupOverrides)
  const probeError = installedBuildProbeError(handoffInput, probe)
  if (probeError) throw probeError
  if (probe === 'matched') return false
  await drainKunOwnersForHandoff(handoffInput, cleanupOverrides)
  return true
}

/**
 * Persist one fail-closed handoff probe so a later launch can recognize the
 * repeated unknown-identity condition and stop auto-probing. Never rethrown:
 * the blocking error already propagates to the startup recovery page.
 */
export async function recordHandoffBlockedIfUnverifiable(
  error: unknown,
  reason: string
): Promise<void> {
  if (!(error instanceof KunHandoffError) || error.code !== 'identity_unverifiable') return
  const ownerHints: HandoffOwnerHint[] = error.owner
    ? [{
        kind: error.owner.kind,
        ...(error.owner.flavor ? { flavor: error.owner.flavor } : {}),
        ...(error.owner.pid !== undefined ? { pid: error.owner.pid } : {}),
        ...(error.owner.port !== undefined ? { port: error.owner.port } : {})
      }]
    : []
  await recordHandoffBlocked(
    {
      lastError: error.message,
      ownerHints,
      reason
    },
    app.getPath('userData')
  ).catch(() => undefined)
}
