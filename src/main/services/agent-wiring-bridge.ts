import { AgentWiringError, AgentWiringService } from '../../../kun/src/agent-wiring/service.js'
import { agentAdapter } from '../../../kun/src/agent-wiring/adapters.js'
import { gatewayModelInfo, type AgentWiringAction, type AgentWiringOverview, type AgentWiringResult } from '../../shared/agent-wiring'
import type { GatewayModelInfo } from '../../../kun/src/agent-wiring/types.js'

type RuntimeRequest = (path: string, method?: string, body?: string) => Promise<{ ok: boolean; status: number; body: string }>

/**
 * Main-owned glue between the Agents page, the runtime admin API and the
 * agent config editor. Each connected agent gets its own gateway client so
 * its usage is attributed and its access can be revoked independently; the
 * key goes straight from the runtime into the agent's config.
 */
export class AgentWiringBridge {
  constructor(private readonly runtimeRequest: RuntimeRequest, private readonly service = new AgentWiringService()) {}

  private async json(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const response = await this.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(response.body) as Record<string, unknown> } catch { /* keep empty */ }
    if (!response.ok) {
      const message = typeof parsed.message === 'string' ? parsed.message : `Kun runtime request failed (HTTP ${response.status})`
      throw new AgentWiringError(message, 'invalid_target')
    }
    return parsed
  }

  private async origin(): Promise<{ origin: string; enabled: boolean }> {
    const hello = await this.json('/api/hello')
    const gateway = (hello.gateway ?? {}) as { anthropic?: unknown; enabled?: unknown }
    if (typeof gateway.anthropic !== 'string') throw new AgentWiringError('The Kun runtime did not report its gateway address', 'invalid_target')
    return { origin: gateway.anthropic, enabled: gateway.enabled === true }
  }

  private async catalog(): Promise<GatewayModelInfo[]> {
    const catalog = await this.json('/v1/model-gateway/catalog')
    return (Array.isArray(catalog.data) ? catalog.data : [])
      .map((row) => gatewayModelInfo(row as Record<string, unknown>)).filter((row): row is GatewayModelInfo => Boolean(row))
  }

  async overview(): Promise<AgentWiringOverview> {
    const { origin, enabled } = await this.origin()
    const models = enabled ? await this.catalog().catch(() => []) : []
    return { origin, gatewayEnabled: enabled, agents: this.service.list(origin), models, profiles: this.service.listProfiles() }
  }

  /** Issues (or widens) the agent's own gateway client and returns the key as the agent should send it. */
  private async agentKey(agentId: string, origin: string, models: string[]): Promise<{ key: string; clientId: string }> {
    const record = this.service.connectedRecord(agentId)
    const existing = this.service.currentKey(agentId, origin)
    if (record?.clientId && existing) {
      await this.json(`/v1/model-gateway/clients/${encodeURIComponent(record.clientId)}/allow`, 'POST', { modelIds: models })
      return { key: existing, clientId: record.clientId }
    }
    const name = `Agent · ${agentAdapter(agentId)?.name ?? agentId}`
    const created = await this.json('/v1/model-gateway/clients', 'POST', { name, modelId: models[0] })
    const client = created.client as { clientId?: unknown } | undefined
    if (typeof created.key !== 'string' || typeof client?.clientId !== 'string') throw new AgentWiringError('The runtime returned no client key', 'invalid_target')
    if (models.length > 1) await this.json(`/v1/model-gateway/clients/${encodeURIComponent(client.clientId)}/allow`, 'POST', { modelIds: models.slice(1) })
    return { key: `kun-${agentId}.${created.key}`, clientId: client.clientId }
  }

  private async connect(agentId: string, model: string, origin: string, catalog: GatewayModelInfo[], smallModel?: string, effort?: string): Promise<void> {
    if (!catalog.some((entry) => entry.id === model)) throw new AgentWiringError(`'${model}' is not a model the gateway serves`, 'invalid_target')
    if (smallModel && !catalog.some((entry) => entry.id === smallModel)) throw new AgentWiringError(`'${smallModel}' is not a model the gateway serves`, 'invalid_target')
    const adapter = agentAdapter(agentId)
    // Agents that keep their own list may switch to any listed model, so their key may use every model.
    const allowed = adapter?.keepsModelList ? [model, ...catalog.map((entry) => entry.id).filter((id) => id !== model)]
      : [...new Set([model, ...(smallModel ? [smallModel] : [])])]
    const { key, clientId } = await this.agentKey(agentId, origin, allowed)
    this.service.connect(agentId, { origin, key, model, ...(smallModel ? { smallModel } : {}), ...(effort ? { effort } : {}), models: catalog }, clientId)
  }

  async handle(action: AgentWiringAction): Promise<AgentWiringResult> {
    try {
      if (action.action === 'list') return { ok: true, ...await this.overview() }
      const { origin, enabled } = await this.origin()
      if (action.action === 'disconnect') {
        const { clientId } = this.service.disconnect(action.agentId, origin)
        if (clientId) await this.json(`/v1/model-gateway/clients/${encodeURIComponent(clientId)}`, 'DELETE').catch(() => undefined)
        return { ok: true, ...await this.overview() }
      }
      if (action.action === 'delete-profile') {
        this.service.deleteProfile(action.name)
        return { ok: true, ...await this.overview() }
      }
      if (action.action === 'save-profile') {
        this.service.saveProfile(action.name)
        return { ok: true, ...await this.overview() }
      }
      if (!enabled) throw new AgentWiringError('Turn on the local model gateway first', 'invalid_target')
      const catalog = await this.catalog()
      if (action.action === 'sync') {
        const applied = this.service.syncCatalog(catalog, origin)
        return { ok: true, applied, ...await this.overview() }
      }
      if (action.action === 'connect') {
        await this.connect(action.agentId, action.model, origin, catalog, action.smallModel, action.effort)
        const restart = agentAdapter(action.agentId)?.restartRequired
        return { ok: true, ...(restart ? { notice: 'restart' } : {}), ...await this.overview() }
      }
      const profile = this.service.profile(action.name)
      const applied: string[] = []
      const failed: { agentId: string; error: string }[] = []
      for (const [agentId, selection] of Object.entries(profile)) {
        try {
          await this.connect(agentId, selection.model, origin, catalog, selection.smallModel, selection.effort)
          applied.push(agentId)
        } catch (error) { failed.push({ agentId, error: error instanceof Error ? error.message : String(error) }) }
      }
      return { ok: true, applied, failed, ...await this.overview() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error),
        ...(error instanceof AgentWiringError ? { code: error.code } : {}) }
    }
  }
}
