import type {
  SubagentMode,
  SubagentProfileConfig,
  SubagentToolPolicy
} from '../contracts/capabilities.js'
import {
  applyWorkspaceAgentSurfaceFallback,
  loadWorkspaceAgentCatalogProfiles,
  loadWorkspaceAgentProfiles,
  type WorkspaceAgentCatalogProfile
} from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { profileAvailableOnSurface } from './delegation-runtime-contracts.js'

export type SubagentProfileSurface = 'code' | 'write' | 'design'
export type SubagentProfileSource = 'builtin' | 'configured' | 'workspace'

export type SubagentProfileSnapshot = {
  id: string
  source: SubagentProfileSource
  profile: SubagentProfileConfig
}

export type ConfiguredSubagentProfileSummary = {
  name: string
  mode: SubagentMode
  toolPolicy: SubagentToolPolicy
  model?: string
  providerId?: string
  description?: string
}

/** Configured profiles, surfaced to the delegate_task tool schema/UI. */
export function listConfiguredSubagentProfiles(
  profiles: Readonly<Record<string, SubagentProfileConfig>>
): ConfiguredSubagentProfileSummary[] {
  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    mode: profile.mode,
    toolPolicy: profile.toolPolicy,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.providerId ? { providerId: profile.providerId } : {}),
    ...(profile.description ? { description: profile.description } : {})
  }))
}

/**
 * Workspace `.kun/agents/*.md` overlays for the GUI roster.
 * Returned separately from the configured list so Settings/Sidebar can merge
 * them without rewriting persistent GUI settings.
 */
export function listWorkspaceSubagentProfiles(
  workspace: string,
  profiles: Readonly<Record<string, SubagentProfileConfig>>
): Promise<WorkspaceAgentCatalogProfile[]> {
  return loadWorkspaceAgentCatalogProfiles(workspace, profiles)
}

/** Resolve one explicit profile once so routing and execution share a snapshot. */
export async function resolveSubagentProfileSnapshot(
  profiles: Readonly<Record<string, SubagentProfileConfig>>,
  profileId: string,
  workspace?: string,
  agentSurface: SubagentProfileSurface = 'code'
): Promise<SubagentProfileSnapshot | undefined> {
  const id = profileId.trim()
  if (!id) return undefined
  if (workspace) {
    const hit = (await loadWorkspaceAgentProfiles(workspace)).find((entry) => entry.id === id)
    if (hit) {
      const profile = applyWorkspaceAgentSurfaceFallback(hit, profiles[id])
      return profileAvailableOnSurface(profile, agentSurface)
        ? { id, source: 'workspace', profile }
        : undefined
    }
  }
  if (!Object.prototype.hasOwnProperty.call(profiles, id)) return undefined
  const profile = profiles[id]
  if (!profile) return undefined
  if (!profileAvailableOnSurface(profile, agentSurface)) return undefined
  return { id, source: configuredProfileSource(id, profile), profile }
}

/** Profiles visible to automatic routing, including workspace overlays. */
export async function listRoutingSubagentProfiles(
  configured: Readonly<Record<string, SubagentProfileConfig>>,
  workspace?: string,
  agentSurface: SubagentProfileSurface = 'code'
): Promise<SubagentRoutingDocument[]> {
  const profiles = new Map<string, SubagentProfileConfig>(Object.entries(configured))
  const sources = new Map<string, SubagentProfileSource>(
    Object.entries(configured).map(([id, profile]) => [id, configuredProfileSource(id, profile)])
  )
  if (workspace) {
    const overlay = await loadWorkspaceAgentProfiles(workspace)
    for (const entry of overlay) {
      profiles.set(entry.id, applyWorkspaceAgentSurfaceFallback(entry, configured[entry.id]))
      sources.set(entry.id, 'workspace')
    }
  }
  return [...profiles.entries()]
    .filter(([, profile]) => profile.mode !== 'primary' && profileAvailableOnSurface(profile, agentSurface))
    .map(([id, profile]) => ({
      kind: 'profile' as const,
      id,
      source: sources.get(id) ?? 'configured',
      profile,
      ...(BUILTIN_AGENT_CATALOG_BY_ID[id]?.routingTerms
        ? { routingTerms: BUILTIN_AGENT_CATALOG_BY_ID[id]!.routingTerms }
        : {})
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function configuredProfileSource(id: string, profile: SubagentProfileConfig): SubagentProfileSource {
  return BUILTIN_SUBAGENT_PROFILES[id] === profile ? 'builtin' : 'configured'
}
