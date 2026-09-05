import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  type ModelRequestTraceRecord
} from '../contracts/model-request-trace.js'
import {
  classifyTracePersistenceError,
  ModelRequestTraceStore
} from './model-request-trace-store.js'

describe('classifyTracePersistenceError', () => {
  it('classifies ENOSPC as storage exhaustion', () => {
    const error = Object.assign(new Error('no space left on device'), {
      code: 'ENOSPC',
      errno: -28,
      syscall: 'rename'
    })
    const message = classifyTracePersistenceError(error)
    expect(message).toContain('storage exhausted (ENOSPC)')
    expect(message).toContain('in-memory records retained')
  })

  it('classifies permission failures distinctly', () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const message = classifyTracePersistenceError(error)
    expect(message).toContain('trace persistence permission denied (EACCES)')
  })

  it('falls back to a generic message for unknown errors', () => {
    expect(classifyTracePersistenceError(new Error('boom'))).toContain('trace persistence failed: boom')
    expect(classifyTracePersistenceError('boom')).toContain('trace persistence failed: boom')
  })
})

describe('ModelRequestTraceStore', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('persists private thread JSONL and pages newest-first', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const store = new ModelRequestTraceStore(dataDir)
    await store.append(record('trace-1', '2026-01-01T00:00:01.000Z'))
    await store.append(record('trace-2', '2026-01-01T00:00:02.000Z'))
    await store.append(record('trace-3', '2026-01-01T00:00:03.000Z'))

    const first = await store.list('thread-1', { limit: 2 })
    expect(first.records.map((item) => item.id)).toEqual(['trace-3', 'trace-2'])
    expect(first.nextCursor).toBeTruthy()
    const second = await store.list('thread-1', { limit: 2, cursor: first.nextCursor })
    expect(second.records.map((item) => item.id)).toEqual(['trace-1'])

    const root = join(dataDir, 'observability', 'trajectory', 'records')
    const files = await import('node:fs/promises').then((fs) => fs.readdir(root))
    expect(files).toHaveLength(1)
    if (process.platform !== 'win32') {
      expect((await stat(root)).mode & 0o777).toBe(0o700)
      expect((await stat(join(root, files[0]))).mode & 0o777).toBe(0o600)
    }
  })

  it('ignores a malformed trailing line and deletes only the selected thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const store = new ModelRequestTraceStore(dataDir)
    await store.append(record('trace-1', '2026-01-01T00:00:01.000Z'))
    await store.append(record('other', '2026-01-01T00:00:01.000Z', 'thread-2'))
    const root = join(dataDir, 'observability', 'trajectory', 'records')
    const file = (await import('node:fs/promises').then((fs) => fs.readdir(root)))
      .find((name) => name === `${Buffer.from('thread-1').toString('base64url')}.jsonl`)!
    await appendFile(join(root, file), '{"broken":\n')

    const page = await store.list('thread-1')
    expect(page.records.map((item) => item.id)).toEqual(['trace-1'])
    expect(page.warnings).toContain('one malformed trace record was ignored')

    await store.deleteThread('thread-1')
    expect((await store.list('thread-1')).records).toEqual([])
    expect((await store.list('thread-2')).records.map((item) => item.id)).toEqual(['other'])
    expect(await readFile(
      join(root, `${Buffer.from('thread-2').toString('base64url')}.jsonl`),
      'utf8'
    )).toContain('other')
  })

  it('round-trips optional tool provenance while accepting legacy records without it', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const store = new ModelRequestTraceStore(dataDir)
    const exact = record('trace-2', '2026-01-01T00:00:02.000Z')
    exact.toolCatalog = [{ name: 'read', providerKind: 'built-in', providerId: 'builtin' }]
    await store.append(record('trace-1', '2026-01-01T00:00:01.000Z'))
    await store.append(exact)

    const page = await store.list('thread-1')

    expect(page.records[0].toolCatalog).toEqual(exact.toolCatalog)
    expect(page.records[1].toolCatalog).toBeUndefined()
  })

  it('reads legacy schema-v1 files without rewriting them', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-legacy-'))
    cleanup.push(dataDir)
    const legacyRoot = join(dataDir, 'observability', 'model-http')
    await mkdir(legacyRoot, { recursive: true })
    const legacy = record('legacy-trace', '2026-01-01T00:00:01.000Z')
    const legacyPath = join(legacyRoot, `${Buffer.from('thread-1').toString('base64url')}.jsonl`)
    await writeFile(legacyPath, `${JSON.stringify(legacy)}\n`)

    const store = new ModelRequestTraceStore(dataDir)
    expect((await store.list('thread-1')).records).toContainEqual(legacy)
    expect(await readFile(legacyPath, 'utf8')).toBe(`${JSON.stringify(legacy)}\n`)
  })

  it('serves repeated latest-page reads from the tail cache and keeps it current on append', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const store = new ModelRequestTraceStore(dataDir)
    await store.append(record('trace-1', '2026-01-01T00:00:01.000Z'))

    await expect(store.list('thread-1')).resolves.toMatchObject({
      records: [expect.objectContaining({ id: 'trace-1' })],
      warnings: []
    })

    const root = join(dataDir, 'observability', 'trajectory', 'records')
    const path = join(root, `${Buffer.from('thread-1').toString('base64url')}.jsonl`)
    await appendFile(path, '{"malformed-after-cache":\n')
    await store.append(record('trace-2', '2026-01-01T00:00:02.000Z'))

    const latest = await store.list('thread-1')
    expect(latest.records.map((item) => item.id)).toEqual(['trace-2', 'trace-1'])
    expect(latest.warnings).not.toContain('one malformed trace record was ignored')
  })

  it('retains a bounded newest tail per thread while the process stays alive', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const sampleBytes = Buffer.byteLength(JSON.stringify(
      record('trace-1', '2026-01-01T00:00:01.000Z')
    )) + 1
    const maxBytesPerThread = sampleBytes * 2 + 32
    const store = new ModelRequestTraceStore(dataDir, {
      maxBytesPerThread,
      maintenanceIntervalMs: 0,
      now: () => Date.parse('2026-01-02T00:00:00.000Z')
    })
    for (let index = 1; index <= 5; index += 1) {
      await store.append(record(
        `trace-${index}`,
        `2026-01-01T00:00:0${index}.000Z`
      ))
    }

    const page = await store.list('thread-1')
    expect(page.records.map((item) => item.id)).toEqual(['trace-5', 'trace-4'])
    const path = join(
      dataDir,
      'observability',
      'trajectory',
      'records',
      `${Buffer.from('thread-1').toString('base64url')}.jsonl`
    )
    expect((await stat(path)).size).toBeLessThanOrEqual(maxBytesPerThread)
  })

  it('shares a global byte budget across recent traces from multiple threads', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const samples = ['thread-1', 'thread-2', 'thread-3'].map((threadId) =>
      Buffer.byteLength(JSON.stringify(record('trace-2', '2026-01-01T00:00:02.000Z', threadId))) + 1)
    const maxTotalBytes = Math.max(...samples) * 3 + 32
    const store = new ModelRequestTraceStore(dataDir, {
      maxBytesPerThread: maxTotalBytes,
      maxTotalBytes,
      maintenanceIntervalMs: 0,
      now: () => Date.parse('2026-01-02T00:00:00.000Z')
    })
    for (const threadId of ['thread-1', 'thread-2', 'thread-3']) {
      await store.append(record('trace-1', '2026-01-01T00:00:01.000Z', threadId))
      await store.append(record('trace-2', '2026-01-01T00:00:02.000Z', threadId))
    }

    for (const threadId of ['thread-1', 'thread-2', 'thread-3']) {
      expect((await store.list(threadId)).records.map((item) => item.id)).toEqual(['trace-2'])
    }
    const root = join(dataDir, 'observability', 'trajectory', 'records')
    const sizes = await Promise.all((await readdir(root)).map(async (name) => (await stat(join(root, name))).size))
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(maxTotalBytes)
  })

  it('evicts idle thread tails from an LRU-bounded in-memory cache', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    const store = new ModelRequestTraceStore(dataDir, { maxCachedThreads: 1 })
    await store.append(record('trace-1', '2026-01-01T00:00:01.000Z', 'thread-1'))
    await store.append(record('trace-2', '2026-01-01T00:00:02.000Z', 'thread-2'))
    await store.list('thread-1')
    await store.list('thread-2')
    const path = join(
      dataDir,
      'observability',
      'trajectory',
      'records',
      `${Buffer.from('thread-1').toString('base64url')}.jsonl`
    )
    await appendFile(path, '{"malformed-after-eviction":\n')

    const reloaded = await store.list('thread-1')
    expect(reloaded.records.map((item) => item.id)).toEqual(['trace-1'])
    expect(reloaded.warnings).toContain('one malformed trace record was ignored')
  })

  it('degrades without throwing or blocking when persistence is unavailable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-traces-'))
    cleanup.push(dataDir)
    // Replace the observability directory with a file so mkdir/append fail.
    await writeFile(join(dataDir, 'observability'), 'blocking-file')
    const store = new ModelRequestTraceStore(dataDir)

    await expect(store.append(record('trace-1', '2026-01-01T00:00:01.000Z'))).resolves.toBeUndefined()
    const page = await store.list('thread-1')
    expect(page.records).toEqual([])
    expect(page.warnings.some((warning) => warning.startsWith('trace persistence failed:'))).toBe(true)
    const initialWarningCount = page.warnings.length

    // A subsequent append still resolves and the bounded warning set is
    // deduplicated — the store never enters an unbounded retry/growth loop.
    await expect(store.append(record('trace-2', '2026-01-01T00:00:02.000Z'))).resolves.toBeUndefined()
    const second = await store.list('thread-1')
    expect(second.warnings).toHaveLength(initialWarningCount)
  })
})

function record(
  id: string,
  startedAt: string,
  threadId = 'thread-1'
): ModelRequestTraceRecord {
  return {
    schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
    id,
    sequence: Number(id.replace(/\D/g, '')) || 1,
    threadId,
    turnId: 'turn-1',
    provider: 'openai-compatible',
    model: 'test-model',
    endpointFormat: 'chat_completions',
    attempt: 1,
    attemptReason: 'initial',
    status: 'completed',
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    request: {
      method: 'POST',
      url: 'https://example.test/v1/chat/completions',
      urlRedacted: false,
      headers: { values: { 'Content-Type': 'application/json' }, redactedNames: [] },
      body: { text: '{}', capturedBytes: 2, originalBytes: 2, truncated: false }
    },
    decoded: { text: '', reasoning: '', toolCalls: [] }
  }
}
