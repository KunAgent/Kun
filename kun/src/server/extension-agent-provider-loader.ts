import { hasPermission } from '@kun/extension-api'
import type { ExtensionRegistry } from '../extensions/registry.js'
import type { ExtensionPackageManager } from '../extensions/package-manager.js'
import { extensionAgentProvider, type ExtensionAgentProvider } from '../harness/extension-agent-providers.js'

/**
 * Agents declared by installed extensions (docs/ade/17 §4.5). Only the
 * selected version of a globally enabled, admitted extension whose granted
 * permissions include `agents.register` contributes; Agents are machine-wide,
 * so workspace-scoped grants never add one.
 */
export async function loadExtensionAgentProviders(platform: {
  registry: Pick<ExtensionRegistry, 'read'>
  packageManager: Pick<ExtensionPackageManager, 'admitManifest'>
}): Promise<ExtensionAgentProvider[]> {
  const registry = await platform.registry.read()
  const providers: ExtensionAgentProvider[] = []
  for (const entry of Object.values(registry.extensions).sort((left, right) => left.id.localeCompare(right.id))) {
    const selected = entry.useDevelopment
      ? entry.development
      : entry.selectedVersion ? entry.versions[entry.selectedVersion] : undefined
    const manifest = selected?.manifest
    // A manifest parsed by an older contract has no agentProviders key at all.
    const declared = manifest?.contributes.agentProviders ?? []
    if (!selected || !manifest || !entry.globallyEnabled || !declared.length) continue
    if (!hasPermission(selected.grantedPermissions, 'agents.register')) continue
    try {
      platform.packageManager.admitManifest(manifest)
    } catch {
      continue
    }
    for (const declaration of declared) {
      providers.push(extensionAgentProvider({ id: entry.id, name: manifest.displayName ?? manifest.name }, declaration))
    }
  }
  return providers
}
