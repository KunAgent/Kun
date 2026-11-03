import { describe, expect, it } from 'vitest'
import type { AgentRosterEntry, AgentRosterLaneStatus } from '../contracts/agent-roster.js'
import { delegationContextBlock } from '../loop/model-step-preparation-helpers.js'
import { createDelegationContext, DISPATCH_LADDER_GUIDANCE } from './delegation-context.js'

const ok: AgentRosterLaneStatus = { state: 'ok' }
const blocked: AgentRosterLaneStatus = { state: 'blocked', code: 'engine_not_ready', message: 'signed out' }

function entry(id: string, owns: string | undefined, lanes: Partial<AgentRosterEntry['lanes']> = {}): AgentRosterEntry {
  return {
    id, source: 'configured', name: id, description: '', ...(owns ? { owns } : {}), surfaces: ['shared'],
    mode: 'subagent', toolPolicy: 'readOnly', engine: { kind: 'lane-default' },
    facts: { writes: false, resumable: true, liveProgress: true, kunTools: true, userInput: true },
    lanes: { delegate: ok, worker: ok, graph: ok, conversation: ok, ...lanes }
  }
}

const context = (entries: AgentRosterEntry[], enabled = true) =>
  createDelegationContext({ roster: { list: async () => entries }, enabled: () => enabled })

describe('delegation context block', () => {
  it('lists the ladder and only dispatchable roles that own work', async () => {
    const content = await context([
      entry('reviewer', 'owns code review. Do not review diffs yourself.'),
      entry('explore', undefined),
      entry('offline', 'owns nothing reachable', { delegate: blocked, worker: blocked })
    ])({ threadId: 't1', workspace: '/repo' })
    expect(content).toBe([
      DISPATCH_LADDER_GUIDANCE,
      'Hand the work these roles own to them (by id) instead of doing it yourself:',
      '- reviewer: owns code review. Do not review diffs yourself.'
    ].join('\n'))
  })

  it('renders nothing without owners or with delegation turned off', async () => {
    expect(await context([entry('explore', undefined)])({ threadId: 't1' })).toBeUndefined()
    expect(await context([entry('reviewer', 'owns review')], false)({ threadId: 't1' })).toBeUndefined()
  })

  it('reaches only top-level native conversations', async () => {
    const resolve = async () => 'ladder'
    const top = { workspace: '/repo', relation: 'primary' as const }
    expect(await delegationContextBlock('direct', top, 't1', resolve)).toMatchObject({ kind: 'delegation', content: 'ladder' })
    expect(await delegationContextBlock('graph', top, 't1', resolve)).toBeNull()
    expect(await delegationContextBlock('direct', { ...top, parentThreadId: 'parent' }, 't1', resolve)).toBeNull()
    expect(await delegationContextBlock('direct', { ...top, harnessId: 'codex' }, 't1', resolve)).toBeNull()
  })
})
