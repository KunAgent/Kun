import type { AgentRosterEntry } from '../contracts/agent-roster.js'
import type { AgentRoster } from './agent-roster.js'

const MAX_OWNED_ROLES = 12

export const DISPATCH_LADDER_GUIDANCE = [
  'Dispatch ladder: do the work yourself when no listed role owns it and nothing can run in parallel;',
  'delegate_task for one role on one task whose result this turn needs;',
  'worker_create for independent work in its own workspace;',
  'a Graph run for multi-step work with dependencies.',
  'Every rung picks roles by id from list_subagent_profiles.'
].join(' ')

/**
 * The per-turn "delegation" block: the dispatch ladder plus each role that
 * declares `owns`, so the main agent hands that work over instead of doing it.
 * Renders nothing when no dispatchable role owns anything, which keeps such
 * installs byte-identical. Dynamic context only, never the stable prefix.
 */
export function createDelegationContext(input: {
  roster: Pick<AgentRoster, 'list'>
  enabled: () => boolean
}): (request: { threadId: string; workspace?: string; surface?: 'code' | 'write' | 'design' }) => Promise<string | undefined> {
  return async (request) => {
    if (!input.enabled()) return undefined
    const owned = (await input.roster.list({
      ...(request.workspace ? { workspace: request.workspace } : {}),
      surface: request.surface ?? 'code'
    })).filter(dispatchableOwner)
    if (!owned.length) return undefined
    const listed = owned.slice(0, MAX_OWNED_ROLES)
    return [
      DISPATCH_LADDER_GUIDANCE,
      'Hand the work these roles own to them (by id) instead of doing it yourself:',
      ...listed.map((entry) => `- ${entry.id}: ${entry.owns}`),
      ...(owned.length > listed.length ? [`- …and ${owned.length - listed.length} more in list_subagent_profiles.`] : [])
    ].join('\n')
  }
}

/** A role with ownership that at least one dispatch lane can run right now. */
function dispatchableOwner(entry: AgentRosterEntry): boolean {
  if (!entry.owns || entry.mode === 'primary') return false
  return entry.lanes.delegate.state !== 'blocked' || entry.lanes.worker.state !== 'blocked'
}
