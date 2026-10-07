import { AgentWiringError, AgentWiringService } from './service.js'
import { agentAdapter } from './adapters.js'
import { gatewayModelInfo, type AgentWiringAction, type AgentWiringOverview, type AgentWiringPreview, type AgentWiringResult } from './protocol.js'
import type { GatewayModelInfo } from './types.js'

export type RuntimeRequest = (path: string, method?: string, body?: string) => Promise<{ ok: boolean; status: number; body: string }>

/**
 * Main-owned glue between the Agents page, the runtime admin API and the
 * agent config editor. Each connected agent gets its own gateway client so
 * its usage is attributed and its access can be revoked independently; the
 * key goes straight from the runtime into the agent's config.
 */
export class AgentWiringBridge {
  /**
   * `deliverKey` hands a key to the user for agents that keep it outside their
   * config (Zed's keychain): the desktop app copies it to the clipboard, the
   * CLI prints it. It is never part of a result sent to the renderer.
   */
  constructor(private readonly runtimeRequest: RuntimeRequest, private readonly service = new AgentWiringService(),
    private readonly options: { deliverKey?: (key: string, agentName: string) => void } = {}) {}

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

  private served(catalog: GatewayModelInfo[], model: string, smallModel?: string): void {
    if (!catalog.some((entry) => entry.id === model)) throw new AgentWiringError(`'${model}' is not a model the gateway serves`, 'invalid_target')
    if (smallModel && !catalog.some((entry) => entry.id === smallModel)) throw new AgentWiringError(`'${smallModel}' is not a model the gateway serves`, 'invalid_target')
  }

  /** The diff a connection would make. No gateway client is created; the key is shown masked. */
  private preview(agentId: string, model: string, origin: string, catalog: GatewayModelInfo[], smallModel?: string, effort?: string): AgentWiringPreview {
    this.served(catalog, model, smallModel)
    const mask = `kun-${agentId}.********`
    const key = this.service.currentKey(agentId, origin) ?? mask
    const files = this.service.preview(agentId, { origin, key, model, ...(smallModel ? { smallModel } : {}), ...(effort ? { effort } : {}), models: catalog }, mask)
    return { agentId, files, restartRequired: agentAdapter(agentId)?.restartRequired === true }
  }

  /** Connects; returns true when a new key was handed to the user to paste into the agent. */
  private async connect(agentId: string, model: string, origin: string, catalog: GatewayModelInfo[], smallModel?: string, effort?: string): Promise<boolean> {
    this.served(catalog, model, smallModel)
    const adapter = agentAdapter(agentId)
    // Agents that keep their own list may switch to any listed model, so their key may use every model.
    const allowed = adapter?.keepsModelList ? [model, ...catalog.map((entry) => entry.id).filter((id) => id !== model)]
      : [...new Set([model, ...(smallModel ? [smallModel] : [])])]
    const record = this.service.connectedRecord(agentId)
    if (adapter?.keyDelivery === 'clipboard') {
      if (!this.options.deliverKey) throw new AgentWiringError(`${adapter.name} needs its key pasted by hand, which this client cannot hand over`, 'invalid_target')
      // The user already pasted this agent's key; switching models keeps it.
      if (record?.clientId) {
        await this.json(`/v1/model-gateway/clients/${encodeURIComponent(record.clientId)}/allow`, 'POST', { modelIds: allowed })
        this.service.connect(agentId, { origin, key: '', model, ...(effort ? { effort } : {}), models: catalog }, record.clientId)
        return false
      }
    }
    const { key, clientId } = await this.agentKey(agentId, origin, allowed)
    this.service.connect(agentId, { origin, key: adapter?.keyDelivery === 'clipboard' ? '' : key, model,
      ...(smallModel ? { smallModel } : {}), ...(effort ? { effort } : {}), models: catalog }, clientId)
    if (adapter?.keyDelivery !== 'clipboard') return false
    this.options.deliverKey!(key, adapter.name)
    return true
  }

  /** Replaces a clipboard agent's key (Kun never keeps it) and hands the new one over. */
  private async copyKey(agentId: string): Promise<void> {
    const adapter = agentAdapter(agentId)
    const record = this.service.connectedRecord(agentId)
    if (!adapter || adapter.keyDelivery !== 'clipboard') throw new AgentWiringError(`${adapter?.name ?? agentId} reads its key from its own config`, 'invalid_target')
    if (!record?.clientId) throw new AgentWiringError(`${adapter.name} is not connected to Kun`, 'not_connected')
    if (!this.options.deliverKey) throw new AgentWiringError(`${adapter.name} needs its key pasted by hand, which this client cannot hand over`, 'invalid_target')
    const rotated = await this.json(`/v1/model-gateway/clients/${encodeURIComponent(record.clientId)}/rotate`, 'POST')
    if (typeof rotated.key !== 'string') throw new AgentWiringError('The runtime returned no client key', 'invalid_target')
    this.options.deliverKey(`kun-${agentId}.${rotated.key}`, adapter.name)
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
      if (action.action === 'preview') {
        const preview = this.preview(action.agentId, action.model, origin, catalog, action.smallModel, action.effort)
        return { ok: true, preview, ...await this.overview() }
      }
      if (action.action === 'connect') {
        const copied = await this.connect(action.agentId, action.model, origin, catalog, action.smallModel, action.effort)
        const restart = agentAdapter(action.agentId)?.restartRequired
        return { ok: true, ...(copied ? { notice: 'key-copied' } : restart ? { notice: 'restart' } : {}), ...await this.overview() }
      }
      if (action.action === 'copy-key') {
        await this.copyKey(action.agentId)
        return { ok: true, notice: 'key-copied', ...await this.overview() }
      }
      const profile = this.service.profile(action.name)
      const applied: string[] = []
      const failed: { agentId: string; error: string }[] = []
      let copied = false
      for (const [agentId, selection] of Object.entries(profile)) {
        try {
          copied = await this.connect(agentId, selection.model, origin, catalog, selection.smallModel, selection.effort) || copied
          applied.push(agentId)
        } catch (error) { failed.push({ agentId, error: error instanceof Error ? error.message : String(error) }) }
      }
      return { ok: true, applied, failed, ...(copied ? { notice: 'key-copied' } : {}), ...await this.overview() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error),
        ...(error instanceof AgentWiringError ? { code: error.code, ...(error.file ? { file: error.file } : {}) } : {}) }
    }
  }
}
