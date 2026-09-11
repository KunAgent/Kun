import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeAssistantTextItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import { appendTurnItem, createTurnRecord } from '../../domain/turn.js'
import { stripThreadItemBodies } from './hybrid-thread-projection.js'
import { HybridThreadDocumentRepository } from './hybrid-thread-documents.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('HybridThreadDocumentRepository cache budget', () => {
  it('redacts the prompt but retains the durable request fingerprint in metadata', () => {
    const thread = {
      ...createThreadRecord({
        id: 'thread_admission_projection',
        title: 'Admission projection',
        workspace: '/tmp/workspace',
        model: 'test',
        planBuildAdmissionFingerprint: 'b'.repeat(64),
        planBuildAdmissionCapabilityHash: 'c'.repeat(64)
      }),
      turns: [createTurnRecord({
        id: 'turn_admission_projection',
        threadId: 'thread_admission_projection',
        prompt: 'Durable plan-build prompt',
        clientRequestId: 'plan-build:run-1',
        clientRequestFingerprint: 'a'.repeat(64),
        status: 'completed'
      })]
    }

    const projection = stripThreadItemBodies(thread)
    expect(projection).toMatchObject({
      planBuildAdmissionFingerprint: 'b'.repeat(64),
      planBuildAdmissionCapabilityHash: 'c'.repeat(64)
    })
    expect(projection.turns).toEqual([
      expect.objectContaining({
        prompt: '',
        clientRequestId: 'plan-build:run-1',
        clientRequestFingerprint: 'a'.repeat(64)
      })
    ])
  })

  it('hydrates an oversized record without retaining it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-thread-cache-budget-'))
    roots.push(root)
    const threadId = 'thread_cache_budget'
    const dir = join(root, 'threads', threadId)
    await mkdir(dir, { recursive: true })
    const item = makeAssistantTextItem({
      id: 'assistant_large',
      threadId,
      turnId: 'turn_1',
      text: 'x'.repeat(4_096),
      status: 'completed'
    })
    const thread = {
      ...createThreadRecord({
        id: threadId,
        title: 'Cache budget',
        workspace: '/tmp/workspace',
        model: 'test'
      }),
      turns: [appendTurnItem(createTurnRecord({
        id: 'turn_1',
        threadId,
        prompt: 'test',
        status: 'completed'
      }), item)]
    }
    await writeFile(join(dir, 'metadata.jsonl'), `${JSON.stringify({
      kind: 'thread_metadata',
      version: 1,
      timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })}\n`)
    await writeFile(join(dir, 'messages.jsonl'), `${JSON.stringify(item)}\n`)
    const documents = new HybridThreadDocumentRepository(root, { cacheMaxBytes: 1_024 })

    expect(await documents.readThread(threadId)).toMatchObject({
      id: threadId,
      turns: [{ items: [{ id: item.id, text: 'x'.repeat(4_096) }] }]
    })
    expect(documents.cacheStats()).toEqual({
      entries: 0,
      bytes: 0,
      maxBytes: 1_024
    })
  })
})

describe('HybridThreadDocumentRepository incremental mirrors', () => {
  it('folds appended metadata and item tails instead of re-reading history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-thread-mirror-'))
    roots.push(root)
    const threadId = 'thread_incremental'
    const dir = join(root, 'threads', threadId)
    await mkdir(dir, { recursive: true })
    const metadataPath = join(dir, 'metadata.jsonl')
    const messagesPath = join(dir, 'messages.jsonl')
    const base = createThreadRecord({
      id: threadId,
      title: 'v1',
      workspace: '/tmp/workspace',
      model: 'test'
    })
    const line = (thread: typeof base): string => `${JSON.stringify({
      kind: 'thread_metadata',
      version: 1,
      timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })}\n`
    const item1 = makeAssistantTextItem({
      id: 'a1', threadId, turnId: 'turn_1', text: 'one', status: 'completed'
    })
    await writeFile(metadataPath, line(base))
    await writeFile(messagesPath, `${JSON.stringify(item1)}\n`)

    const documents = new HybridThreadDocumentRepository(root)
    expect((await documents.readLatestMetadata(threadId))?.title).toBe('v1')
    expect((await documents.readThread(threadId))?.turns.flatMap((turn) => turn.items).map((item) => item.id)).toEqual(['a1'])

    await appendFile(metadataPath, line({ ...base, title: 'v2' }))
    const item2 = makeAssistantTextItem({
      id: 'a2', threadId, turnId: 'turn_1', text: 'two', status: 'completed'
    })
    const item1Update = { ...item1, text: 'one-edited' }
    await appendFile(messagesPath, `${JSON.stringify(item2)}\n${JSON.stringify(item1Update)}\n`)

    expect((await documents.readLatestMetadata(threadId))?.title).toBe('v2')
    const record = await documents.readThread(threadId)
    const items = record?.turns.flatMap((turn) => turn.items) ?? []
    expect(items.map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(items[0]).toMatchObject({ id: 'a1', text: 'one-edited' })
  })

  it('re-reads after an atomic compaction rewrite shrinks the log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-thread-mirror-'))
    roots.push(root)
    const threadId = 'thread_compaction'
    const dir = join(root, 'threads', threadId)
    await mkdir(dir, { recursive: true })
    const metadataPath = join(dir, 'metadata.jsonl')
    const base = createThreadRecord({
      id: threadId,
      title: 'v1',
      workspace: '/tmp/workspace',
      model: 'test'
    })
    const line = (thread: typeof base): string => `${JSON.stringify({
      kind: 'thread_metadata',
      version: 1,
      timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })}\n`
    await writeFile(metadataPath, line(base) + line({ ...base, title: 'v2' }))

    const documents = new HybridThreadDocumentRepository(root)
    expect((await documents.readLatestMetadata(threadId))?.title).toBe('v2')

    const tmpPath = `${metadataPath}.tmp`
    await writeFile(tmpPath, line({ ...base, title: 'compacted' }))
    await rename(tmpPath, metadataPath)

    expect((await documents.readLatestMetadata(threadId))?.title).toBe('compacted')
  })
})
