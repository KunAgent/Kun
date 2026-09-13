import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { ThreadService } from '../../src/services/thread-service.js'
import { TurnService } from '../../src/services/turn-service.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { HistoryReferenceService } from '../../src/history/history-reference-service.js'

export const SOURCE_TEXT = 'SOURCE_ONLY_e8e27a677_previous_investigation'
export async function historyReferenceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-ref-integration-'))
  const path = join(root, 'rollout-fixture.jsonl')
  const nowIso = () => '2026-09-13T00:00:00.000Z'
  const records: unknown[] = [{ type: 'session_meta', payload: { id: 'source-test', cwd: root } }]
  for (let i = 1; i <= 2; i += 1) records.push(
    { type: 'event_msg', payload: { type: 'task_started', turn_id: `old-${i}` } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Task ${i}` }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${SOURCE_TEXT} ${i}` }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: `old-${i}` } }
  )
  await writeFile(path, records.map((record) => JSON.stringify({ timestamp: nowIso(), ...record as object })).join('\n') + '\n')
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const ids = new SequentialIdGenerator()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor()
  const turnService = new TurnService({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso })
  let enabled = true
  const historyReferences = new HistoryReferenceService({ dataDir: join(root, 'data'), threadService,
    enabled: () => enabled, defaultModel: () => ({ model: 'test' }) })
  const { thread, reference } = await historyReferences.createBranch({ path, idempotencyKey: 'first' })
  return { root, path, thread, reference, threadStore, sessionStore, eventBus, ids, events,
    threadService, turnService, inflight, steering, compactor, nowIso, historyReferences,
    disable: () => { enabled = false } }
}
