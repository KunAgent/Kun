import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { HistoryReferenceService } from './history-reference-service.js'

const roots: string[] = []
const nowIso = () => '2026-09-13T00:00:00.000Z'
const sourceSecret = 'SOURCE_CONTENT_ONLY_496514310'

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-history-service-'))
  roots.push(root)
  const path = join(root, 'rollout-test.jsonl')
  await writeFile(path, fixture(root))
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const threadService = new ThreadService({ threadStore, sessionStore, ids: new SequentialIdGenerator(), nowIso,
    events: new RuntimeEventRecorder({ eventBus, sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso }) })
  let enabled = true
  const options = { dataDir: join(root, 'data'), threadService, enabled: () => enabled,
    defaultModel: () => ({ model: 'kun-test-model', providerId: 'kun-test-provider' }) }
  return { root, path, threadStore, threadService, sessionStore, options,
    service: new HistoryReferenceService(options), disable: () => { enabled = false } }
}

function fixture(workspace: string): string {
  return [
    { type: 'session_meta', payload: { id: 'codex-test', cwd: workspace, timestamp: nowIso() } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-test' } },
    { type: 'turn_context', payload: { turn_id: 'turn-test', cwd: workspace } },
    { type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'Test history' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: sourceSecret }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-test' } }
  ].map((record) => JSON.stringify({ timestamp: nowIso(), ...record })).join('\n') + '\n'
}

async function allJson(root: string): Promise<string> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(await allJson(path))
    else result.push(await readFile(path, 'utf8'))
  }
  return result.join('\n')
}

describe('reference branches', () => {
  it('creates an empty native thread, shares source snapshots and stores no source bodies', async () => {
    const h = await harness()
    const first = await h.service.createBranch({ path: h.path, idempotencyKey: 'first' })
    const second = await h.service.createBranch({ path: h.path, idempotencyKey: 'second' })
    expect(first.thread.id).not.toBe(second.thread.id)
    expect(first.reference.id).toBe(second.reference.id)
    expect(first.thread).toMatchObject({ historyRefId: first.reference.id, turns: [], model: 'kun-test-model' })
    expect(await h.sessionStore.loadItems(first.thread.id)).toEqual([])
    expect(await allJson(join(h.root, 'data'))).not.toContain(sourceSecret)
    expect((await h.threadService.list())[0]?.historyRefId).toBe(first.reference.id)
    const fork = await h.threadService.fork(first.thread.id)
    expect(fork.historyRefId).toBe(first.reference.id)
    expect(fork.turns).toEqual([])
    expect(await readFile(h.path, 'utf8')).toBe(fixture(h.root))
  })

  it('deduplicates concurrent requests and retries after process restart without reading the source', async () => {
    const h = await harness()
    const input = { path: h.path, idempotencyKey: 'repeated' }
    const requests = await Promise.all(Array.from({ length: 5 }, () => h.service.createBranch(input)))
    expect(new Set(requests.map((result) => result.thread.id)).size).toBe(1)
    await rm(h.path)
    const restarted = new HistoryReferenceService(h.options)
    expect((await restarted.createBranch(input)).thread.id).toBe(requests[0]!.thread.id)
    expect((await restarted.page(requests[0]!.reference.id, { threadId: requests[0]!.thread.id })).status).toBe('missing')
  })

  it('rejects reuse of a request ID with different options and never resurrects a deleted branch', async () => {
    const h = await harness()
    const input = { path: h.path, idempotencyKey: 'original' }
    const result = await h.service.createBranch(input)
    await expect(h.service.createBranch({ ...input, model: 'other-model' })).rejects.toMatchObject({
      code: 'history_request_conflict'
    })
    await h.threadService.delete(result.thread.id)
    await expect(h.service.createBranch(input)).rejects.toMatchObject({ code: 'history_branch_deleted' })
  })

  it('does not scan or read sources while disabled, but existing branch metadata remains accessible', async () => {
    const h = await harness()
    const result = await h.service.createBranch({ path: h.path, idempotencyKey: 'enabled-once' })
    h.disable()
    await rm(h.path)
    await expect(h.service.discover()).rejects.toMatchObject({ code: 'history_reference_disabled' })
    await expect(h.service.preview({ path: h.path })).rejects.toMatchObject({ code: 'history_reference_disabled' })
    await expect(h.service.createBranch({ path: h.path, idempotencyKey: 'disabled' }))
      .rejects.toMatchObject({ code: 'history_reference_disabled' })
    await expect(h.service.readForThread(result.thread.id, { operation: 'recent' }))
      .rejects.toMatchObject({ code: 'history_reference_disabled' })
    await expect(h.service.attachment(result.reference.id, 'item', 0))
      .rejects.toMatchObject({ code: 'history_reference_disabled' })
    expect((await h.service.get(result.reference.id))?.id).toBe(result.reference.id)
    expect((await h.threadService.get(result.thread.id))?.id).toBe(result.thread.id)
  })

  it('restricts tool references to the current branch and validates relinking before persistence', async () => {
    const h = await harness()
    const result = await h.service.createBranch({ path: h.path, idempotencyKey: 'read' })
    await expect(h.service.readForThread(result.thread.id, { operation: 'recent', referenceId: 'unrelated' }))
      .rejects.toMatchObject({ code: 'history_reference_forbidden' })
    expect((await h.service.readForThread(result.thread.id, { operation: 'recent' })).text).toContain(sourceSecret)
    const replacement = join(h.root, 'moved.jsonl')
    await writeFile(replacement, fixture(h.root).replace(sourceSecret, 'rewritten'))
    await expect(h.service.relink(result.reference.id, replacement)).rejects.toThrow()
    expect((await h.service.get(result.reference.id))?.files[0]?.path).toBe(h.path)
    await writeFile(replacement, fixture(h.root))
    await h.service.relink(result.reference.id, replacement)
    await rm(h.path)
    expect((await h.service.readForThread(result.thread.id, { operation: 'recent' })).text).toContain(sourceSecret)
  })

  it('repairs shared source locations when an identical moved snapshot is selected again', async () => {
    const h = await harness()
    const first = await h.service.createBranch({ path: h.path, idempotencyKey: 'before-move' })
    const moved = join(h.root, 'moved-rollout.jsonl')
    await writeFile(moved, await readFile(h.path))
    await rm(h.path)
    const second = await h.service.createBranch({ path: moved, idempotencyKey: 'after-move' })
    expect(second.reference.id).toBe(first.reference.id)
    expect(second.reference.files[0]?.path).toBe(moved)
    expect((await h.service.page(first.reference.id, { threadId: first.thread.id })).status).toBe('available')
  })

  it('preserves references through canonical thread serialization without embedding source messages', async () => {
    const h = await harness()
    const created = await h.service.createBranch({ path: h.path, idempotencyKey: 'disk' })
    const stored = new FileThreadStore({ dataDir: join(h.root, 'canonical') })
    await stored.upsert(created.thread)
    const reopened = new FileThreadStore({ dataDir: join(h.root, 'canonical') })
    expect(await reopened.get(created.thread.id)).toMatchObject({ historyRefId: created.reference.id, turns: [] })
    expect((await reopened.list())[0]?.historyRefId).toBe(created.reference.id)
    expect(await allJson(join(h.root, 'canonical'))).not.toContain(sourceSecret)
  })

  it('allows earlier completed cutoffs while rejecting later Codex additions through a frozen reference', async () => {
    const h = await harness()
    const second = fixture(h.root).split('\n').slice(1).join('\n').replaceAll('turn-test', 'turn-second')
    await writeFile(h.path, fixture(h.root) + second)
    const created = await h.service.createBranch({ path: h.path, idempotencyKey: 'two-turns' })
    const preview = await h.service.preview({ path: h.path })
    const earlier = preview.cutoffs[0]!.turnId
    const branch = await h.service.createBranch({ referenceId: created.reference.id,
      cutoffTurnId: earlier, idempotencyKey: 'earlier' })
    expect(branch.reference.cutoffTurnId).toBe(earlier)
    expect((await h.service.page(branch.reference.id, { threadId: branch.thread.id })).turns).toHaveLength(1)
    await writeFile(h.path, fixture(h.root) + second + second.replaceAll('turn-second', 'turn-third'))
    const later = (await h.service.preview({ path: h.path })).cutoffs.at(-1)!.turnId
    await expect(h.service.createBranch({ referenceId: created.reference.id,
      cutoffTurnId: later, idempotencyKey: 'too-late' })).rejects.toMatchObject({ code: 'history_cutoff_invalid' })
  })

  it('branches from the frozen prefix after Codex rolls back those same live turns', async () => {
    const h = await harness()
    const second = fixture(h.root).split('\n').slice(1).join('\n').replaceAll('turn-test', 'turn-second')
    const source = fixture(h.root) + second
    await writeFile(h.path, source)
    const created = await h.service.createBranch({ path: h.path, idempotencyKey: 'before-rollback' })
    const earlier = (await h.service.preview({ path: h.path })).cutoffs[0]!.turnId
    await writeFile(h.path, source + JSON.stringify({ type: 'event_msg', timestamp: nowIso(),
      payload: { type: 'session_rollback', num_turns: 2 } }) + '\n')
    const branch = await h.service.createBranch({ referenceId: created.reference.id,
      cutoffTurnId: earlier, idempotencyKey: 'after-rollback' })
    const page = await h.service.page(branch.reference.id, { threadId: branch.thread.id })
    expect(page.status).toBe('available')
    expect(page.turns).toHaveLength(1)
    expect(page.turns[0]?.id).toBe(earlier)
  })

  it('recovers a commit whose notification failed without overwriting the new thread', async () => {
    const h = await harness()
    const create = h.threadService.create.bind(h.threadService)
    vi.spyOn(h.threadService, 'create').mockImplementationOnce(async (...args) => {
      await create(...args)
      throw new Error('notification failed after commit')
    })
    const input = { path: h.path, idempotencyKey: 'recover' }
    await expect(h.service.createBranch(input)).rejects.toThrow('notification failed')
    const restarted = new HistoryReferenceService(h.options)
    const recovered = await restarted.createBranch(input)
    expect((await h.threadService.list()).map((thread) => thread.id)).toEqual([recovered.thread.id])
  })
})
