import { clipboard, ipcMain } from 'electron'
import type { GatewayClientCredential, GatewayClientResult, GatewayClientUsage } from '../../shared/gateway-clients'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from './app-ipc-handler-utils'

function clientMetadata(value: unknown): GatewayClientCredential | undefined {
  if (!value || typeof value !== 'object') return undefined
  const client = value as Record<string, unknown>
  if (typeof client.clientId !== 'string' || typeof client.name !== 'string' || typeof client.createdAt !== 'string') return undefined
  return { clientId: client.clientId, name: client.name, createdAt: client.createdAt,
    ...(client.scopeMode === 'scoped' || client.scopeMode === 'legacy-unrestricted' ? { scopeMode: client.scopeMode } : {}),
    ...(typeof client.rotatedAt === 'string' ? { rotatedAt: client.rotatedAt } : {}),
    ...(typeof client.revokedAt === 'string' ? { revokedAt: client.revokedAt } : {}) }
}

/** Independent desktop-only bridge: one-time client keys never enter renderer state or logs. */
export function registerGatewayClientsIpc(options: Pick<RegisterAppIpcHandlersOptions,
  'getMainWindow' | 'assertRendererRuntimeReady' | 'runtimeRequest'>): void {
  ipcMain.handle('gateway:clients', async (event, input: unknown): Promise<GatewayClientResult> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    options.assertRendererRuntimeReady()
    if (!input || typeof input !== 'object') throw new Error('Invalid gateway client action')
    const request = input as Record<string, unknown>
    let path = '/v1/model-gateway/clients'
    let method = 'GET'
    let body: string | undefined
    if (request.action === 'create') {
      if (typeof request.name !== 'string' || !request.name.trim() || request.name.trim().length > 80 || [...request.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
        throw new Error('Enter a gateway client name (1-80 characters)')
      }
      method = 'POST'
      if (request.modelId !== undefined && (typeof request.modelId !== 'string' || !request.modelId.trim() || request.modelId.length > 512)) {
        throw new Error('Invalid public model alias')
      }
      body = JSON.stringify({ name: request.name.trim(), ...(request.modelId ? { modelId: request.modelId } : {}) })
    } else if (request.action === 'revoke' || request.action === 'usage' || request.action === 'rotate') {
      if (typeof request.clientId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.clientId)) throw new Error('Invalid gateway client ID')
      path += `/${encodeURIComponent(request.clientId)}`
      if (request.action === 'usage') path += '/usage'
      else if (request.action === 'rotate') { path += '/rotate'; method = 'POST'; body = '{}' }
      else {
        if (request.cancelActive !== undefined && typeof request.cancelActive !== 'boolean') throw new Error('Invalid cancellation option')
        method = 'DELETE'
        if (request.cancelActive === true) path += '?cancel_active=true'
      }
    } else if (request.action !== 'list') throw new Error('Invalid gateway client action')
    const response = await options.runtimeRequest(path, method, body)
    if (!response.ok) return { ok: false, status: response.status, error: `Gateway client action failed (HTTP ${response.status})` }
    const parsed = JSON.parse(response.body) as Record<string, unknown>
    if (request.action === 'create' || request.action === 'rotate') {
      const client = clientMetadata(parsed.client)
      if (!client || typeof parsed.key !== 'string' || !parsed.key) return { ok: false, status: 502, error: 'Gateway returned an invalid client credential' }
      try { clipboard.writeText(parsed.key) } catch {
        // The key is intentionally unrecoverable. Expose the ID so the user can revoke and retry.
        return { ok: true, status: response.status, client, copied: false, error: 'Client created, but its key could not be copied. Revoke it and create a new one.' }
      }
      return { ok: true, status: response.status, client, copied: true }
    }
    if (request.action === 'usage') return { ok: true, status: response.status, usage: usageMetadata(parsed, String(request.clientId)) }
    if (request.action === 'revoke') return { ok: true, status: response.status, revoked: parsed.revoked === true }
    return { ok: true, status: response.status,
      clients: Array.isArray(parsed.clients) ? parsed.clients.map(clientMetadata).filter((client): client is GatewayClientCredential => Boolean(client)) : [] }
  })
}

function usageMetadata(value: Record<string, unknown>, clientId: string): GatewayClientUsage {
  const record = (item: unknown): Record<string, unknown> => item && typeof item === 'object' ? item as Record<string, unknown> : {}
  const number = (item: unknown): number | undefined => typeof item === 'number' && Number.isFinite(item) && item >= 0 ? item : undefined
  const string = (item: unknown): string | undefined => typeof item === 'string' ? item : undefined
  const total = record(value.usage)
  const windows = record(value.budget).windows
  const active = Array.isArray(windows) ? windows.map(record).find((window) => window.active === true) : undefined
  return { clientId, ...(active ? { budget: { measured: number(active.measured) ?? 0,
      reserved: number(active.reserved) ?? 0, limit: number(active.limit), endsAt: number(active.endsAt) ?? 0 } } : {}), totalRequests: number(total.turns) ?? 0, totalTokens: number(total.totalTokens) ?? 0,
    ...(active?.costAlert ? { costEstimate: { usd: number(record(active.costAlert).usd) ?? 0,
      limitUsd: number(record(active.costAlert).limitUsd) ?? 0,
      unknownAttempts: number(record(active.costAlert).unknownAttempts) ?? 0, exceeded: record(active.costAlert).exceeded === true } } : {}),
    requests: (Array.isArray(value.requests) ? value.requests : []).slice(-100).map((item) => {
      const entry = record(item); const usage = record(entry.usage); const gateway = record(usage.gateway)
      return { timestamp: string(entry.timestamp) ?? '', requestedModelId: string(usage.requestedModelId),
        actualProviderId: string(usage.actualProviderId), actualModelId: string(usage.actualModelId),
        sessionId: string(gateway.sessionId), status: string(gateway.status), latencyMs: number(gateway.latencyMs),
        retryCount: number(gateway.retryCount), failoverCount: number(gateway.failoverCount),
        promptTokens: number(usage.promptTokens), completionTokens: number(usage.completionTokens),
        cacheHitTokens: number(usage.cacheHitTokens), tokenUsage: string(gateway.tokenUsage) }
    }) }
}
