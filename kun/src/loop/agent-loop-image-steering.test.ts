import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { KunCapabilitiesConfig, type ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

class CapturingModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'image-steering-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'Done.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function testPng(): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer.writeUInt32BE(1, 16)
  buffer.writeUInt32BE(1, 20)
  return buffer
}

const modelCapabilities: ModelCapabilityMetadata = {
  id: 'image-steering-model',
  inputModalities: ['text', 'image'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text', 'image_url']
}

describe('AgentLoop image steering', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it.each([false, true])('persists guided image ids at the next model boundary (durable=%s)', async (durable) => {
    root = await mkdtemp(join(tmpdir(), 'kun-image-steering-'))
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-08-12T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const attachmentStore = new FileAttachmentStore({
      rootDir: join(root, 'attachments'),
      config: KunCapabilitiesConfig.parse({ attachments: { enabled: true } }).attachments,
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      attachmentStore: () => attachmentStore,
      ids,
      nowIso
    })
    const model = new CapturingModel()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model,
      modelCapabilities: () => modelCapabilities,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      attachmentStore,
      ids,
      nowIso
    })
    const threadId = 'thread_image_steering'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Image steering',
      titleAuto: false,
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'Create the first version.', model: model.model }
    })
    const image = await attachmentStore.create({
      name: 'reference.png',
      data: testPng()
    })

    await turns.steerTurn({
      threadId,
      turnId: started.turnId,
      ...(durable ? { operationId: 'image-guidance' } : {}),
      text: 'Use this image as the reference.',
      attachmentIds: [image.id]
    })
    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('completed')

    const request = model.requests.find((candidate) =>
      Object.values(candidate.messageAttachments ?? {}).some((attachments) =>
        attachments.images.some((attachment) => attachment.id === image.id)
      )
    )
    expect(Object.values(request?.messageAttachments ?? {})[0]?.images).toEqual([
      expect.objectContaining({ id: image.id, name: 'reference.png' })
    ])
    expect(request).toMatchObject({
      history: expect.arrayContaining([
        expect.objectContaining({
          kind: 'user_message',
          text: 'Use this image as the reference.',
          attachmentIds: [image.id]
        })
      ])
    })
    expect(await sessionStore.loadItems(threadId)).toContainEqual(expect.objectContaining({
      kind: 'user_message',
      text: 'Use this image as the reference.',
      attachmentIds: [image.id]
    }))
    if (!durable) expect(eventBus.snapshotSince(threadId, 0)).toContainEqual(expect.objectContaining({
      kind: 'turn_steered',
      attachmentIds: [image.id]
    }))
  })

  it('rejects documents and attachments outside the thread scope', async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-image-steering-reject-'))
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-08-12T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const attachmentStore = new FileAttachmentStore({
      rootDir: join(root, 'attachments'),
      config: KunCapabilitiesConfig.parse({ attachments: { enabled: true } }).attachments,
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      attachmentStore: () => attachmentStore,
      ids,
      nowIso
    })
    const threadId = 'thread_image_steering_reject'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Reject image steering',
      workspace: '/tmp/workspace',
      model: 'test-model'
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'Start.' } })
    const document = await attachmentStore.create({
      name: 'notes.txt',
      data: Buffer.from('notes'),
      mimeType: 'text/plain',
      documentText: 'notes'
    })
    const privateImage = await attachmentStore.create({
      name: 'private.png',
      data: testPng(),
      threadId: 'another_thread',
      workspace: '/another/workspace'
    })

    await expect(turns.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'Use the document.',
      attachmentIds: [document.id]
    })).rejects.toThrow('steering attachment must be an image')
    await expect(turns.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'Use the private image.',
      attachmentIds: [privateImage.id]
    })).rejects.toThrow('attachment is not authorized')

    expect(steering.peek(started.turnId)).toEqual([])
    expect(eventBus.snapshotSince(threadId, 0)
      .filter((event) => event.kind === 'turn_steered')).toEqual([])
    await turns.interruptTurn({ threadId, turnId: started.turnId })
  })
})
