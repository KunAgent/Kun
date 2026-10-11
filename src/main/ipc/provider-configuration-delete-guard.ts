import type { AppSettingsV1 } from '../../shared/app-settings'
import { listModelProviderReferences } from '../../shared/app-settings-provider-references'
import { scanProviderReferences } from '../../../kun/src/services/provider-configuration-references'

type Request = { path: string; method?: string; body?: string }
type Response = { ok: boolean; status: number; body: string }
/** Main's settings remain authoritative for product-only pins, which the Runtime Registry cannot rewrite. */
export class ProviderConfigurationDeleteGuard {
  private readonly previews = new Map<string, { ids: string[]; clearedDefault: boolean; expiresAt: number }>()
  async run<T extends Response>(request: Request, load: () => Promise<AppSettingsV1>, send: () => Promise<T>): Promise<T> {
    const action = request.path.split('?')[0]
    const legacy = request.method === 'DELETE' && /^\/v1\/model-connections\/[^/]+$/.test(action)
    if (!legacy && (request.method !== 'POST' || !['/v1/provider-config/transactions/preview', '/v1/provider-config/transactions/commit'].includes(action))) return send()
    const body = JSON.parse(request.body ?? '{}') as { operations?: Array<{ kind?: string; connectionId?: string; selection?: { connectionId?: string } }>; previewId?: string }
    const reviewed = this.previews.get(body.previewId ?? '')
    if (!legacy && action.endsWith('/commit') && (!reviewed || reviewed.expiresAt <= Date.now())) throw new Error('The configuration preview is no longer verified by this app session; review the changes again')
    const ids = legacy ? [decodeURIComponent(action.slice('/v1/model-connections/'.length))] : action.endsWith('/preview') ? (body.operations ?? []).filter((entry) => entry.kind === 'remove-connection')
      .map((entry) => entry.connectionId).filter((id): id is string => typeof id === 'string')
      : this.previews.get(body.previewId ?? '')?.ids ?? []
    const clearedDefault = action.endsWith('/preview') ? (body.operations ?? []).some((entry) => entry.kind === 'set-default-selection' && !ids.includes(entry.selection?.connectionId ?? '')) : this.previews.get(body.previewId ?? '')?.clearedDefault ?? false
    if (ids.length) {
      const settings = await load()
      const extras = settings as unknown as Record<string, unknown>
      for (const id of ids) {
        const refs = listModelProviderReferences(settings, id).filter((reference) => !['routePool', 'failover'].includes(reference.kind) && !(reference.kind === 'chat' && clearedDefault))
        const external = scanProviderReferences({ harnesses: (settings.agents?.kun as unknown as Record<string, unknown>)?.harnesses,
          projects: extras.projects, projectDefaults: extras.projectDefaults, ade: (settings.agents?.kun as unknown as Record<string, unknown>)?.ade }, new Set([id]), 'product')
        if (refs.length || external.length) throw new Error(`Provider ${id} is used by ${[...refs.map((entry) => entry.detail ?? entry.kind), ...external.map((entry) => entry.path)].join(', ')}. Replace those bindings before deleting it.`)
      }
    }
    const response = await send()
    if (response.ok && action.endsWith('/preview')) {
      const preview = JSON.parse(response.body) as { previewId: string; expiresAt: string }
      for (const [key, value] of this.previews) if (value.expiresAt <= Date.now()) this.previews.delete(key)
      if (this.previews.size >= 128) this.previews.delete(this.previews.keys().next().value!)
      this.previews.set(preview.previewId, { ids, clearedDefault, expiresAt: Date.parse(preview.expiresAt) })
    }
    return response
  }
}
