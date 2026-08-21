import type { KunSubagentsSettingsV1 } from '../../shared/app-settings'
import { SubagentsCapabilityConfig } from '../../../kun/src/contracts/capabilities.js'
import { appendManagedLogLine } from '../logger'
import { BUILTIN_AGENT_CATALOG } from '../../../kun/src/delegation/builtin-agent-catalog.js'

const VALID_PROFILE_REASONING = new Set(['auto', 'low', 'medium', 'high', 'max'])
const BUILTIN_SUBAGENT_PROFILE_IDS = new Set<string>(BUILTIN_AGENT_CATALOG.map((agent) => agent.id))

export function subagentProfilesForRuntime(
  subagents: KunSubagentsSettingsV1
): SubagentsCapabilityConfig {
  const profiles: Record<string, unknown> = {}
  for (const profile of subagents.profiles) {
    // Kun installs first-party profiles at composition time, so omitting a
    // disabled builtin only adds the default profile back and silently loses
    // the user's model/prompt/permission overrides. Older GUI versions exposed
    // that ineffective toggle. Treat its stored false as a legacy no-op while
    // continuing to exclude genuinely disabled custom profiles.
    if (!profile.enabled && !BUILTIN_SUBAGENT_PROFILE_IDS.has(profile.id)) continue
    const { id: _id, enabled: _enabled, name, reasoningEffort, ...rest } = profile
    const effort = typeof reasoningEffort === 'string' && VALID_PROFILE_REASONING.has(reasoningEffort)
      ? { reasoningEffort }
      : {}
    profiles[profile.id] = stripBlankProfileFields({ name, ...rest, ...effort })
  }
  const candidate = {
    enabled: subagents.enabled !== false,
    useExistingAgents: subagents.useExistingAgents !== false,
    maxParallel: validMaxParallel(subagents.maxParallel) ? subagents.maxParallel : 256,
    proactiveRetry: {
      enabled: subagents.proactiveRetry?.enabled !== false,
      maxAttempts: validProactiveRetryAttempts(subagents.proactiveRetry?.maxAttempts)
        ? subagents.proactiveRetry.maxAttempts
        : 3
    },
    ...(subagents.defaultToolPolicy ? { defaultToolPolicy: subagents.defaultToolPolicy } : {}),
    ...(subagents.defaultProfile ? { defaultProfile: subagents.defaultProfile } : {}),
    profiles
  }
  const parsed = SubagentsCapabilityConfig.safeParse(candidate)
  if (parsed.success) return parsed.data
  void appendManagedLogLine(
    'kun',
    `[${new Date().toISOString()}] [LIFECYCLE] [kun] [settings] dropped invalid subagent profiles: ${
      JSON.stringify(parsed.error.issues)
    }\n`
  )
  return SubagentsCapabilityConfig.parse({
    enabled: candidate.enabled,
    useExistingAgents: candidate.useExistingAgents,
    maxParallel: candidate.maxParallel,
    proactiveRetry: candidate.proactiveRetry,
    ...(subagents.defaultToolPolicy ? { defaultToolPolicy: subagents.defaultToolPolicy } : {})
  })
}

function validProactiveRetryAttempts(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3
}

function validMaxParallel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 256
}

function stripBlankProfileFields(profile: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value === 'string' && value.trim() === '') continue
    // An explicit empty surface list disables routing for this profile. Other
    // empty deny/allow lists retain their historical "inherit" semantics.
    if (Array.isArray(value) && value.length === 0 && key !== 'surfaces') continue
    if (key === 'surfaces' && Array.isArray(value)) {
      const surfaces = [...new Set(value.filter((entry) =>
        entry === 'shared' || entry === 'code' || entry === 'write' || entry === 'design'
      ))]
      next[key] = surfaces.includes('shared') ? ['shared'] : surfaces
      continue
    }
    next[key] = value
  }
  const hasModel = typeof next.model === 'string' && next.model.trim().length > 0
  const hasProviderId =
    typeof next.providerId === 'string' && next.providerId.trim().length > 0
  if (hasModel !== hasProviderId) {
    // Legacy settings allowed either field independently. Drop the ambiguous
    // override as a pair so the profile stays valid and inherits the active
    // session's coherent model/provider selection.
    delete next.model
    delete next.providerId
  }
  return next
}
