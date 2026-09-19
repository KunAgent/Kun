import { describe, expect, it } from 'vitest'
import {
  AgentCapacitySnapshotSchema,
  createExtensionContext,
  ExtensionHostClient,
  isExtensionViewSafeMethod,
  PermissionSchema,
  RoomEventSchema,
  RoomEventsListRequestSchema,
  RoomListRequestSchema,
  RoomMessageSchema,
  RoomMessagesListRequestSchema,
  RoomSummarySchema,
  RoomTasksListRequestSchema,
  RoomTaskSummarySchema,
  type HostNotification,
  type HostTransport,
  type JsonValue
} from '../src/index.js'

const timestamp = '2026-09-13T00:00:00.000Z'
const capacity = { activeTurns: 2, queuedTurns: 3, maxConcurrentTurns: 4, busy: true }
const taskCounts = {
  queued: 0, waiting_dependency: 0, running: 1, needs_input: 0, needs_approval: 0,
  recovery_required: 0, stopping: 0, awaiting_acceptance: 0, completed: 2, failed: 0, cancelled: 0
}
const room = {
  id: 'room-1', name: 'App work', collaborationMode: 'peer', updatedAt: timestamp,
  memberCount: 2, taskCounts
}
const message = {
  id: 'message-1', authorMemberId: 'member-1', authorDisplayName: 'Developer', body: 'Ready',
  createdAt: timestamp, mentionedMemberIds: ['member-2'],
  attachments: [{ id: 'attachment-1', displayName: 'preview.png' }]
}
const task = {
  id: 'task-1', status: 'running', title: 'Build preview', memberId: 'member-1',
  repositoryDisplayName: 'App', updatedAt: timestamp
}
const event = {
  type: 'task.updated', sequence: 4, timestamp, roomId: 'room-1',
  payload: { id: 'task-1' }
}

class TestTransport implements HostTransport {
  readonly requests: Array<{ method: string; params?: JsonValue }> = []
  readonly responses = new Map<string, unknown>([
    ['agent.capacity', capacity],
    ['rooms.list', { items: [room], page: { hasMore: false } }],
    ['rooms.listMessages', { items: [message], page: { hasMore: false } }],
    ['rooms.listTasks', { items: [task], page: { hasMore: false } }],
    ['rooms.listEvents', { items: [event], cursor: 5, hasMore: false }]
  ])

  async request(method: string, params?: JsonValue): Promise<unknown> {
    this.requests.push({ method, params })
    return this.responses.get(method)
  }
  notify(): void {}
  onNotification(_listener: (notification: HostNotification) => void) { return { dispose() {} } }
  registerHandler() { return { dispose() {} } }
  dispose(): void {}
}

describe('Global capacity and read-only rooms SDK', () => {
  it('validates both declared read scopes and permits their broker methods in views', () => {
    expect(PermissionSchema.parse('agent.capacity.read')).toBe('agent.capacity.read')
    expect(PermissionSchema.parse('rooms.read')).toBe('rooms.read')
    for (const method of ['agent.capacity', 'rooms.list', 'rooms.listMessages', 'rooms.listTasks', 'rooms.listEvents']) {
      expect(isExtensionViewSafeMethod(method)).toBe(true)
    }
    for (const method of ['rooms.send', 'rooms.create', 'rooms.cancelTask', 'rooms.approve']) {
      expect(isExtensionViewSafeMethod(method)).toBe(false)
    }
  })

  it('validates capacity counters without permitting runtime identities or unsafe values', () => {
    expect(AgentCapacitySnapshotSchema.parse(capacity)).toEqual(capacity)
    for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(AgentCapacitySnapshotSchema.safeParse({ ...capacity, activeTurns: value }).success).toBe(false)
      expect(AgentCapacitySnapshotSchema.safeParse({ ...capacity, queuedTurns: value }).success).toBe(false)
      expect(AgentCapacitySnapshotSchema.safeParse({ ...capacity, maxConcurrentTurns: value }).success).toBe(false)
    }
    expect(AgentCapacitySnapshotSchema.safeParse({ ...capacity, maxConcurrentTurns: 0 }).success).toBe(false)
    expect(AgentCapacitySnapshotSchema.safeParse({ ...capacity, turnIds: ['private-turn'] }).success).toBe(false)
  })

  it('enforces finite bounded pages and method-specific cursors', () => {
    expect(RoomListRequestSchema.parse({})).toEqual({ limit: 50 })
    expect(RoomEventsListRequestSchema.parse({ roomId: 'room-1' })).toEqual({ roomId: 'room-1', after: 0, limit: 50 })
    const schemas = [RoomListRequestSchema, RoomMessagesListRequestSchema, RoomTasksListRequestSchema, RoomEventsListRequestSchema]
    for (const [index, schema] of schemas.entries()) {
      const input = index === 0 ? {} : { roomId: 'room-1' }
      for (const limit of [-1, 0, 0.5, 101, Infinity, NaN]) {
        expect(schema.safeParse({ ...input, limit }).success).toBe(false)
      }
      expect(schema.safeParse({ ...input, limit: 100 }).success).toBe(true)
      expect(schema.safeParse({ ...input, token: 'private' }).success).toBe(false)
    }
    expect(RoomListRequestSchema.safeParse({ cursor: 'eyJwaW5uZWQiOjB9' }).success).toBe(true)
    expect(RoomListRequestSchema.safeParse({ cursor: '/Users/private' }).success).toBe(false)
    for (const cursor of ['-1', '1.5', '1e3', '01', 'Infinity', '9007199254740992']) {
      expect(RoomMessagesListRequestSchema.safeParse({ roomId: 'room-1', cursor }).success).toBe(false)
      expect(RoomTasksListRequestSchema.safeParse({ roomId: 'room-1', cursor }).success).toBe(false)
    }
    expect(RoomEventsListRequestSchema.safeParse({ roomId: 'room-1', after: Infinity }).success).toBe(false)
    expect(RoomEventsListRequestSchema.safeParse({ roomId: 'room-1', after: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false)
    expect(RoomTasksListRequestSchema.safeParse({ roomId: 'room-1', status: 'unknown' }).success).toBe(false)
  })

  it('rejects internal room, message, attachment, task and event fields', () => {
    expect(RoomSummarySchema.safeParse({ ...room, repositories: [] }).success).toBe(false)
    expect(RoomSummarySchema.safeParse({ ...room, taskCounts: { ...taskCounts, leaseCount: 1 } }).success).toBe(false)
    expect(RoomMessageSchema.safeParse({ ...message, requestFingerprint: 'private' }).success).toBe(false)
    expect(RoomMessageSchema.safeParse({
      ...message, attachments: [{ ...message.attachments[0], localFilePath: '/Users/private.png' }]
    }).success).toBe(false)
    expect(RoomMessageSchema.safeParse({
      ...message, attachments: [{ id: '/Users/private.png', displayName: 'preview.png' }]
    }).success).toBe(false)
    expect(RoomTaskSummarySchema.safeParse({ ...task, executionThreadId: 'private' }).success).toBe(false)
    expect(RoomTaskSummarySchema.safeParse({ ...task, repositoryDisplayPath: '/Users/private' }).success).toBe(false)
    expect(RoomEventSchema.safeParse({ ...event, type: 'turn.started' }).success).toBe(false)
    expect(RoomEventSchema.safeParse({ ...event, payload: { id: 'task-1', prompt: 'private' } }).success).toBe(false)
    expect(RoomEventSchema.safeParse({ ...event, payload: { id: 'task-1', lease: {} } }).success).toBe(false)
  })

  it('wires context and client to validated capacity and rooms RPCs', async () => {
    const transport = new TestTransport()
    const client = new ExtensionHostClient(transport)
    const context = createExtensionContext(transport, {
      extension: { id: 'example.reader', publisher: 'example', name: 'reader', version: '1.0.0' },
      apiVersion: '1.5.0', capabilities: ['agent.capacity', 'rooms.read'],
      permissions: ['agent.capacity.read', 'rooms.read'], activationEvent: 'onStartup'
    }, client)
    expect(context.rooms).toBe(client.rooms)
    await expect(context.agent.capacity()).resolves.toEqual(capacity)
    await expect(context.rooms.list()).resolves.toEqual({ items: [room], page: { hasMore: false } })
    await expect(context.rooms.listMessages({ roomId: 'room-1', cursor: '9', limit: 2 }))
      .resolves.toEqual({ items: [message], page: { hasMore: false } })
    await expect(context.rooms.listTasks({ roomId: 'room-1', status: 'running' }))
      .resolves.toEqual({ items: [task], page: { hasMore: false } })
    await expect(context.rooms.listEvents({ roomId: 'room-1' }))
      .resolves.toEqual({ items: [event], cursor: 5, hasMore: false })
    expect(transport.requests).toEqual([
      { method: 'agent.capacity', params: {} },
      { method: 'rooms.list', params: { limit: 50 } },
      { method: 'rooms.listMessages', params: { roomId: 'room-1', cursor: '9', limit: 2 } },
      { method: 'rooms.listTasks', params: { roomId: 'room-1', status: 'running', limit: 50 } },
      { method: 'rooms.listEvents', params: { roomId: 'room-1', after: 0, limit: 50 } }
    ])
    await context.subscriptions.dispose()
  })

  it('rejects invalid RPC responses and never dispatches invalid request pages', async () => {
    const transport = new TestTransport()
    const client = new ExtensionHostClient(transport)
    expect(() => client.rooms.list({ limit: Infinity })).toThrow()
    expect(transport.requests).toEqual([])
    transport.responses.set('agent.capacity', { ...capacity, threads: ['private'] })
    await expect(client.agent.capacity()).rejects.toThrow()
    transport.responses.set('rooms.list', { items: [{ ...room, prompt: 'private' }], page: { hasMore: false } })
    await expect(client.rooms.list()).rejects.toThrow()
    transport.responses.set('rooms.listEvents', {
      items: [{ ...event, payload: { id: 'task-1', toolResult: 'private' } }], cursor: 4, hasMore: false
    })
    await expect(client.rooms.listEvents({ roomId: 'room-1' })).rejects.toThrow()
    client.dispose()
  })
})
