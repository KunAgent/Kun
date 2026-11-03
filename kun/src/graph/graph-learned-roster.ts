import type { SubagentProfileConfig } from '../contracts/capabilities.js'
import type { GraphAgentProfileVersionV1 } from '../contracts/graph-agents.js'
import type { AgentRosterLearnedProfile } from '../delegation/agent-roster.js'
import type { ProjectAgentRegistry } from './project-agent-registry-types.js'

const CACHE_TTL_MS = 30_000
const MAX_CACHED_WORKSPACES = 64

/**
 * Trusted learned Graph profiles, offered read-only on the agent roster for the
 * workspace's project. Identity resolution runs git, and the roster is read on
 * every turn, so lookups are cached per workspace for a short window.
 */
export function createLearnedRosterProfiles(
  registry: Pick<ProjectAgentRegistry, 'identify' | 'listProfiles'>,
  now: () => number = Date.now
): (workspace: string) => Promise<readonly AgentRosterLearnedProfile[]> {
  const cache = new Map<string, { at: number; value: Promise<AgentRosterLearnedProfile[]> }>()
  return (workspace) => {
    const hit = cache.get(workspace)
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value
    const value = (async () => {
      const identity = await registry.identify(workspace)
      const profiles = await registry.listProfiles(identity.projectId)
      return profiles
        .filter((profile) => profile.origin === 'learned' && profile.lifecycle === 'trusted')
        .map(learnedRosterProfile)
    })().catch(() => [])
    cache.delete(workspace)
    cache.set(workspace, { at: now(), value })
    if (cache.size > MAX_CACHED_WORKSPACES) cache.delete(cache.keys().next().value!)
    return value
  }
}

/** A learned Graph profile in subagent-profile form; its capabilities stay least-authority. */
export function learnedRosterProfile(profile: GraphAgentProfileVersionV1): AgentRosterLearnedProfile {
  const caps = profile.capabilities
  const role: SubagentProfileConfig = {
    name: profile.name,
    ...(profile.description.trim() ? { description: profile.description.trim() } : {}),
    ...(profile.systemPrompt.trim() ? { systemPrompt: profile.systemPrompt.trim() } : {}),
    mode: 'subagent',
    surfaces: ['code'],
    model: profile.model,
    providerId: profile.providerId,
    reasoningEffort: profile.reasoningEffort,
    toolPolicy: caps.toolPolicy,
    ...(caps.allowedTools.length ? { allowedTools: [...caps.allowedTools] } : {}),
    ...(caps.blockedTools.length ? { blockedTools: [...caps.blockedTools] } : {}),
    ...(caps.blockedSkills.length ? { blockedSkills: [...caps.blockedSkills] } : {}),
    ...(caps.blockedMcpServers.length ? { blockedMcpServers: [...caps.blockedMcpServers] } : {})
  }
  return { id: profile.profileId, profile: role }
}
