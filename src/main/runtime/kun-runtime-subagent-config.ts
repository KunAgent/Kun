import type { KunSubagentsSettingsV1 } from '../../shared/app-settings'
import { SubagentsCapabilityConfig } from '../../../kun/src/contracts/capabilities.js'
import { appendManagedLogLine } from '../logger'

const VALID_PROFILE_REASONING = new Set(['auto', 'low', 'medium', 'high', 'max'])
const BUILTIN_SUBAGENT_PROFILE_IDS = new Set([
  'general',
  'explore',
  'component-designer',
  'design-reviewer',
  'over-engineering-reviewer'
])

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
    maxParallel: subagents.maxParallel && subagents.maxParallel > 0 ? subagents.maxParallel : 3,
    maxChildRuns: subagents.maxChildRuns && subagents.maxChildRuns > 0 ? subagents.maxChildRuns : 12,
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
    maxParallel: candidate.maxParallel,
    maxChildRuns: candidate.maxChildRuns,
    ...(subagents.defaultToolPolicy ? { defaultToolPolicy: subagents.defaultToolPolicy } : {})
  })
}

function stripBlankProfileFields(profile: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    next[key] = value
  }
  return next
}
