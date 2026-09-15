import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryFeedbackConfig,
  MemoryFeedbackEvent,
  type MemoryConfirmRequest,
  type MemoryCorrectRequest
} from '../contracts/memory-feedback.js'
import { FileMemoryFeedbackStore, type MemoryFeedbackStore } from '../memory/memory-feedback-store.js'
import { MemoryFeedbackService, MemoryFeedbackServiceError } from '../memory/memory-feedback-service.js'
import { FileMemoryStore, type MemoryStore } from '../memory/memory-store.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import { ManagerRemoteMemoryFeedback } from './remote-memory-feedback.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const roots: string[] = []
const memoryConfig = MemoryCapabilityConfig.parse({ enabled: true })
const feedbackConfig = MemoryFeedbackConfig.parse({ enabled: true })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Manager memory feedback ownership', () => {
  it('keeps duplicate remote clients on one Manager-owned ledger', async () => {
    const manager = await managerHarness()
    try {
      const first = new ManagerRemoteMemoryFeedback(manager.connection, memoryConfig, feedbackConfig)
      const second = new ManagerRemoteMemoryFeedback(manager.connection, memoryConfig, feedbackConfig)
      const event = retrievedEvent()

      await expect(first.append(event)).resolves.toBe('appended')
      await expect(second.append(event)).resolves.toBe('replayed')
      await expect(second.aggregate(event.memoryId)).resolves.toMatchObject({ retrievalCount: 1 })
      await expect(first.diagnostics()).resolves.toMatchObject({ state: 'ready', eventCount: 1 })
    } finally {
      await manager.close()
    }
  })

  it('matches local and Manager-backed confirmation, correction, error, and aggregate behavior', async () => {
    const local = await localHarness()
    const manager = await managerHarness()
    try {
      const remoteMemory = new ManagerRemoteMemoryStore(manager.connection, memoryConfig)
      const remoteFeedback = new ManagerRemoteMemoryFeedback(
        manager.connection,
        memoryConfig,
        feedbackConfig
      )
      await remoteMemory.createWithId('mem_feedback_source', sourceMemory())

      const localResult = await exerciseFeedback(local.memory, local.feedback, local.confirm, local.correct)
      const remoteResult = await exerciseFeedback(
        remoteMemory,
        remoteFeedback,
        (request) => remoteFeedback.confirm(request),
        (request) => remoteFeedback.correct(request)
      )

      expect(remoteResult).toEqual(localResult)
    } finally {
      await manager.close()
    }
  })
})

async function exerciseFeedback(
  memory: MemoryStore,
  feedback: MemoryFeedbackStore,
  confirm: (request: MemoryConfirmRequest) => Promise<{ eventId: string; replayed: boolean }>,
  correct: (request: MemoryCorrectRequest) => Promise<{
    replacementMemoryId: string
    eventId: string
    replayed: boolean
  }>
) {
  await feedback.ready()
  await feedback.append(retrievedEvent())
  const confirmed = await confirm({ operationId: 'confirm_shared', memoryId: 'mem_feedback_source' })
  const corrected = await correct({
    operationId: 'correct_shared',
    memoryId: 'mem_feedback_source',
    replacement: { content: 'Use the corrected Manager-owned feedback path.' }
  })
  const replay = await correct({
    operationId: 'correct_shared',
    memoryId: 'mem_feedback_source',
    replacement: { content: 'Use the corrected Manager-owned feedback path.' }
  })
  let errorCode = ''
  try {
    await confirm({ operationId: 'confirm_missing', memoryId: 'mem_missing' })
  } catch (error) {
    expect(error).toBeInstanceOf(MemoryFeedbackServiceError)
    errorCode = (error as MemoryFeedbackServiceError).code
  }
  const active = await memory.retrieve({ query: 'corrected Manager feedback', limit: 5 })
  const aggregate = await feedback.aggregate('mem_feedback_source')
  const diagnostic = await feedback.diagnostics()
  return {
    confirmed: { eventId: confirmed.eventId, replayed: confirmed.replayed },
    corrected: {
      replacementMemoryId: corrected.replacementMemoryId,
      eventId: corrected.eventId,
      replayed: corrected.replayed
    },
    replayedCorrection: replay.replayed,
    errorCode,
    aggregate: aggregate && {
      retrievalCount: aggregate.retrievalCount,
      confirmationCount: aggregate.confirmationCount,
      correctionCount: aggregate.correctionCount
    },
    activeIds: active.map((record) => record.id),
    diagnostic: {
      state: diagnostic.state,
      eventCount: diagnostic.eventCount,
      aggregateCount: diagnostic.aggregateCount
    }
  }
}

async function localHarness() {
  const root = await temporaryRoot('kun-feedback-local-')
  const memory = new FileMemoryStore({ rootDir: join(root, 'memory'), config: memoryConfig })
  await memory.createWithId('mem_feedback_source', sourceMemory())
  const feedback = new FileMemoryFeedbackStore({ dataDir: root, config: feedbackConfig })
  const service = new MemoryFeedbackService({
    dataDir: root,
    memoryStore: memory,
    feedbackStore: feedback,
    config: feedbackConfig
  })
  return {
    memory,
    feedback,
    confirm: (request: MemoryConfirmRequest) => service.confirm(request),
    correct: (request: MemoryCorrectRequest) => service.correct(request)
  }
}

async function managerHarness() {
  const root = await temporaryRoot('kun-feedback-manager-')
  const store = await ManagerSharedDataStore.create(join(root, 'data'))
  const router = buildServiceManagerRouter({
    managerToken: 'manager-secret',
    instanceId: 'manager-feedback',
    startedAt: '2026-09-15T00:00:00.000Z',
    state: new ServiceManagerState(),
    sharedData: store
  })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  const connection: ServiceManagerConnection = {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-feedback',
      pid: process.pid,
      startedAt: '2026-09-15T00:00:00.000Z',
      host: '127.0.0.1',
      port: server.port,
      baseUrl: `http://127.0.0.1:${server.port}`,
      managerToken: 'manager-secret',
      serviceVersion: '0.1.0',
      dataDir: join(root, 'data'),
      settingsPath: join(root, 'settings.json')
    }
  }
  return {
    connection,
    close: async () => {
      await server.close()
      await store.close()
    }
  }
}

function sourceMemory() {
  return {
    content: 'Use the original feedback path.',
    scope: 'user' as const
  }
}

function retrievedEvent() {
  return MemoryFeedbackEvent.parse({
    schemaVersion: 1,
    id: 'retrieved_shared',
    kind: 'retrieved',
    memoryId: 'mem_feedback_source',
    occurredAt: '2026-09-15T00:00:00.000Z',
    threadId: 'thread_shared',
    turnId: 'turn_shared'
  })
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
