import { PluginCatalogParams, PluginSetEnabledParams, PluginViewParams } from './contracts.js'
export { PluginCatalogParams, PluginSetEnabledParams, PluginViewParams } from './contracts.js'
import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import { checkEnablement, enablementProof, EnablementRejected, pluginRevision } from '../../extensions/enablement-control.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import type { ExtensionManifest } from '../../extensions/index.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { hasContributionPermission, selectExtension } from '../../server/routes/extension-public-common.js'
import { VIEW_CONTRIBUTION_KEYS } from '../../server/routes/extension-public-schemas.js'
import { requireRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
function declaredViews(manifest: ExtensionManifest, grantedPermissions: string[]) {
  return VIEW_CONTRIBUTION_KEYS.flatMap((point) => hasContributionPermission(point, grantedPermissions)
    ? manifest.contributes[point].map((view) => ({ id: view.id, title: view.title, location: point,
      mode: 'desktop_only' as const, available: false, reason: 'MOBILE_VIEW_NOT_DECLARED' as const })) : [])
}
/** Inert metadata only. No session/nonces, HTML, Host activation, account state or commands cross this adapter. */
export class RemotePlugins {
  constructor(private runtime: ServerRuntime) {}
  async catalog(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'extensions.read')
    const p = PluginCatalogParams.parse(raw), platform = this.runtime.extensionPlatform
    if (!platform) throw new Error('UNSUPPORTED_OPERATION')
    const registry = await platform.registry.read(), ids = Object.keys(registry.extensions).sort()
      .filter((id) => !p.cursor || id > p.cursor)
    const plugins = ids.slice(0, p.limit).map((id) => this.project(registry.extensions[id]!))
    const hasMore = ids.length > p.limit
    return { revision: registry.revision, plugins, hasMore, nextCursor: hasMore ? ids[p.limit - 1] : undefined }
  }
  private project(entry: import('../../extensions/types.js').ExtensionRegistryEntry) {
    const platform = this.runtime.extensionPlatform!, selected = selectExtension(platform, entry), manifest = selected?.selected.manifest
    const compatibility = manifest ? platform.packageManager.compatibilityReport(manifest) : undefined
    return { id: entry.id, name: manifest?.displayName ?? entry.id, description: manifest?.description ?? '',
      version: manifest?.version, enabled: selected?.enabled ?? false, globalEnabled: entry.globallyEnabled,
      hasWorkspaceOverrides: Object.keys(entry.workspaceEnablement).length > 0, revision: pluginRevision(entry),
      compatible: compatibility ? compatibility.api.compatible && compatibility.kunEngine.compatible &&
        compatibility.rpc.compatible && compatibility.diagnostics.every((item) => item.compatible) : false,
      views: manifest && selected?.enabled ? declaredViews(manifest, selected.grantedPermissions) : [], actions: [] }
  }
  async preflight(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'extensions.read'); requireRemoteScope(scope, 'extensions.control')
    const p = PluginSetEnabledParams.parse(raw), platform = this.runtime.extensionPlatform
    if (!platform) throw new RemoteNoEffect('NOT_FOUND')
    const entry = await platform.registry.get(p.pluginId)
    if (!entry) throw new RemoteNoEffect('NOT_FOUND')
    if (pluginRevision(entry) !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
  }
  async setEnabled(scope: RemoteAuthority, raw: unknown, requestId: string) {
    requireRemoteScope(scope, 'extensions.read'); requireRemoteScope(scope, 'extensions.control')
    const p = PluginSetEnabledParams.parse(raw), platform = this.runtime.extensionPlatform
    if (!platform) throw new RemoteNoEffect('NOT_FOUND')
    const control = { requestId: receiptKey(scope, requestId), fingerprint: createHash('sha256').update(canonical(p)).digest('hex'), expectedRevision: p.expectedRevision }
    try {
      checkEnablement(await platform.registry.get(p.pluginId), control, p.enabled)
      await platform.packageManager.setGlobalEnabled(p.pluginId, p.enabled, control)
    } catch (error) {
      if (error instanceof EnablementRejected && error.definitive) throw new RemoteNoEffect(error.code)
      throw error
    }
    return { plugin: this.project((await platform.registry.get(p.pluginId))!) }
  }
  async recover(scope: RemoteAuthority, receipt: Receipt) {
    requireRemoteScope(scope, 'extensions.read')
    const p = PluginSetEnabledParams.safeParse(receipt.params), platform = this.runtime.extensionPlatform
    if (!p.success || !platform) return undefined
    const entry = await platform.registry.get(p.data.pluginId)
    if (!entry) return undefined
    const control = { requestId: receiptKey(scope, receipt.requestId), fingerprint: createHash('sha256').update(canonical(p.data)).digest('hex'), expectedRevision: p.data.expectedRevision }
    if (!enablementProof(entry, control, p.data.enabled)) return undefined
    return { plugin: this.project(entry) }
  }
  async view(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'extensions.read')
    const p = PluginViewParams.parse(raw), platform = this.runtime.extensionPlatform
    if (!platform) throw new Error('UNSUPPORTED_OPERATION')
    const entry = await platform.registry.get(p.pluginId), selected = entry ? selectExtension(platform, entry) : undefined
    if (!selected?.enabled) throw new Error('NOT_FOUND')
    const views = declaredViews(selected.selected.manifest, selected.grantedPermissions)
    const view = views.find((item) => item.id === p.contributionId)
    if (!view) throw new Error('NOT_FOUND')
    return { pluginId: p.pluginId, pluginVersion: selected.selected.manifest.version, view, actions: [] }
  }
}
