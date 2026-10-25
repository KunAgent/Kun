import { describe, expect, it } from 'vitest'
import { AgentRosterEntrySchema } from '../../kun/src/contracts/agent-roster'
import { AgentRosterEntryViewSchema, agentRosterPath, rosterRolesFor } from './agent-roster'
import { TaskSuggestionPublicSchema } from './task-suggestions'
import { TaskSuggestionIntentSchema, publicTaskSuggestion } from '../../kun/src/contracts/task-suggestions'

const entry = AgentRosterEntrySchema.parse({
  id: 'reviewer', source: 'workspace', name: 'Reviewer', description: 'Reviews diffs.', owns: 'owns review',
  surfaces: ['code'], mode: 'subagent', toolPolicy: 'readOnly',
  engine: { kind: 'bound', harnessId: 'codex', displayName: 'Codex', credentialMode: 'native-login', model: 'gpt-5.5-codex' },
  facts: { writes: false, resumable: true, liveProgress: true, kunTools: false, userInput: true },
  lanes: { delegate: { state: 'ok' }, worker: { state: 'unchecked' },
    graph: { state: 'blocked', code: 'capability_missing', message: 'kunTools' }, conversation: { state: 'ok' } }
})

describe('agent roster HTTP mirror', () => {
  it('reads what the runtime serves and builds the listing path', () => {
    expect(AgentRosterEntryViewSchema.parse(entry)).toMatchObject({ id: 'reviewer', engine: { harnessId: 'codex' } })
    expect(agentRosterPath()).toBe('/v1/agent-roster')
    expect(agentRosterPath({ workspace: '/repo with space', surface: 'code' })).toBe('/v1/agent-roster?surface=code&workspace=%2Frepo+with+space')
  })

  it('offers workers dispatchable roles and task sessions session roles', () => {
    const persona = AgentRosterEntryViewSchema.parse({ ...entry, id: 'lead', mode: 'primary' })
    const roles = [AgentRosterEntryViewSchema.parse(entry), persona]
    expect(rosterRolesFor(roles, 'worker').map((role) => role.id)).toEqual(['reviewer'])
    expect(rosterRolesFor(roles, 'session').map((role) => role.id)).toEqual(['lead'])
  })

  it('accepts a task route that names a role', () => {
    const intent = TaskSuggestionIntentSchema.parse({ intentId: 'tsg', revision: 1,
      source: { threadId: 't', turnId: 'u', toolCallId: 'c' }, state: 'active', workspace: '/repo',
      tasks: [{ id: 't1', title: 'A', brief: { goal: 'g', scope: [], done: [] },
        route: { agentId: 'kun', profileId: 'lead' }, worktree: true, inheritContext: false, state: 'suggested', attempt: 0 }],
      requestIds: [], createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' })
    const parsed = TaskSuggestionPublicSchema.parse(publicTaskSuggestion(intent))
    expect(parsed.tasks[0]?.route.profileId).toBe('lead')
  })
})
