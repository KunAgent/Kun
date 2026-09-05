import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  emptyQueuedMessageRegistry,
  forgetQueuedMessagesForThread,
  queuedMessagesForThread,
  readQueuedMessageRegistry,
  reconcileQueuedMessages,
  saveQueuedMessagesForThread
} from './queued-message-persistence'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

class ThrowingStorage implements BrowserStorageLike {
  getItem(_key: string): string | null {
    return null
  }

  setItem(_key: string, _value: string): void {
    throw new Error('quota exceeded')
  }

  removeItem(_key: string): void {
    throw new Error('quota exceeded')
  }
}

describe('queued-message-persistence', () => {
  it('keeps valid queued execution settings and drops unknown policy values', () => {
    const storage = new MemoryStorage()
    saveQueuedMessagesForThread('thread-c', [
      {
        id: 'q-snap',
        text: 'run with frozen approval',
        deliveryState: 'pending',
        approvalPolicy: 'never',
        sandboxMode: 'read-only',
        approvalReviewer: 'agent'
      }
    ], storage)
    saveQueuedMessagesForThread('thread-d', [
      {
        id: 'q-bad',
        text: 'run with corrupted snapshot',
        deliveryState: 'pending',
        approvalPolicy: 'yolo',
        sandboxMode: 'root',
        approvalReviewer: 'skynet'
      }
    ] as unknown as Parameters<typeof saveQueuedMessagesForThread>[1], storage)

    expect(queuedMessagesForThread('thread-c', storage)).toEqual([
      expect.objectContaining({
        id: 'q-snap',
        approvalPolicy: 'never',
        sandboxMode: 'read-only',
        approvalReviewer: 'agent'
      })
    ])
    const normalizedBad = queuedMessagesForThread('thread-d', storage)
    expect(normalizedBad).toHaveLength(1)
    expect(normalizedBad[0]).not.toHaveProperty('approvalPolicy')
    expect(normalizedBad[0]).not.toHaveProperty('sandboxMode')
    expect(normalizedBad[0]).not.toHaveProperty('approvalReviewer')
  })

  it('restores pending messages independently for each thread', () => {
    const storage = new MemoryStorage()
    saveQueuedMessagesForThread('thread-a', [
      {
        id: 'q-1',
        text: 'finish the first change',
        clientRequestId: 'turn_client_1',
        deliveryState: 'pending',
        serviceTier: 'priority',
        messageSource: 'design_continuation',
        designImagePlacementTarget: {
          shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect'
        },
        fileReferences: [{
          path: '/workspace/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx'
        }]
      }
    ], storage)
    saveQueuedMessagesForThread('thread-b', [
      {
        id: 'q-2',
        text: 'review the result',
        deliveryState: 'pending',
        writeContext: {
          workspaceRoot: '/workspace/deepseek-gui',
          activeFilePath: '/workspace/deepseek-gui/draft.md',
          documentEpoch: 4,
          contentRevision: 2,
          whiteboardId: 'wb_1',
          whiteboardRevision: 3,
          expectedSha256: 'a'.repeat(64),
          threadId: 'thread-b'
        }
      }
    ], storage)

    expect(queuedMessagesForThread('thread-a', storage)).toEqual([
      expect.objectContaining({
        id: 'q-1',
        text: 'finish the first change',
        clientRequestId: 'turn_client_1',
        deliveryState: 'pending',
        serviceTier: 'priority',
        messageSource: 'design_continuation',
        designImagePlacementTarget: {
          shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect'
        },
        fileReferences: [expect.objectContaining({ relativePath: 'src/App.tsx' })]
      })
    ])
    expect(queuedMessagesForThread('thread-b', storage)).toEqual([
      expect.objectContaining({
        id: 'q-2',
        deliveryState: 'pending',
        writeContext: {
          workspaceRoot: '/workspace/deepseek-gui',
          activeFilePath: '/workspace/deepseek-gui/draft.md',
          documentEpoch: 4,
          contentRevision: 2,
          whiteboardId: 'wb_1',
          whiteboardRevision: 3,
          expectedSha256: 'a'.repeat(64),
          threadId: 'thread-b'
        }
      })
    ])
  })

  it('rejects a writeContext whose expectedSha256 is not a 64-char hex digest', () => {
    const storage = new MemoryStorage()
    saveQueuedMessagesForThread('thread-a', [
      {
        id: 'q-badsha',
        text: 'stale write send',
        deliveryState: 'pending',
        writeContext: {
          workspaceRoot: '/workspace/deepseek-gui',
          activeFilePath: '/workspace/deepseek-gui/draft.md',
          documentEpoch: 4,
          contentRevision: 2,
          expectedSha256: 'not-a-sha',
          threadId: 'thread-a'
        }
      }
    ], storage)
    expect(queuedMessagesForThread('thread-a', storage)).toEqual([])
  })

  it('consumes an in-flight row once its turn starts running', () => {
    const inFlight = [{
      id: 'q-running',
      text: 'complete the queued task',
      deliveryState: 'in_flight' as const,
      deliveryTurnId: 'turn-2',
      deliveryUserMessageItemId: 'user-2'
    }]

    expect(reconcileQueuedMessages(inFlight, {
      busy: true,
      turnId: 'turn-2'
    })).toEqual([])
    expect(reconcileQueuedMessages(inFlight, {
      busy: true,
      turnId: 'turn-2',
      blocks: [{ id: 'user-2', kind: 'user', text: 'complete the queued task' }]
    })).toEqual([])
  })

  it('keeps a later queued row while an earlier turn is still running', () => {
    const laterQueued = [{
      id: 'q-later',
      text: 'second queued task',
      deliveryState: 'in_flight' as const,
      deliveryTurnId: 'turn-3',
      deliveryUserMessageItemId: 'user-3'
    }]

    expect(reconcileQueuedMessages(laterQueued, {
      busy: true,
      turnId: 'turn-2',
      blocks: [{ id: 'user-2', kind: 'user', text: 'earlier task' }]
    })).toEqual(laterQueued)
  })

  it('removes a settled in-flight row once its user block is present in idle history', () => {
    const inFlight = [{
      id: 'q-running',
      text: 'complete the queued task',
      deliveryState: 'in_flight' as const,
      deliveryTurnId: 'turn-2',
      deliveryUserMessageItemId: 'user-2'
    }]

    expect(reconcileQueuedMessages(inFlight, {
      busy: false,
      turnId: null,
      blocks: [{ id: 'user-2', kind: 'user', text: 'complete the queued task' }]
    })).toEqual([])
  })

  it('requeues an in-flight marker when idle history has no proof it was accepted', () => {
    expect(reconcileQueuedMessages([{
      id: 'q-unconfirmed',
      text: 'retry safely',
      deliveryState: 'in_flight',
      deliveryTurnId: 'turn-missing',
      deliveryUserMessageItemId: 'user-missing'
    }], {
      busy: false,
      turnId: null,
      blocks: []
    })).toEqual([{
      id: 'q-unconfirmed',
      text: 'retry safely',
      deliveryState: 'pending'
    }])
  })

  it('returns an interrupted pre-send item to pending instead of losing it', () => {
    expect(reconcileQueuedMessages([{
      id: 'q-starting',
      text: 'do not lose me',
      deliveryState: 'starting'
    }], {
      busy: false,
      turnId: null
    })).toEqual([{
      id: 'q-starting',
      text: 'do not lose me',
      deliveryState: 'pending'
    }])
  })

  it('keeps paused messages across persistence and idle/running reconciliation', () => {
    const storage = new MemoryStorage()
    const paused = [{ id: 'q-paused', text: 'send later', deliveryState: 'paused' as const }]
    saveQueuedMessagesForThread('thread-a', paused, storage)

    expect(queuedMessagesForThread('thread-a', storage)).toEqual(paused)
    expect(reconcileQueuedMessages(paused, { busy: false, turnId: null })).toEqual(paused)
    expect(reconcileQueuedMessages(paused, { busy: true, turnId: 'turn-live' })).toEqual(paused)
  })

  it('keeps the server turn identity for runtime-owned paused rows', () => {
    const runtimeOwned = [{
      id: 'q-owned',
      text: 'admitted then interrupted',
      deliveryState: 'paused' as const,
      deliveryTurnId: 'turn-1',
      deliveryUserMessageItemId: 'item-1',
      clientRequestId: 'req-1'
    }]
    expect(reconcileQueuedMessages(runtimeOwned, { busy: false, turnId: null }))
      .toEqual(runtimeOwned)
    expect(reconcileQueuedMessages(runtimeOwned, { busy: true, turnId: 'turn-live' }))
      .toEqual(runtimeOwned)

    const localOnly = [{
      id: 'q-local',
      text: 'never admitted',
      deliveryState: 'paused' as const,
      deliveryTurnId: 'turn-stale',
      deliveryUserMessageItemId: 'item-stale'
    }]
    expect(reconcileQueuedMessages(localOnly, { busy: false, turnId: null })).toEqual([{ 
      id: 'q-local',
      text: 'never admitted',
      deliveryState: 'paused'
    }])
  })

  it('pauses interrupted rows while preserving runtime ownership markers', async () => {
    const { pauseQueuedMessagesForInterrupt } = await import('./queued-message-persistence')
    const input = [
      { id: 'q-admitted', text: 'one', deliveryState: 'in_flight' as const, deliveryTurnId: 'turn-1', clientRequestId: 'req-1' },
      { id: 'q-local', text: 'two', deliveryState: 'pending' as const, deliveryTurnId: 'turn-stale' },
      { id: 'q-failed', text: 'three', deliveryState: 'failed' as const }
    ]
    expect(pauseQueuedMessagesForInterrupt(input)).toEqual([
      { id: 'q-admitted', text: 'one', deliveryState: 'paused', deliveryTurnId: 'turn-1', clientRequestId: 'req-1' },
      { id: 'q-local', text: 'two', deliveryState: 'paused' },
      { id: 'q-failed', text: 'three', deliveryState: 'failed' }
    ])
  })

  it('does not treat paused messages as automatically sendable', async () => {
    const { isPendingQueuedMessage } = await import('./queued-message-persistence')
    expect(isPendingQueuedMessage({ id: 'q-paused', text: 'send later', deliveryState: 'paused' })).toBe(false)
  })

  it('forgets a deleted thread queue and ignores malformed storage', () => {
    const storage = new MemoryStorage()
    saveQueuedMessagesForThread('thread-a', [
      { id: 'q-1', text: 'pending', deliveryState: 'pending' }
    ], storage)
    forgetQueuedMessagesForThread('thread-a', storage)
    expect(readQueuedMessageRegistry(storage)).toEqual(emptyQueuedMessageRegistry())

    storage.setItem('kun.queuedMessages.v1', '{broken')
    expect(readQueuedMessageRegistry(storage)).toEqual(emptyQueuedMessageRegistry())

    storage.setItem('kun.queuedMessages.v1', JSON.stringify({
      version: 1,
      threads: {
        'thread-a': {
          messages: [{ id: 'q-bad', text: 'unsafe', writeContext: { threadId: 'thread-a' } }]
        }
      }
    }))
    expect(readQueuedMessageRegistry(storage)).toEqual(emptyQueuedMessageRegistry())

    storage.setItem('kun.queuedMessages.v1', JSON.stringify({
      version: 1,
      threads: {
        'thread-a': {
          messages: [{
            id: 'q-wrong-thread',
            text: 'unsafe',
            writeContext: {
              workspaceRoot: '/workspace/deepseek-gui',
              activeFilePath: '/workspace/deepseek-gui/draft.md',
              documentEpoch: 4,
              contentRevision: 2,
              threadId: 'thread-b'
            }
          }]
        }
      }
    }))
    expect(readQueuedMessageRegistry(storage)).toEqual(emptyQueuedMessageRegistry())
  })

  it('returns false when persistence fails instead of silently dropping the write', () => {
    const storage = new ThrowingStorage()
    expect(saveQueuedMessagesForThread('thread-a', [
      { id: 'q-1', text: 'pending', deliveryState: 'pending' }
    ], storage)).toBe(false)
  })

  it('reconciles a starting row to in_flight when the runtime still holds its turn', () => {
    expect(reconcileQueuedMessages([{
      id: 'q-crash',
      text: 'admitted before crash',
      deliveryState: 'starting',
      clientRequestId: 'req-1'
    }], {
      busy: true,
      turnId: 'turn-other'
    }, [
      { turnId: 'turn-queued', clientRequestId: 'req-1', position: 0 }
    ])).toEqual([{
      id: 'q-crash',
      text: 'admitted before crash',
      deliveryState: 'in_flight',
      clientRequestId: 'req-1',
      deliveryTurnId: 'turn-queued'
    }])
  })

  it('falls back to pending when the runtime queue does not hold the starting row', () => {
    expect(reconcileQueuedMessages([{
      id: 'q-crash',
      text: 'never reached runtime',
      deliveryState: 'starting',
      clientRequestId: 'req-1'
    }], {
      busy: false,
      turnId: null
    }, [])).toEqual([{
      id: 'q-crash',
      text: 'never reached runtime',
      deliveryState: 'pending',
      clientRequestId: 'req-1'
    }])
  })
})
