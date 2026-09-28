import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { RoomRunRecordSchema } from '../contracts/room-runs.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { resolveWorkbenchPolicy, type AgentWorkbenchPolicy } from '../contracts/workbench-policy.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { bindRoomPeerStore } from '../rooms/room-peer-tools.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { RoomService, putRoomDocument } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { WorkbenchBridge, bindWorkbenchBridge } from './bridge.js'
import { workbenchCodeTools } from './code-tools.js'
import { workbenchWorkTools } from './work-tools.js'

export type StubThread = Pick<ThreadRecord, 'id' | 'workspace' | 'title' | 'status' | 'updatedAt'> & Partial<ThreadRecord>

/** Doubles for the runtime services the bridge touches; each test scripts what it needs. */
export function stubServices() {
  const threads = new Map<string, ThreadRecord>()
  const calls = { enqueued: [] as Array<{ threadId: string; request: Record<string, unknown> }>, interrupted: [] as string[],
    steered: [] as Array<Record<string, unknown>>, created: [] as Array<Record<string, unknown>> }
  const services = {
    threads: {
      list: async () => [...threads.values()],
      getMetadata: async (id: string) => threads.get(id) ?? null,
      get: async (id: string) => threads.get(id) ?? null,
      create: async (request: Record<string, unknown>, options: { id?: string; workbenchOrigin?: ThreadRecord['workbenchOrigin'] } = {}) => {
        calls.created.push({ request, options })
        const thread = createThreadRecord({ id: options.id ?? 'thread-' + threads.size, title: String(request.title), workspace: String(request.workspace),
          model: String(request.model), agentSurface: request.agentSurface as 'code' | 'write', mode: request.mode as 'agent' | 'plan',
          workbenchOrigin: options.workbenchOrigin, approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
        threads.set(thread.id, thread)
        return thread
      },
      update: async (id: string, patch: Partial<ThreadRecord>) => {
        const next = { ...threads.get(id)!, ...patch }
        threads.set(id, next)
        return next
      }
    },
    turns: {
      enqueueTurn: async (input: { threadId: string; request: Record<string, unknown> }) => {
        calls.enqueued.push(input)
        const thread = threads.get(input.threadId)!
        const turn = createTurnRecord({ id: 'turn-' + (thread.turns.length + 1), threadId: thread.id, prompt: String(input.request.prompt),
          clientRequestId: String(input.request.clientRequestId), status: 'queued' })
        thread.turns.push(turn)
        return { threadId: thread.id, turnId: turn.id }
      },
      interruptTurn: async (input: { threadId: string; turnId: string }) => {
        calls.interrupted.push(input.turnId)
        const turn = threads.get(input.threadId)!.turns.find((item) => item.id === input.turnId)!
        turn.status = 'aborted'
        return { status: 'aborted' }
      },
      cancelQueuedTurn: async (input: { threadId: string; turnId: string }) => {
        calls.interrupted.push(input.turnId)
        threads.get(input.threadId)!.turns.find((item) => item.id === input.turnId)!.status = 'aborted'
        return { status: 'aborted' }
      },
      steerTurn: async (input: Record<string, unknown>) => { calls.steered.push(input) }
    },
    sessions: { loadItems: async () => [] as unknown[], searchItemText: undefined },
    approvals: { pending: () => [] as Array<{ summary: string; toolName: string }> },
    inputs: { pending: () => [] as Array<{ prompt: string; questions: Array<{ question: string }> }> }
  }
  return { threads, calls, services }
}

export type WorkbenchFixtureOptions = {
  policy?: Partial<AgentWorkbenchPolicy>
  /** Directory limits; a function receives the fixture's temp directory. */
  allowedRoots?: string[] | ((directory: string) => string[])
  fresh?: boolean
}

/** A private Agent conversation with a running turn, a recorded run, and a bound bridge. */
export async function workbenchFixture(options: WorkbenchFixtureOptions = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'workbench-')))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const service = new RoomService(store, () => {})
  const stub = stubServices()
  const member = { id: 'agent-member', displayName: 'Bot', participantAgentId: 'agent-1', presetId: 'general',
    role: 'developer' as const, roleNotes: '', enabled: true, revision: 0, allowedRepositoryIds: [] }
  const room = (await service.create({ clientRequestId: 'create-room', name: 'Bot', members: [member] },
    { id: 'private-room', conversationKind: 'user_agent' })).room
  const now = new Date().toISOString()
  await store.commit({ requestId: 'seed-agent', checks: [{ kind: 'agent_identity', id: 'agent-1', expectedRevision: null }],
    puts: [{ kind: 'agent_identity', id: 'agent-1', value: AgentIdentitySchema.parse({
      schemaVersion: 1, id: 'agent-1', name: 'Bot', revision: 0, createdAt: now, updatedAt: now,
      ...(options.allowedRoots ? { allowedRepositoryRoots: typeof options.allowedRoots === 'function' ? options.allowedRoots(directory) : options.allowedRoots } : {}),
      workbench: resolveWorkbenchPolicy(options.policy) }) }] })
  const wakes = { count: 0 }
  const deps = { store, dataDir: directory, model: () => ({ model: 'test-model', providerId: 'p1' }), profiles: () => ({}),
    threadStore: new InMemoryThreadStore(), ...stub.services } as unknown as RoomRuntimeDeps
  const bridge = new WorkbenchBridge(deps, service, () => { wakes.count++ })
  bindRoomPeerStore(deps.threadStore, store)
  bindWorkbenchBridge(deps.threadStore, bridge)
  const thread = createThreadRecord({ id: 'conv-thread', title: 'Bot', workspace: directory, model: 'test',
    roomContext: { roomId: room.id, memberId: member.id, participantAgentId: 'agent-1', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
  thread.turns.push(createTurnRecord({ id: 'turn-1', threadId: thread.id, prompt: 'do it', clientRequestId: 'req-1', status: 'running' }))
  await deps.threadStore.upsert(thread)
  const runId = roomRunId(room.id, 'req-1')
  await putRoomDocument(store, 'room_run', runId, room.id, RoomRunRecordSchema.parse({
    id: runId, roomId: room.id, memberId: member.id, memberLabel: 'Bot', participantAgentId: 'agent-1', phase: 'conversation',
    attempt: 1, clientRequestId: 'req-1', threadId: thread.id, turnId: 'turn-1', input: 'do it', attachmentIds: [], status: 'running',
    communicationRequired: options.fresh ?? true, createdAt: now, updatedAt: now }), null)
  const context = (toolCallId = 'call-1'): ToolHostContext => ({ threadId: thread.id, turnId: 'turn-1', workspace: directory,
    sandboxMode: 'workspace-write', approvalPolicy: 'auto', threadMode: 'agent', roomStepKind: 'conversation', roomAgent: true,
    activeToolCallId: toolCallId, abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' })
  const tools = [...workbenchCodeTools(deps.threadStore), ...workbenchWorkTools(deps.threadStore)]
  const tool = (name: string) => tools.find((item) => item.name === name)!
  const run = async (name: string, args: Record<string, unknown>, toolCallId?: string) => tool(name).execute(args, context(toolCallId))
  /** A directory the tests may treat as a Code project or Work workspace. */
  const makeDirectory = async (name: string) => {
    const path = join(directory, name)
    await mkdir(path, { recursive: true })
    return realpath(path)
  }
  const addCodeThread = (id: string, workspace: string, extra: Partial<ThreadRecord> = {}) => {
    stub.threads.set(id, createThreadRecord({ id, title: 'Session ' + id, workspace, model: 'm', agentSurface: 'code', ...extra }))
  }
  return { directory, store, service, room, bridge, deps, stub, wakes, thread, runId, context, tool, run, makeDirectory, addCodeThread, writeFile,
    cleanup: async () => { await store.close(); await rm(directory, { recursive: true, force: true }) } }
}
export type WorkbenchFixture = Awaited<ReturnType<typeof workbenchFixture>>
