import { expect, it } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { ROOM_GOAL_MAX_NO_PROGRESS_TOOLS } from '../src/loop/goal-execution-budget.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

it('bounds a room goal making only successful read calls, including one oversized parallel batch', async () => {
  let executed = 0
  const timers: unknown[] = []
  const h = makeHarness({ provider: 'test', model: 'test', async *stream() {
    for (let index = 0; index < ROOM_GOAL_MAX_NO_PROGRESS_TOOLS + 8; index++) {
      yield { kind: 'tool_call_complete', callId: `read-${index}`, toolName: 'read', arguments: {} }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  } }, { tools: [LocalToolHost.defineTool({ name: 'read', description: 'Read fixture',
    inputSchema: { type: 'object', properties: {} }, policy: 'auto',
    execute: async () => { executed++; return { output: { content: 'unchanged' } } }
  })], goalResume: { setTimer: (fn) => { timers.push(fn); return { cancel() {} } } } })
  await bootstrapThread(h)
  const thread = (await h.threadStore.get(h.threadId))!
  await h.threadStore.upsert({ ...thread, roomContext: {
    roomId: 'room', memberId: 'member', kind: 'conversation',
    blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: []
  } })
  await h.threads.setGoal(h.threadId, { objective: 'Produce a useful result', status: 'active' })
  await h.loop.runTurn(h.threadId, h.turnId)
  expect(executed).toBe(ROOM_GOAL_MAX_NO_PROGRESS_TOOLS)
  expect((await h.threads.getGoal(h.threadId))?.status).toBe('blocked')
  expect(timers).toHaveLength(0)
  const results = (await h.sessionStore.loadItems(h.threadId)).filter((item) => item.kind === 'tool_result')
  expect(results).toHaveLength(ROOM_GOAL_MAX_NO_PROGRESS_TOOLS + 8)
  expect(results.filter((item) => item.isError)).toHaveLength(8)
})
