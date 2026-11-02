import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService, type TurnServiceDeps } from '../services/turn-service.js'
import { ManagerRemoteThreadStore } from './remote-thread-store.js'
import { ManagerRemoteSessionStore } from './remote-data-stores.js'
import { withNativeFollowUpWriteScope } from './native-followup-write-scope.js'
import { nativeManagerFixture, type NativeManagerFixture } from './followup-thread-test-support.js'

const fixtures: NativeManagerFixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close() })

describe('native queued receiver through the actual Manager-backed stores', () => {
  it('enqueues and promotes the original thread with a preissued permit and durable user item', async () => {
    const h = await nativeManagerFixture(); fixtures.push(h); await h.seed()
    const threadStore = new ManagerRemoteThreadStore(h.connection)
    const sessionStore = new ManagerRemoteSessionStore(h.connection)
    const bus = new InMemoryEventBus()
    const nowIso = () => new Date().toISOString()
    const deps: TurnServiceDeps = {
      threadStore, sessionStore, nowIso, ids: new SequentialIdGenerator(),
      events: new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq: (id) => bus.allocateSeq(id), nowIso }),
      inflight: new InflightTracker(), steering: new SteeringQueue(), compactor: new ContextCompactor(),
      // This is a test host scope, not the still-unimplemented production permit issuer.
      withFollowUpAdmission: (input, operation) => withNativeFollowUpWriteScope({
        ...h.scope, admission: input.admission, stage: input.stage
      }, operation)
    }
    const turns = new TurnService(deps)
    const input = { threadId: h.thread.id, request: h.exec.nativeRequest.request }
    const accepted = await turns.enqueueTurn(input, { nativeFollowUp: h.scope.admission })
    expect(accepted).toMatchObject({ threadId: h.thread.id, status: 'queued' })
    expect(await turns.lookupNativeFollowUpRequest({ threadId: h.thread.id, admission: h.scope.admission }))
      .toMatchObject({ state: 'accepted', turnId: accepted.turnId })
    const userItems = await sessionStore.loadItems(h.thread.id)
    expect(userItems).toEqual(expect.arrayContaining([expect.objectContaining({
      id: accepted.userMessageItemId, kind: 'user_message', text: input.request.prompt
    })]))
    expect(await turns.startNextQueuedTurn(h.thread.id)).toEqual({ turnId: accepted.turnId })
    expect((await threadStore.get(h.thread.id))).toMatchObject({ workspace: h.thread.workspace,
      turns: [expect.objectContaining({ id: accepted.turnId, status: 'running' })] })
    // Normal native model preparation records resolved skills after promotion.
    // The admission guard must not mistake that runtime progress for a new start.
    await turns.updateTurnMetadata(h.thread.id, accepted.turnId, { activeSkillIds: ['skill_from_runtime'] })
    expect((await threadStore.get(h.thread.id))?.turns[0].activeSkillIds).toEqual(['skill_from_runtime'])
  })
})
