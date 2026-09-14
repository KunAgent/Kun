import { z } from 'zod'
import { canonicalSessionPath } from '../manager/app-session-reservation.js'
import { defaultKunControlDir, defaultProductionSettingsPath, readManagerHandoffDiscoveryStrict, removeManagerDiscovery } from '../manager/manager-discovery.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { runtimeDataDir } from './shared-runtime-support.js'

/** Explicit operator command for old Managers that predate atomic idle retirement.
 * Automatic GUI startup must never invoke this compatibility shutdown path. */
export async function runManagerRetireCommand(argv: readonly string[], io: {
  stdout: { write(value: string): unknown }
  stderr: { write(value: string): unknown }
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}): Promise<number> {
  if (argv[0] !== 'retire') {
    io.stdout.write('kun manager retire [--data-dir <path>]\nRetire an idle legacy Manager after closing its clients. Application-owned Managers cannot be retired.\n')
    return argv[0] && argv[0] !== '--help' && argv[0] !== '-h' ? 64 : 0
  }
  const env = io.env ?? process.env
  const data = runtimeDataDir(argv.slice(1), env)
  if (!data.ok) { io.stderr.write(`kun manager: ${data.message}\n`); return 64 }
  const controlDir = env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  try {
    const discovery = await readManagerHandoffDiscoveryStrict(controlDir)
    if (!discovery) { io.stdout.write('No legacy Service Manager is running.\n'); return 0 }
    const settingsPath = env.KUN_MANAGER_SETTINGS_PATH?.trim() || defaultProductionSettingsPath()
    if (await canonicalSessionPath(discovery.dataDir) !== await canonicalSessionPath(data.dataDir) ||
      await canonicalSessionPath(discovery.settingsPath) !== await canonicalSessionPath(settingsPath)) {
      throw new Error('Manager data/settings profile differs; select its exact dataDir, controlDir and settingsPath before retiring it')
    }
    if (discovery.appOwner) throw new Error('Manager belongs to an application session; quit its owning application')
    if (!runtimeProcessIsAlive(discovery.pid, discovery)) {
      await removeManagerDiscovery(controlDir, discovery.instanceId, discovery)
      io.stdout.write('Legacy Manager has already exited.\n')
      return 0
    }
    const fetchImpl = io.fetch ?? fetch
    const identity = z.object({ instanceId: z.literal(discovery.instanceId), pid: z.literal(discovery.pid),
      startedAt: z.literal(discovery.startedAt), appOwner: z.unknown().optional(),
      ...(discovery.protocolVersion ? { protocolVersion: z.literal(discovery.protocolVersion) } : {}),
      ...(discovery.buildId ? { buildId: z.literal(discovery.buildId) } : {}) }).passthrough()
    const headers = { authorization: `Bearer ${discovery.managerToken}`, 'content-type': 'application/json' }
    const healthResponse = await fetchImpl(`${discovery.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
    if (!healthResponse.ok) throw new Error('Legacy Manager health cannot be authenticated')
    const health = identity.extend({ service: z.literal('kun-service-manager') }).parse(await healthResponse.json())
    const statusResponse = await fetchImpl(`${discovery.baseUrl}/v1/manager/status`, { headers, signal: AbortSignal.timeout(2_000) })
    if (!statusResponse.ok) throw new Error('Legacy Manager status cannot be authenticated')
    const status = identity.extend({ slots: z.array(z.unknown()) }).parse(await statusResponse.json())
    if (health.appOwner || status.appOwner || status.slots.length) {
      throw new Error('Manager has an application owner or Runtime slots; close its clients before retiring it')
    }
    const response = await fetchImpl(`${discovery.baseUrl}/v1/manager/shutdown`, {
      method: 'POST', headers, body: JSON.stringify({ instanceId: discovery.instanceId }), signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) throw new Error(`Legacy Manager refused shutdown (HTTP ${response.status})`)
    const deadline = Date.now() + 10_000
    while (runtimeProcessIsAlive(discovery.pid, discovery) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (runtimeProcessIsAlive(discovery.pid, discovery)) throw new Error('Legacy Manager did not exit; no force termination was attempted')
    await removeManagerDiscovery(controlDir, discovery.instanceId, discovery)
    io.stdout.write('Legacy Service Manager exited. Existing data is preserved.\n')
    return 0
  } catch (error) {
    io.stderr.write(`kun manager: ${error instanceof Error ? error.message : String(error)}\n`)
    return 70
  }
}
