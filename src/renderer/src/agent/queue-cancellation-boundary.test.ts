import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeRequestPayloadSchema } from '../../../main/ipc/app-ipc-schemas/runtime'
import { KunRuntimeProvider } from './kun-runtime'
import { cancelQueuedTurn } from '../../../../kun/src/server/routes/turns'
import { TurnService } from '../../../../kun/src/services/turn-service'
import { InMemoryThreadStore } from '../../../../kun/src/adapters/in-memory-thread-store'
import { InMemorySessionStore } from '../../../../kun/src/adapters/in-memory-session-store'
import { InMemoryEventBus } from '../../../../kun/src/adapters/in-memory-event-bus'
import { RuntimeEventRecorder } from '../../../../kun/src/services/runtime-event-recorder'
import { InflightTracker } from '../../../../kun/src/loop/inflight-tracker'
import { SteeringQueue } from '../../../../kun/src/loop/steering-queue'
import { ContextCompactor } from '../../../../kun/src/loop/context-compactor'
import { SequentialIdGenerator } from '../../../../kun/src/ports/id-generator'
import { createThreadRecord } from '../../../../kun/src/domain/thread'

async function harness() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => new Date().toISOString()
  const turns = new TurnService({
    threadStore, sessionStore, nowIso,
    events: new RuntimeEventRecorder({ eventBus, sessionStore, nowIso,
      allocateSeq: (id) => eventBus.allocateSeq(id) }),
    inflight: new InflightTracker(), steering: new SteeringQueue(),
    compactor: new ContextCompactor(), ids: new SequentialIdGenerator()
  })
  await threadStore.upsert(createThreadRecord({ id: 'thread', title: 'queue', workspace: process.cwd(), model: 'test-model' }))
  return { turns, threadStore }
}

describe('queue cancellation through desktop provider and Main boundary', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('cancels B while A runs, retries a lost response, and never interrupts A', async () => {
    const { turns, threadStore } = await harness()
    const a = await turns.startTurn({ threadId: 'thread', request: { prompt: 'A' } })
    const b = await turns.startTurn({ threadId: 'thread', request: { prompt: 'B', enqueueIfBusy: true } })
    let loseResponse = true
    vi.stubGlobal('window', { kunGui: { runtimeRequest: async (path: string, method: string) => {
      const request = runtimeRequestPayloadSchema.parse({ path, method })
      const match = /^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel-queued$/.exec(request.path)!
      const result = await cancelQueuedTurn(turns, decodeURIComponent(match[1]!), decodeURIComponent(match[2]!))
      if (loseResponse) { loseResponse = false; throw new Error('response lost') }
      if (result instanceof Response) throw new Error('unexpected streaming response')
      return { ok: result.status < 400, status: result.status, body: result.body }
    } } })
    const provider = new KunRuntimeProvider()
    await expect(provider.cancelQueuedTurn('thread', b.turnId)).rejects.toThrow('response lost')
    await expect(provider.cancelQueuedTurn('thread', b.turnId)).resolves.toBeUndefined()
    await expect(provider.cancelQueuedTurn('thread', a.turnId)).rejects.toThrow()
    const record = await threadStore.get('thread')
    expect(record?.turns.map((turn) => turn.status)).toEqual(['running', 'aborted'])
    await turns.finishTurn({ threadId: 'thread', turnId: a.turnId, status: 'completed' })
    expect(await turns.startNextQueuedTurn('thread')).toBeNull()
  })
  it.each([{}, { threadId: 'other', turnId: 'b', status: 'aborted' },
    { threadId: 'thread', turnId: 'b', status: 'running' }])('rejects unconfirmed successful HTTP bodies: %j', async (body) => {
    vi.stubGlobal('window', { kunGui: { runtimeRequest: async () => ({ ok: true, status: 200, body: JSON.stringify(body) }) } })
    await expect(new KunRuntimeProvider().cancelQueuedTurn('thread', 'b')).rejects.toThrow('invalid queue cancellation')
  })
})
