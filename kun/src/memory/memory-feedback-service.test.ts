import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryFeedbackConfig, type MemoryCorrectRequest } from '../contracts/memory-feedback.js'
import { FileMemoryFeedbackStore } from './memory-feedback-store.js'
import { MemoryFeedbackService, MemoryFeedbackServiceError } from './memory-feedback-service.js'
import { FileMemoryStore } from './memory-store.js'

const roots: string[] = []
const memoryConfig = MemoryCapabilityConfig.parse({ enabled: true })
const feedbackConfig = MemoryFeedbackConfig.parse({ enabled: true })
const disabledFeedback = MemoryFeedbackConfig.parse({ enabled: false })
const NOW = '2026-09-15T03:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MemoryFeedbackService confirmation', () => {
  it('records only an explicit confirmation and replays a stable operation once', async () => {
    const harness = await createHarness()
    await harness.memories.createWithId('mem_confirm', {
      content: 'Explicit confirmation fixture', scope: 'workspace', workspace: 'workspace-a'
    })
    await harness.memories.retrieve({ query: 'confirmation fixture', workspace: 'workspace-a', limit: 3 })
    await harness.memories.list({ workspace: 'workspace-a' })
    expect(await harness.feedback.aggregate('mem_confirm')).toBeUndefined()

    const request = {
      operationId: 'confirm-operation-1',
      memoryId: 'mem_confirm',
      access: { workspace: 'workspace-a' }
    }
    expect((await harness.service.confirm(request)).replayed).toBe(false)
    expect((await harness.service.confirm(request)).replayed).toBe(true)
    expect(await harness.feedback.aggregate('mem_confirm')).toMatchObject({ confirmationCount: 1, retrievalCount: 0 })
  })

  it('rejects disabled, inactive, and out-of-scope confirmation', async () => {
    const harness = await createHarness()
    await harness.memories.createWithId('mem_disabled', {
      content: 'Inactive confirmation fixture', scope: 'workspace', workspace: 'workspace-a', disabled: true
    })
    await expect(harness.service.confirm({
      operationId: 'confirm-inactive', memoryId: 'mem_disabled', access: { workspace: 'workspace-a' }
    })).rejects.toMatchObject({ code: 'inactive' })
    await expect(harness.service.confirm({
      operationId: 'confirm-other-scope', memoryId: 'mem_disabled', access: { workspace: 'workspace-b' }
    })).rejects.toMatchObject({ code: 'not-found' })

    const disabled = new MemoryFeedbackService({
      dataDir: harness.root,
      memoryStore: harness.memories,
      feedbackStore: harness.feedback,
      config: disabledFeedback,
      nowIso: () => NOW
    })
    await expect(disabled.confirm({
      operationId: 'confirm-disabled', memoryId: 'mem_disabled', access: { workspace: 'workspace-a' }
    })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await harness.feedback.aggregate('mem_disabled')).toBeUndefined()
  })
})

describe('MemoryFeedbackService correction', () => {
  it('creates one same-scope superseding version and preserves the old record', async () => {
    const harness = await createHarness()
    await harness.memories.createWithId('mem_old', {
      content: 'Use fixture port 4100', scope: 'workspace', workspace: 'workspace-a',
      tags: ['port'], importance: 0.7
    })
    const oldPath = join(harness.root, 'memory', 'mem_old.json')
    const oldBefore = JSON.parse(await readFile(oldPath, 'utf8')) as { content: string }
    const request = correctionRequest('correct-operation-1')

    const first = await harness.service.correct(request)
    expect(first.replayed).toBe(false)
    const second = await harness.service.correct(request)
    expect(second).toMatchObject({ replacementMemoryId: first.replacementMemoryId, replayed: true })

    const all = await harness.memories.list({ workspace: 'workspace-a', includeDeleted: true })
    const previous = all.find((memory) => memory.id === 'mem_old')
    const replacement = all.find((memory) => memory.id === first.replacementMemoryId)
    expect(previous).toMatchObject({ content: oldBefore.content, supersededAt: NOW })
    expect(replacement).toMatchObject({
      content: 'Use fixture port 4200', scope: 'workspace', workspace: previous?.workspace,
      supersedes: 'mem_old', authority: 'reference'
    })
    expect((await harness.memories.retrieve({ query: 'fixture port 4200', workspace: 'workspace-a', limit: 3 }))
      .map((memory) => memory.id)).toEqual([first.replacementMemoryId])
    expect(await harness.feedback.aggregate('mem_old')).toMatchObject({ correctionCount: 1 })
    const receiptName = (await readdir(join(harness.root, 'memory-feedback-corrections')))[0]!
    const completedReceipt = await readFile(join(harness.root, 'memory-feedback-corrections', receiptName), 'utf8')
    expect(completedReceipt).not.toContain('Use fixture port 4200')
    expect(JSON.parse(completedReceipt)).not.toHaveProperty('request')
  })

  it('rejects cross-scope, inactive, and conflicting correction operations', async () => {
    const harness = await createHarness()
    await harness.memories.createWithId('mem_scope', {
      content: 'Scoped correction fixture', scope: 'workspace', workspace: 'workspace-a'
    })
    await expect(harness.service.correct({
      ...correctionRequest('correct-wrong-scope', 'mem_scope'),
      access: { workspace: 'workspace-b' }
    })).rejects.toMatchObject({ code: 'not-found' })

    await harness.memories.update('mem_scope', { disabled: true }, { workspace: 'workspace-a' })
    await expect(harness.service.correct(correctionRequest('correct-inactive', 'mem_scope')))
      .rejects.toMatchObject({ code: 'inactive' })
    await harness.memories.update('mem_scope', { disabled: false }, { workspace: 'workspace-a' })

    await harness.service.correct(correctionRequest('correct-conflict', 'mem_scope'))
    await expect(harness.service.correct({
      ...correctionRequest('correct-conflict', 'mem_scope'),
      replacement: { content: 'Different correction payload' }
    })).rejects.toMatchObject({ code: 'id-conflict' })
  })

  it.each(['prepared', 'canonical', 'feedback'] as const)(
    'reconciles an interruption after the %s boundary without duplicate versions or events',
    async (boundary) => {
      const harness = await createHarness()
      const memoryId = `mem_interrupt_${boundary}`
      await harness.memories.createWithId(memoryId, {
        content: 'Original interruption fixture', scope: 'workspace', workspace: 'workspace-a'
      })
      let interrupted = false
      const failOnce = async () => {
        if (interrupted) return
        interrupted = true
        throw new Error(`interrupt after ${boundary}`)
      }
      const interruptedService = new MemoryFeedbackService({
        dataDir: harness.root,
        memoryStore: harness.memories,
        feedbackStore: harness.feedback,
        config: feedbackConfig,
        nowIso: () => NOW,
        ...(boundary === 'prepared' ? { afterReceiptPrepared: failOnce } : {}),
        ...(boundary === 'canonical' ? { afterCanonicalMutation: failOnce } : {}),
        ...(boundary === 'feedback' ? { afterFeedbackAppend: failOnce } : {})
      })
      const request = correctionRequest(`correct-interrupt-${boundary}`, memoryId)
      await expect(interruptedService.correct(request)).rejects.toThrow(`interrupt after ${boundary}`)

      const restartedFeedback = new FileMemoryFeedbackStore({
        dataDir: harness.root, config: feedbackConfig
      })
      const restarted = new MemoryFeedbackService({
        dataDir: harness.root,
        memoryStore: harness.memories,
        feedbackStore: restartedFeedback,
        config: feedbackConfig,
        nowIso: () => '2026-09-15T04:00:00.000Z'
      })
      await restarted.ready()
      const result = await restarted.correct(request)
      const records = await harness.memories.list({ workspace: 'workspace-a', includeDeleted: true })
      expect(records.filter((memory) => memory.supersedes === memoryId)).toHaveLength(1)
      expect((await restartedFeedback.aggregate(memoryId))?.correctionCount).toBe(1)
      expect(result.replayed).toBe(true)
    }
  )

  it('uses a bounded typed service error', () => {
    expect(new MemoryFeedbackServiceError('unauthorized', 'denied')).toMatchObject({
      name: 'MemoryFeedbackServiceError', code: 'unauthorized', message: 'denied'
    })
  })
})

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-feedback-service-'))
  roots.push(root)
  const memories = new FileMemoryStore({
    rootDir: join(root, 'memory'), config: memoryConfig, nowIso: () => NOW
  })
  const feedback = new FileMemoryFeedbackStore({
    dataDir: root, config: feedbackConfig, nowIso: () => NOW
  })
  const service = new MemoryFeedbackService({
    dataDir: root, memoryStore: memories, feedbackStore: feedback,
    config: feedbackConfig, nowIso: () => NOW
  })
  return { root, memories, feedback, service }
}

function correctionRequest(operationId: string, memoryId = 'mem_old'): MemoryCorrectRequest {
  return {
    operationId,
    memoryId,
    access: { workspace: 'workspace-a' },
    replacement: { content: 'Use fixture port 4200' }
  }
}
