import { ManagerRevisionedDocumentClient, type ServiceManagerConnection } from '../manager/manager-client.js'
/** Read the Manager-owned product settings on every destructive preview/commit; never trust a renderer projection. */
export async function providerProductReferenceSources(manager: ServiceManagerConnection | undefined): Promise<Record<string, unknown>> {
  if (!manager) return {}
  const snapshot = await new ManagerRevisionedDocumentClient(manager, 'settings').read()
  if (snapshot.value === null) return {}
  if (Buffer.byteLength(snapshot.value) > 16 * 1024 * 1024) throw new Error('Product settings exceed the safe provider reference scan limit')
  const value: unknown = JSON.parse(snapshot.value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Product settings cannot be inspected; provider deletion is blocked')
  const settings = value as Record<string, unknown>
  const agents = settings.agents as { kun?: Record<string, unknown> } | undefined
  const { providerId: _defaultProvider, ...kunServices } = agents?.kun ?? {}
  // Registry owns the root default, routePools and failover. Product-only model pins keep their own authority.
  return { productSettings: referenceFields({ kunServices, write: settings.write, design: settings.design, claw: settings.claw,
    schedule: settings.schedule, workflow: settings.workflow, projects: settings.projects, projectDefaults: settings.projectDefaults }) }
}

function referenceFields(value: unknown): unknown {
  let visited = 0
  const pick = (entry: unknown, key = ''): unknown => {
    if (++visited > 100_000) throw new Error('Product reference inventory exceeds its limit')
    if (typeof entry === 'string') return /(?:providerId|connectionId|allowedConnectionIds|connectionIds|summaryProviderId|smallModelProviderId|titleModelProviderId)$/.test(key) ? entry : undefined
    if (Array.isArray(entry)) return entry.map((item) => pick(item, key))
    if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).flatMap(([name, item]) => {
      const kept = pick(item, name)
      return kept === undefined ? [] : [[name, kept]]
    }))
    return undefined
  }
  return pick(value)
}
