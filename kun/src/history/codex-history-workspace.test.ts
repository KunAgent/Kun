import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { HistoryReferenceService } from './history-reference-service.js'

it('uses the selected cutoff cwd for default branches while preserving explicit workspace selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-codex-workspace-'))
  try {
    const nowIso = () => '2026-09-13T00:00:00.000Z'
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const threadService = new ThreadService({ threadStore, sessionStore, ids: new SequentialIdGenerator(), nowIso,
      events: new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso }) })
    const service = new HistoryReferenceService({ dataDir: join(root, 'data'), threadService, threadStore,
      enabled: () => true, defaultModel: () => ({ model: 'test-model' }) })
    const path = join(root, 'rollout-test.jsonl')
    const workspaceA = join(root, 'project-a')
    const workspaceB = join(root, 'project-b')
    const explicitWorkspace = join(root, 'selected')
    const message = (role: string, text: string) => ({ type: 'response_item', payload: {
      type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
    } })
    await writeFile(path, [{ type: 'session_meta', payload: { id: 'source', cwd: workspaceA } },
      { type: 'turn_context', payload: { turn_id: 'a', cwd: workspaceA } }, message('user', 'A'), message('assistant', 'Done A'),
      { type: 'turn_context', payload: { turn_id: 'b', cwd: workspaceB } }, message('user', 'B'), message('assistant', 'Done B')
    ].map((record) => JSON.stringify({ timestamp: nowIso(), ...record })).join('\n') + '\n')
    const latest = await service.createBranch({ path, idempotencyKey: 'latest' })
    expect(latest.thread.workspace).toBe(workspaceB)
    const earlier = await service.createBranch({ path, cutoffTurnId: 'codex:source:a', idempotencyKey: 'earlier' })
    expect(earlier.thread.workspace).toBe(workspaceA)
    const explicit = await service.createBranch({ path, workspace: explicitWorkspace, idempotencyKey: 'explicit' })
    expect(explicit.thread.workspace).toBe(explicitWorkspace)
    expect(explicit.reference.workspace).toBe(workspaceB)
  } finally { await rm(root, { recursive: true, force: true }) }
})
