import { ThreadSchema } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadDetail } from './client.js'
import { projectThreadSnapshot, type ThreadProjection } from './state.js'

export const FIXTURE_THREAD_ID = 'thr_fixture'
const CREATED_AT = '2026-10-18T00:00:00.000Z'

type ItemOf<K extends TurnItem['kind']> = Extract<TurnItem, { kind: K }>
type ItemStatus = ItemOf<'assistant_text'>['status']

function base(id: string, turnId: string, role: TurnItem['role'], status: ItemStatus) {
  return { id, turnId, threadId: FIXTURE_THREAD_ID, role, status, createdAt: CREATED_AT }
}

export const fixtureItems = {
  user(id: string, turnId: string, text: string): ItemOf<'user_message'> {
    return { ...base(id, turnId, 'user', 'completed'), kind: 'user_message', text } as ItemOf<'user_message'>
  },
  text(id: string, turnId: string, text: string, status: ItemStatus = 'completed'): ItemOf<'assistant_text'> {
    return { ...base(id, turnId, 'assistant', status), kind: 'assistant_text', text }
  },
  reasoning(id: string, turnId: string, text: string, status: ItemStatus = 'completed'): ItemOf<'assistant_reasoning'> {
    return { ...base(id, turnId, 'assistant', status), kind: 'assistant_reasoning', text }
  },
  call(id: string, turnId: string, toolName: string, args: Record<string, unknown> = {}, status: ItemStatus = 'running'): ItemOf<'tool_call'> {
    return { ...base(id, turnId, 'assistant', status), kind: 'tool_call', toolName, callId: id, toolKind: 'tool_call', arguments: args }
  },
  result(callId: string, turnId: string, toolName: string, output: unknown, status: ItemStatus = 'completed', isError = false): ItemOf<'tool_result'> {
    return { ...base(`result_${callId}`, turnId, 'tool', status), kind: 'tool_result', toolName, callId, toolKind: 'tool_call', output, isError }
  }
}

/** A thread with one turn per entry of `turns`; the last turn may still run. */
export function fixtureProjection(turns: Array<{ id: string; items: TurnItem[]; running?: boolean }>): ThreadProjection {
  const thread = ThreadSchema.parse({
    id: FIXTURE_THREAD_ID, title: 'Fixture thread', workspace: '/tmp/project', model: 'model-a',
    mode: 'agent', status: turns.some((turn) => turn.running) ? 'running' : 'idle',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    createdAt: CREATED_AT, updatedAt: CREATED_AT, turns: []
  })
  const detail = {
    ...thread,
    latestSeq: 0,
    pendingUserInputIds: [],
    turns: turns.map((turn) => ({
      id: turn.id,
      threadId: FIXTURE_THREAD_ID,
      status: turn.running ? 'running' : 'completed',
      orchestration: 'direct',
      prompt: 'fixture',
      steering: [],
      createdAt: CREATED_AT,
      startedAt: CREATED_AT,
      ...(turn.running ? {} : { finishedAt: CREATED_AT }),
      items: turn.items,
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedDirectiveIds: [],
      injectedDirectiveSummaries: [],
      injectedInstructionSources: []
    }))
  } as unknown as ThreadDetail
  return projectThreadSnapshot(detail)
}
