import { afterEach, describe, expect, it } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import { prepareRoomAgreements } from './room-rule-compression.js'
import { bindRoomRuleStore, roomRuleReadTool } from './room-rule-read-tool.js'
import { ensureRoomThread } from './room-execution.js'
import type { RoomRequestState } from './room-runtime-types.js'
import type { ToolHostContext } from '../ports/tool-host.js'
const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
describe('original agreement tool authority', () => {
  it('reads only the execution frozen bundle and follows an explicit later adoption', async () => {
    const f = await productServiceFixture()
    fixtures.push(f)
    const sent = await f.service.send(f.room.id, { clientRequestId: 'request', body: 'Use the project agreements' })
    const request = (await f.store.get<RoomRequestState>('request', sent.requestId))!.value
    const rule = { id: 'agreement', version: 1, messageId: 'source', active: true, body: 'Keep limit 12.' }
    const first = await prepareRoomAgreements(f.deps, request, [rule], 16000)
    await f.updateTask({ agreements: first.agreements, rulesSnapshot: first.rules })
    const thread = await ensureRoomThread(f.deps, { id: f.execution.task.executionThreadId, roomId: f.room.id,
      taskId: f.execution.task.id, member: f.execution.task.memberSnapshot, kind: 'execution' })
    const turn = await f.h.turns.enqueueTurn({ threadId: thread.id, request: { prompt: 'Inspect the original rule', clientRequestId: 'read' } })
    bindRoomRuleStore(f.h.threadStore, f.store)
    const context = { threadId: thread.id, turnId: turn.turnId, roomStepKind: 'execution' } as ToolHostContext
    const tool = roomRuleReadTool(f.h.threadStore)
    const result = await tool.execute({ bundleId: first.agreements.bundleId, ruleId: rule.id }, context)
    expect(result).toMatchObject({ output: { rule: { body: 'Keep limit 12.', version: 1 } } })
    const second = await prepareRoomAgreements(f.deps, request, [{ ...rule, version: 2, body: 'Keep limit 16.' }], 16000)
    expect(await tool.execute({ bundleId: second.agreements.bundleId, ruleId: rule.id }, context)).toMatchObject({ isError: true })
    await f.updateTask({ agreements: second.agreements, rulesSnapshot: second.rules })
    expect(await tool.execute({ bundleId: second.agreements.bundleId, ruleId: rule.id }, context))
      .toMatchObject({ output: { rule: { body: 'Keep limit 16.', version: 2 } } })
    expect(await tool.execute({ bundleId: first.agreements.bundleId, ruleId: rule.id }, { ...context, threadId: 'foreign' }))
      .toMatchObject({ isError: true })
  })
})
