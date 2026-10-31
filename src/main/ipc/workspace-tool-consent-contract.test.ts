import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'
import { sseStartPayloadSchema } from './app-ipc-schemas/system'
import { createApprovalActionEnvelope, createApprovalRequest } from '../../../kun/src/domain/approval'
import { FileSessionStore } from '../../../kun/src/adapters/file/file-session-store'
import { InMemoryEventBus } from '../../../kun/src/adapters/in-memory-event-bus'
import { RuntimeEventRecorder } from '../../../kun/src/services/runtime-event-recorder'
import { roomRunDetail, roomRunItems } from '../../../kun/src/rooms/room-run-query'
import { buildEventStreamResponse } from '../../../kun/src/server/routes/events'
import { InteractiveToolBridge } from '../../../kun/src/loop/interactive-tool-bridge'
import { InMemoryApprovalGate } from '../../../kun/src/adapters/in-memory-approval-gate'
import { InMemoryUserInputGate } from '../../../kun/src/adapters/in-memory-user-input-gate'
import type { TurnService } from '../../../kun/src/services/turn-service'
import { decideApproval } from '../../../kun/src/server/routes/approvals'
import { ApprovalConsentVerifier } from '../../../kun/src/server/approval-consent'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent'
import type { RoomRuntimeDeps } from '../../../kun/src/rooms/room-runtime-types'

const { allowWorkspaceTool } = createRequire(import.meta.url)('../../../scripts/smoke-workspace-tool-consent.cjs')

describe('workspace smoke consent observation contract', () => {
  it('keeps raw approval reads forbidden to renderer runtime requests', () => {
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/approvals/approval-1', method: 'GET' }))
      .toThrow('runtime request path is not allowed')
  })

  it.each(['allowed', 'denied', 'agent', 'wrong-action', 'wrong-turn', 'missing', 'stream-error', 'stream-end'] as const)(
    'observes real persisted %s events, not nonexistent room-run approval items', async (outcome) => {
      const directory = await mkdtemp(join(tmpdir(), 'workspace-consent-contract-'))
      const sessions = new FileSessionStore({ dataDir: directory })
      const bus = new InMemoryEventBus()
      let seq = 0
      const recorder = new RuntimeEventRecorder({ eventBus: bus, sessionStore: sessions,
        allocateSeq: () => ++seq, nowIso: () => new Date().toISOString() })
      const expected = { toolName: 'write', arguments: { path: 'workspace-evidence.txt', content: 'fixture\n' } }
      const approval = createApprovalRequest({ id: 'approval-1', threadId: 'thread-1', turnId: 'turn-1',
        toolName: 'write', summary: 'Write fixture',
        action: createApprovalActionEnvelope({ ...expected, workspace: '/fixture', reason: 'Fixture write' }) })
      const event = { threadId: approval.threadId, turnId: approval.turnId, approvalId: approval.id,
        toolName: approval.toolName, summary: approval.summary, action: approval.action }
      const run = { id: 'run-1', roomId: 'room-1', requestId: 'request-1', threadId: 'thread-1', turnId: 'turn-1',
        memberId: 'member-1', phase: 'conversation', status: 'running', clientRequestId: 'client-1' }
      // Only admission metadata is stubbed. Inspection, durable storage, event
      // recording and the public SSE replay/live stream are production code.
      const deps = { sessions, store: { get: async (kind: string) => kind === 'room_run'
        ? { roomId: 'room-1', revision: 1, value: run } : null },
        threadStore: { getMetadata: async () => ({ workspace: '/fixture',
          roomContext: { roomId: 'room-1', memberId: 'member-1', kind: 'conversation' },
          turns: [{ id: 'turn-1', threadId: 'thread-1', clientRequestId: 'client-1', status: 'running' }] }) }
      } as unknown as RoomRuntimeDeps
      type EventPayload = { streamId: string; events: unknown[] }
      const existingUiListener = vi.fn()
      const eventListeners = new Set<(payload: EventPayload) => void>([existingUiListener])
      const handler = (payload: EventPayload) => { for (const listener of eventListeners) listener(payload) }
      let errorHandler: (payload: { streamId: string; message: string }) => void = () => {}
      let endHandler: (payload: { streamId: string }) => void = () => {}
      let ownedStreamId = ''
      const abort = new AbortController()
      let pump: Promise<void> | undefined
      const gate = new InMemoryApprovalGate()
      const bridge = new InteractiveToolBridge({ approvalGate: gate, userInputGate: new InMemoryUserInputGate(),
        events: recorder, sessionStore: sessions, turns: {} as TurnService, nowIso: () => new Date().toISOString() })
      const turnAbort = new AbortController()
      let waiting: ReturnType<typeof bridge.awaitApproval> | undefined
      let clicked = false, stopped = false
      const api = {
        onSseEvent: (callback: typeof handler) => { eventListeners.add(callback); return () => { eventListeners.delete(callback) } },
        onSseEnd: (callback: typeof endHandler) => { endHandler = callback; return () => { endHandler = () => {} } },
        onSseError: (callback: typeof errorHandler) => { errorHandler = callback; return () => {} },
        startSse: async (threadId: string, sinceSeq: number, streamId: string) => {
          ownedStreamId = streamId
          expect(streamId).toMatch(/^workspace-consent-/)
          sseStartPayloadSchema.parse({ threadId, sinceSeq, streamId })
          expect(threadId).toBe(run.threadId)
          handler({ streamId: 'existing-ui-stream', events: [{ ...event, kind: 'approval_resolved',
            status: 'allowed', approvalReviewer: 'user', seq: 999 }] })
          const response = buildEventStreamResponse({ threadId, sinceSeq, eventBus: bus, sessionStore: sessions,
            request: new Request('http://fixture/v1/threads/thread-1/events', { signal: abort.signal }) })
          const reader = response.body!.getReader()
          pump = (async () => {
            let buffer = ''
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += new TextDecoder().decode(chunk.value)
              let end: number
              while ((end = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
                const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
                if (data) handler({ streamId, events: [JSON.parse(data)] })
              }
            }
          })().catch((error) => errorHandler({ streamId, message: String(error) }))
        },
        stopSse: async (id: string) => { expect(id).toBe(ownedStreamId); stopped = true; abort.abort(); await pump }
      }
      const browser = { kunGui: api }
      const evaluate = async (fn: (arg: unknown) => unknown, arg: unknown) => {
        vi.stubGlobal('window', browser)
        return structuredClone(await fn(arg))
      }
      const allow = { waitFor: async () => {}, evaluate: async (fn: (button: { click(): void }) => void) => fn({ click() {} }),
        click: async () => {
          clicked = true
          if (outcome === 'stream-error') { errorHandler({ streamId: ownedStreamId, message: 'replay_reset_required' }); return }
          if (outcome === 'stream-end') { endHandler({ streamId: ownedStreamId }); return }
          if (outcome === 'allowed' || outcome === 'denied') {
            const decision = outcome === 'allowed' ? 'allow' : 'deny'
            const token = createApprovalConsentToken({ runtimeToken: 'fixture-runtime-secret', approvalId: approval.id,
              decision, expiresAt: Date.now() + 30000 })
            const result = await decideApproval({ approvalId: approval.id, gate, events: recorder,
              consent: new ApprovalConsentVerifier('fixture-runtime-secret'),
              request: new Request('http://fixture/v1/approvals/' + approval.id, { method: 'POST',
                headers: { 'content-type': 'application/json', [KUN_APPROVAL_CONSENT_HEADER]: token },
                body: JSON.stringify({ decision }) }) })
            expect(result.status).toBe(200)
            expect(await waiting).toMatchObject({ decision, reviewer: 'user' })
          } else if (outcome !== 'missing') await recorder.record({ ...event, kind: 'approval_resolved',
            turnId: outcome === 'wrong-turn' ? 'other-turn' : approval.turnId,
            action: outcome === 'wrong-action' ? createApprovalActionEnvelope({ ...expected, arguments: { path: 'other' }, workspace: '/fixture', reason: 'Other' }) : approval.action,
            status: 'allowed', approvalReviewer: outcome === 'agent' ? 'agent' : 'user' })
        } }
      const card = { count: async () => 1, locator: () => ({ innerText: async () => JSON.stringify(expected.arguments) }), getByRole: () => allow }
      const request = async (_page: unknown, path: string) => {
        runtimeRequestPayloadSchema.parse({ path, method: 'GET' })
        if (path.endsWith('/direct')) return { active: { ...run, id: run.requestId, runId: run.id }, approvals: gate.pending(run.threadId).map((value) => structuredClone(value)) }
        expect(path).toBe('/v1/rooms/room-1/runs/run-1')
        return roomRunDetail(deps, 'room-1', 'run-1')
      }
      try {
        waiting = bridge.awaitApproval({ approval, approvalPolicy: 'on-request', sandboxMode: 'workspace-write', signal: turnAbort.signal })
        void waiting.catch(() => undefined)
        // The gate can already be pending before appendEvent finishes; the
        // helper must wait for the exact persisted requested event via SSE.
        expect(gate.pending(run.threadId)).toHaveLength(1)
        const page = await roomRunItems(deps, 'room-1', 'run-1', { limit: 100, maxBytes: 262144 })
        expect(page).toMatchObject({ items: [], hasMore: false, availability: { status: 'available' } })
        const poll = async (check: () => Promise<boolean>) => {
          for (let attempt = 0; attempt < 20; attempt++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 5)) }
          throw new Error('No matching durable approval event')
        }
        const options = { page: { locator: () => card, evaluate }, roomId: 'room-1', expected, request, poll, capture: async () => {} }
        if (outcome === 'allowed') expect(await allowWorkspaceTool(options)).toMatchObject({ approvalId: approval.id, status: 'allowed' })
        else await expect(allowWorkspaceTool(options)).rejects.toThrow()
        expect(clicked).toBe(true)
        expect(stopped).toBe(true)
        expect(eventListeners).toEqual(new Set([existingUiListener]))
        expect(existingUiListener).toHaveBeenCalled()
        expect((await roomRunItems(deps, 'room-1', 'run-1')).items).toEqual([])
      } finally {
        turnAbort.abort(); await waiting?.catch(() => undefined); abort.abort(); await pump; vi.unstubAllGlobals(); await sessions.close()
        await rm(directory, { recursive: true, force: true })
      }
    })
})
