import type { HarnessRoute } from '../../contracts/harness.js'
import { rosterRefusal, type AgentRosterExclusion } from '../../delegation/agent-roster.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { SubagentRoutingDocument } from '../../delegation/subagent-router.js'
import type { InlineProfile } from './delegation-tool-results.js'

type Surface = 'code' | 'write' | 'design'
type Parent = { model?: string; providerId?: string }

/**
 * delegate_task's view of the agent roster. Without a roster (tests, partial
 * hosts) every helper falls back to the plain profile catalog and binds no
 * engine, which is exactly the behavior before the roster existed.
 */
export async function explicitDelegateProfile(
  runtime: DelegationRuntime,
  requested: string,
  input: { workspace: string; surface: Surface; parent: Parent }
): Promise<{ inlineProfile: InlineProfile; route?: HarnessRoute } | { error: string }> {
  const roster = runtime.roster
  if (!roster) {
    const snapshot = await runtime.resolveProfileSnapshot(requested, input.workspace, input.surface)
    return snapshot
      ? { inlineProfile: { id: snapshot.id, profile: snapshot.profile, source: snapshot.source } }
      : { error: `unknown or unavailable ${input.surface} subagent profile: ${requested}` }
  }
  const resolution = await roster.resolve(requested, { lane: 'delegate', ...input })
  if (!resolution.ok) {
    return {
      error: `${rosterRefusal(requested, 'delegate', resolution)}. ` +
        'Choose another profile from list_subagent_profiles, or omit profile for automatic routing.'
    }
  }
  return {
    inlineProfile: {
      id: resolution.id,
      profile: resolution.profile,
      source: resolution.source === 'learned' ? 'configured' : resolution.source
    },
    ...(resolution.route ? { route: resolution.route } : {})
  }
}

/** Automatic-routing candidates: roles this lane cannot run are left out and named. */
export async function delegateRoutingCandidates(
  runtime: DelegationRuntime,
  input: { workspace: string; surface: Surface; parent: Parent }
): Promise<{ documents: SubagentRoutingDocument[]; excluded: AgentRosterExclusion[] }> {
  const roster = runtime.roster
  if (!roster) {
    return { documents: await runtime.listRoutingProfiles(input.workspace, input.surface), excluded: [] }
  }
  return roster.routingDocuments({ lane: 'delegate', ...input })
}

/**
 * The engine an automatically routed role runs on. Readiness is probed now;
 * a role whose engine fails the probe is reported so the caller can fall back
 * to the default role instead of re-homing this one onto the main route.
 */
export async function delegateEngineFor(
  runtime: DelegationRuntime,
  profileId: string,
  input: { workspace: string; surface: Surface; parent: Parent }
): Promise<{ route?: HarnessRoute } | { error: string }> {
  const roster = runtime.roster
  if (!roster) return {}
  const resolution = await roster.resolve(profileId, { lane: 'delegate', ...input })
  if (!resolution.ok) return { error: `${profileId} (${resolution.code})` }
  return resolution.route ? { route: resolution.route } : {}
}

export function exclusionNote(excluded: readonly AgentRosterExclusion[]): string {
  if (!excluded.length) return ''
  const listed = excluded.slice(0, 8).map((entry) => `${entry.id} (${entry.code})`).join(', ')
  const more = excluded.length > 8 ? ` and ${excluded.length - 8} more` : ''
  return ` Not available to delegate_task right now: ${listed}${more}.`
}
