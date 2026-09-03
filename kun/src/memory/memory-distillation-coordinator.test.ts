import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import {
  MEMORY_DISTILLATION_MAX_INPUT_CHARS,
  MEMORY_DISTILLATION_MAX_OUTPUT_TOKENS,
  MemoryDistillationCoordinator,
  sanitizeMemoryDistillationDiagnostic
} from './memory-distillation-coordinator.js'
import { MemoryDistillationPendingStore } from './memory-distillation-pending-store.js'
import { FileMemoryStore } from './memory-store.js'

const now = '2026-09-03T01:00:00.000Z'

describe('MemoryDistillationCoordinator', () => {
  it('extracts after a completed non-empty turn without writing before approval', async () => {
    const harness = await createHarness()
    const pending = await harness.coordinator.distill('thread_1', 'turn_1')

    expect(pending).toHaveLength(1)
    expect(await harness.memory.list({ all: true })).toHaveLength(0)
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]).toMatchObject({
      model: 'turn-model',
      providerId: 'provider-a',
      accountId: 'account-a',
      tools: [],
      stream: false,
      maxTokens: MEMORY_DISTILLATION_MAX_OUTPUT_TOKENS,
      temperature: 0,
      topP: 1,
      responseFormat: 'json_object',
      reasoningEffort: 'off'
    })
    expect(harness.requests[0]!.history[0]?.kind).toBe('user_message')
    expect((harness.requests[0]!.history[0] as { text: string }).text.length)
      .toBeLessThanOrEqual(MEMORY_DISTILLATION_MAX_INPUT_CHARS)
    expect(pending[0]).toMatchObject({
      target: { scope: 'workspace', workspace: 'D:/workspace-a' },
      proposedAction: { action: 'create' },
      status: 'pending'
    })
    expect(pending[0]!.candidate.sources.map((source) => source.trust))
      .toEqual(['inferred', 'explicit-user'])
  })

  it('writes an authority-reference Memory only after allow and replays idempotently', async () => {
    const harness = await createHarness()
    const [pending] = await harness.coordinator.distill('thread_1', 'turn_1')
    const allowed = await harness.coordinator.decide(
      pending!.id,
      { decision: 'allow' },
      'D:/workspace-a'
    )
    expect(allowed.status).toBe('allowed')
    const records = await harness.memory.list({ all: true })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: `mem_distilled_${pending!.fingerprint.slice(0, 20)}`,
      scope: 'workspace',
      workspace: 'd:\\workspace-a',
      authority: 'reference',
      sourceThreadId: 'thread_1',
      sourceTurnId: 'turn_1'
    })
    expect(records[0]!.sources).toHaveLength(2)

    expect(await harness.coordinator.distill('thread_1', 'turn_1')).toHaveLength(1)
    expect(harness.requests).toHaveLength(1)
    await expect(harness.coordinator.decide(
      pending!.id,
      { decision: 'allow' },
      'D:/workspace-a'
    )).rejects.toThrow(/already allowed/u)
    expect(await harness.memory.list({ all: true })).toHaveLength(1)
  })

  it('keeps deny, timeout, and withdrawal terminal with zero writes', async () => {
    for (const terminal of ['deny', 'withdraw'] as const) {
      const harness = await createHarness()
      const [pending] = await harness.coordinator.distill('thread_1', 'turn_1')
      const result = await harness.coordinator.decide(
        pending!.id,
        { decision: terminal },
        'D:/workspace-a'
      )
      expect(result.status).toBe(terminal === 'deny' ? 'denied' : 'withdrawn')
      expect(await harness.memory.list({ all: true })).toHaveLength(0)
    }
    const timed = await createHarness()
    const [pending] = await timed.coordinator.distill('thread_1', 'turn_1')
    expect((await timed.coordinator.markTimedOut(pending!.id)).status).toBe('timed-out')
    expect(await timed.memory.list({ all: true })).toHaveLength(0)
  })

  it('does not extract failed, aborted, empty, or opted-out turns', async () => {
    for (const input of [
      { status: 'failed' as const },
      { status: 'aborted' as const },
      { status: 'completed' as const, prompt: '' },
      { status: 'completed' as const, assistant: '' }
    ]) {
      const harness = await createHarness(input)
      expect(await harness.coordinator.distill('thread_1', 'turn_1')).toEqual([])
      expect(harness.requests).toHaveLength(0)
    }
    const disabled = await createHarness({ enabled: false })
    disabled.coordinator.schedule({ threadId: 'thread_1', turnId: 'turn_1', status: 'completed' })
    await vi.waitFor(() => expect(disabled.requests).toHaveLength(0))
  })

  it('schedules only completed turns and never propagates background failures', async () => {
    const harness = await createHarness({ output: '{invalid' })
    expect(harness.coordinator.schedule({
      threadId: 'thread_1',
      turnId: 'turn_1',
      status: 'failed'
    })).toBeUndefined()
    expect(harness.coordinator.schedule({
      threadId: 'thread_1',
      turnId: 'turn_1',
      status: 'aborted'
    })).toBeUndefined()
    expect(harness.coordinator.schedule({
      threadId: 'thread_1',
      turnId: 'turn_1',
      status: 'completed'
    })).toBeUndefined()
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1))
    await vi.waitFor(() => expect(harness.diagnostics).toHaveLength(1))
  })

  it('bounds extractor time and records a sanitized terminal failure', async () => {
    const harness = await createHarness({ timeout: true })
    expect(await harness.coordinator.distill('thread_1', 'turn_1')).toEqual([])
    expect(harness.diagnostics[0]).toContain('timed out')
    expect(await harness.memory.list({ all: true })).toHaveLength(0)
  })

  it('rejects invalid output and cross-scope comparison targets without writes', async () => {
    const invalid = await createHarness({ output: '{not-json' })
    expect(await invalid.coordinator.distill('thread_1', 'turn_1')).toEqual([])
    expect(await invalid.memory.list({ all: true })).toHaveLength(0)

    const forgedCandidate = JSON.parse(extraction()) as {
      candidates: Array<Record<string, unknown>>
    }
    forgedCandidate.candidates[0]!.observedAt = now
    const forged = await createHarness({ output: JSON.stringify(forgedCandidate) })
    expect(await forged.coordinator.distill('thread_1', 'turn_1')).toEqual([])
    expect(await forged.memory.list({ all: true })).toHaveLength(0)

    const unknownSource = await createHarness({
      output: extraction({ sourceIds: ['src_unknown'] })
    })
    expect(await unknownSource.coordinator.distill('thread_1', 'turn_1')).toEqual([])
    expect(await unknownSource.memory.list({ all: true })).toHaveLength(0)

    const crossScope = await createHarness({
      output: extraction({ comparisons: [{ memoryId: 'outside', relation: 'update' }] })
    })
    await crossScope.memory.createWithId('outside', {
      content: 'The user prefers concise release notes.',
      scope: 'user'
    })
    expect(await crossScope.coordinator.distill('thread_1', 'turn_1')).toEqual([])
    expect(await crossScope.memory.list({ all: true })).toHaveLength(1)
  })

  it('never opens an approval for transient or low-confidence extraction', async () => {
    for (const candidate of [
      { durability: 'transient', confidence: 0.9 },
      { durability: 'durable', confidence: 0.2 }
    ] as const) {
      const harness = await createHarness({
        output: extraction({
          durability: candidate.durability,
          confidence: candidate.confidence
        })
      })
      expect(await harness.coordinator.distill('thread_1', 'turn_1')).toEqual([])
      expect(await harness.memory.list({ all: true })).toHaveLength(0)
    }
  })

  it('applies update and supersede actions while preserving candidate sources', async () => {
    for (const action of ['update', 'supersede'] as const) {
      const harness = await createHarness({
        output: extraction({ comparisons: [{ memoryId: 'existing', relation: action }] })
      })
      await harness.memory.createWithId('existing', {
        content: 'The user prefers long release notes.',
        scope: 'workspace',
        workspace: 'D:/workspace-a',
        sources: [{
          id: 'old-source',
          kind: 'user',
          excerpt: 'Long notes.',
          trust: 'explicit-user'
        }]
      })
      const [pending] = await harness.coordinator.distill('thread_1', 'turn_1')
      expect(pending?.proposedAction.action).toBe(action)
      await harness.coordinator.decide(pending!.id, { decision: 'allow' }, 'D:/workspace-a')
      const records = await harness.memory.list({ all: true })
      const current = action === 'update'
        ? records.find((record) => record.id === 'existing')
        : records.find((record) => record.supersedes === 'existing')
      expect(current?.content).toBe('The user prefers concise release notes.')
      if (action === 'update') {
        expect(current?.sources.map((source) => source.id)).toContain('old-source')
      }
      expect(current?.sources.map((source) => source.trust))
        .toEqual(expect.arrayContaining(['explicit-user', 'inferred']))
      expect(current?.authority).toBe('reference')
    }
  })

  it('sanitizes paths and credentials while retaining useful ABI context', () => {
    expect(sanitizeMemoryDistillationDiagnostic(
      'failed C:\\Users\\Alice\\memory.db token=supersecret Node ABI 148 on win32 x64'
    )).toBe('failed [path] token=[redacted] Node ABI 148 on win32 x64')
    expect(sanitizeMemoryDistillationDiagnostic(
      'failed /home/alice/memory.db and file:///Users/alice/db'
    )).toBe('failed [path] and [path]')
  })
})

async function createHarness(options: {
  status?: 'completed' | 'failed' | 'aborted'
  prompt?: string
  assistant?: string
  output?: string
  enabled?: boolean
  timeout?: boolean
} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
  const memory = new FileMemoryStore({
    rootDir: join(dataDir, 'memory'),
    config: {
      enabled: true,
      scopes: ['user', 'workspace', 'project'],
      maxInjectedRecords: 8,
      distillation: { enabled: false }
    },
    nowIso: () => now
  })
  const requests: ModelRequest[] = []
  const model: ModelClient = {
    provider: 'test',
    model: 'test',
    async *stream(request) {
      requests.push(request)
      if (options.timeout) {
        await new Promise<void>((resolve, reject) => {
          request.abortSignal.addEventListener('abort', () => reject(request.abortSignal.reason), {
            once: true
          })
        })
      }
      yield {
        kind: 'assistant_text_delta',
        text: options.output ?? extraction()
      } satisfies ModelStreamChunk
      yield { kind: 'completed', stopReason: 'stop' } satisfies ModelStreamChunk
    }
  }
  const thread = makeThread(options)
  const threads = { get: async () => thread } as unknown as ThreadStore
  const pending = new MemoryDistillationPendingStore({ dataDir, nowIso: () => now })
  const diagnostics: string[] = []
  const coordinator = new MemoryDistillationCoordinator({
    threads,
    model,
    pending,
    memoryStore: () => memory,
    enabled: () => options.enabled !== false,
    nowIso: () => now,
    ...(options.timeout ? { timeoutMs: 5 } : {}),
    onDiagnostic: ({ message }) => diagnostics.push(message)
  })
  return { coordinator, memory, pending, requests, diagnostics }
}

function makeThread(options: {
  status?: 'completed' | 'failed' | 'aborted'
  prompt?: string
  assistant?: string
}): ThreadRecord {
  return {
    id: 'thread_1',
    title: 'Test',
    workspace: 'D:/workspace-a',
    model: 'thread-fallback',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    turns: [{
      id: 'turn_1',
      threadId: 'thread_1',
      status: options.status ?? 'completed',
      prompt: options.prompt ?? 'I prefer concise release notes.',
      model: 'old-model',
      actingModelRoute: {
        model: 'turn-model',
        providerId: 'provider-a',
        accountId: 'account-a'
      },
      createdAt: now,
      finishedAt: now,
      steering: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: [],
      orchestration: 'direct',
      attachmentIds: [],
      items: [{
        id: 'assistant_1',
        threadId: 'thread_1',
        turnId: 'turn_1',
        role: 'assistant',
        status: 'completed',
        kind: 'assistant_text',
        text: options.assistant ?? 'Understood. I will keep release notes concise.',
        createdAt: now,
        finishedAt: now
      }]
    }]
  } as unknown as ThreadRecord
}

function extraction(overrides: {
  comparisons?: Array<{ memoryId: string; relation: 'duplicate' | 'update' | 'supersede' }>
  durability?: 'durable' | 'transient'
  confidence?: number
  sourceIds?: string[]
} = {}): string {
  return JSON.stringify({
    candidates: [{
      content: 'The user prefers concise release notes.',
      type: 'preference',
      confidence: overrides.confidence ?? 0.9,
      importance: 0.7,
      tags: ['release'],
      sourceIds: overrides.sourceIds ?? [
        sourceId('user', 'I prefer concise release notes.'),
        sourceId('inference', 'Understood. I will keep release notes concise.')
      ],
      durability: overrides.durability ?? 'durable',
      comparisons: overrides.comparisons ?? []
    }]
  })
}

function sourceId(kind: 'user' | 'inference', text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex')
  return `src_${kind}_${hash.slice(0, 20)}`
}
