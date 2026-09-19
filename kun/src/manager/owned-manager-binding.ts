import { sameAppSessionOwner, type AppSessionOwner } from '../contracts/app-session-owner.js'
import { canonicalSessionPath } from './app-session-reservation.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { defaultKunControlDir } from './manager-discovery.js'
import { inspectServiceManager } from './manager-resolution.js'

/** Use the authenticated physical root for every Runtime store, retaining user
 * configured aliases only in settings. AtomicJson clients compare this boundary. */
export function bindRuntimeManagerDataPlane(
  options: { dataDir: string }, manager: ServiceManagerConnection,
  env: NodeJS.ProcessEnv = process.env
): void {
  options.dataDir = manager.discovery.dataDir
  env.KUN_MANAGER_BASE_URL = manager.discovery.baseUrl
  env.KUN_MANAGER_TOKEN = manager.discovery.managerToken
  env.KUN_MANAGER_INSTANCE_ID = manager.discovery.instanceId
  env.KUN_MANAGER_DATA_DIR = manager.discovery.dataDir
}

/** App-owned Runtime is a connection consumer, never a Manager election owner. */
export async function connectInjectedServiceManager(input: {
  owner: AppSessionOwner
  dataDir: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}): Promise<ServiceManagerConnection> {
  const env = input.env ?? process.env
  const inspected = await inspectServiceManager(env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir(), input.fetch ?? fetch)
  if (inspected.state === 'unavailable') throw inspected.error
  if (inspected.state !== 'ready') throw new Error('Application-owned Manager is unavailable; the owning application must recover it')
  const { discovery } = inspected
  if (!sameAppSessionOwner(discovery.appOwner, input.owner) ||
    discovery.baseUrl !== env.KUN_MANAGER_BASE_URL ||
    discovery.instanceId !== env.KUN_MANAGER_INSTANCE_ID ||
    discovery.managerToken !== env.KUN_MANAGER_TOKEN ||
    await canonicalSessionPath(discovery.dataDir) !== await canonicalSessionPath(input.dataDir)) {
    throw new Error('Application Manager session or generation does not match the injected binding')
  }
  return { discovery }
}
