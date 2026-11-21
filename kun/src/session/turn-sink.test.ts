import { expect, it, vi } from 'vitest'
import { KunTimelineTurnSink } from './turn-sink.js'
import { ApprovalActionEnvelopeSchema } from '../contracts/approvals.js'
import { ApprovalEvent } from '../contracts/events.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import type { ApprovalRequest } from '../domain/approval.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { makeDelegatedAwaitApproval } from '../ade/delegated-approval.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'

function fixture(emitAll: (drafts: unknown) => Promise<void>) {
  return new KunTimelineTurnSink({ emitter: { emitAll } as never, approve: async () => 'deny',
    threadId: 'thread', turnId: 'turn', workspace: '/workspace', ids: { next: () => 'id' } })
}
it('serializes streamed writes and drains them before a caller can finish the turn', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const completed: unknown[] = []
  const emitAll = vi.fn(async (drafts: unknown) => { await blocked; completed.push(drafts) })
  const sink = fixture(emitAll)
  void sink.emit([{ kind: 'first' }] as never)
  void sink.emit([{ kind: 'last' }] as never)
  let finished = false
  const flushing = sink.flush().then(() => { finished = true })
  await Promise.resolve()
  expect(emitAll).toHaveBeenCalledTimes(1)
  expect(finished).toBe(false)
  release(); await flushing
  expect(completed).toEqual([[{ kind: 'first' }], [{ kind: 'last' }]])
})
it('observes asynchronous stream errors and surfaces them from flush instead of silently completing', async () => {
  const sink = fixture(async () => { throw new Error('rejected timeline write') })
  void sink.emit([])
  await expect(sink.flush()).rejects.toThrow('rejected timeline write')
})

it('passes a valid command action to the approval gate and returns its decision', async () => {
  const approve = vi.fn(async (approval: ApprovalRequest) => {
    ApprovalActionEnvelopeSchema.parse(approval.action)
    return 'deny' as const
  })
  const sink = new KunTimelineTurnSink({ emitter: { emitAll: vi.fn() } as never, approve,
    threadId: 'thread', turnId: 'turn', workspace: '/workspace', ids: { next: () => 'id' } })
  await expect(sink.requestApproval({ kind: 'command', summary: 'read file',
    detail: { command: 'cat file', cwd: '/workspace', reason: 'inspect' } }))
    .resolves.toEqual({ decision: 'decline' })
  expect(approve).toHaveBeenCalledOnce()
  expect(approve.mock.calls[0][0].action).toMatchObject({
    kind: 'command', toolName: 'command_execution', workspace: '/workspace',
    cwd: '/workspace', arguments: { command: 'cat file' },
    effects: { processExecution: true }, targets: expect.arrayContaining([
      { kind: 'command', value: 'cat file' }
    ])
  })
})

it.each(['file-change', 'permissions'] as const)('sends a valid %s action and respects approval', async (kind) => {
  const approve = vi.fn(async (approval: ApprovalRequest) => {
    ApprovalActionEnvelopeSchema.parse(approval.action)
    return 'allow' as const
  })
  const sink = new KunTimelineTurnSink({ emitter: { emitAll: vi.fn() } as never, approve,
    threadId: 'thread', turnId: 'turn', workspace: '/workspace', ids: { next: () => 'id' } })
  await expect(sink.requestApproval({ kind, summary: 'approval', detail: { cwd: '/workspace' }, risky: true }))
    .resolves.toEqual({ decision: 'accept' })
  expect(approve.mock.calls[0][0].action?.requiresUserDecision).toBe(true)
  expect(approve.mock.calls[0][0].action?.effects.guiAutomation).toBe(false)
})

it('handles blank command/cwd fields, extracts grantRoot and nested tool targets, and redacts summary secrets', async () => {
  const seen: ApprovalRequest[] = []
  const approve = vi.fn(async (approval: ApprovalRequest) => {
    ApprovalActionEnvelopeSchema.parse(approval.action)
    seen.push(approval)
    return 'allow' as const
  })
  const sink = new KunTimelineTurnSink({ emitter: { emitAll: vi.fn() } as never, approve,
    threadId: 'thread', turnId: 'turn', workspace: '/workspace', ids: { next: () => 'id' } })

  await expect(sink.requestApproval({
    kind: 'command',
    summary: 'curl -H "Authorization: Bearer super_secret_token_123456" https://example.com',
    detail: { command: '   ', cwd: '' }
  })).resolves.toEqual({ decision: 'accept' })
  expect(seen[0].summary).not.toContain('super_secret_token_123456')
  expect(seen[0].action?.reason).not.toContain('super_secret_token_123456')

  await expect(sink.requestApproval({
    kind: 'file-change',
    summary: 'write file',
    detail: { grantRoot: '/workspace/frontend' }
  })).resolves.toEqual({ decision: 'accept' })
  expect(seen[1].action).toMatchObject({
    kind: 'file',
    effects: { network: false, externalWrite: true, processExecution: false, guiAutomation: false },
    targets: expect.arrayContaining([{ kind: 'file', value: '/workspace/frontend' }])
  })

  await expect(sink.requestApproval({
    kind: 'command',
    summary: 'bash ls',
    detail: { toolName: 'bash', input: { command: 'ls -la', cwd: '/workspace/sub' } },
    risky: true
  })).resolves.toEqual({ decision: 'accept' })
  expect(seen[2].action).toMatchObject({
    kind: 'command',
    cwd: '/workspace/sub',
    targets: expect.arrayContaining([
      { kind: 'command', value: 'ls -la' },
      { kind: 'file', value: '/workspace/sub' }
    ])
  })
})

it('fails closed with a diagnostic instead of throwing when envelope construction fails', async () => {
  const approve = vi.fn(async () => 'allow' as const)
  const diagnostic = vi.fn()
  const sink = new KunTimelineTurnSink({ emitter: { emitAll: vi.fn() } as never, approve,
    threadId: 'thread', turnId: 'turn', workspace: '/workspace', ids: { next: () => 'id' }, diagnostic })

  await expect(sink.requestApproval({
    kind: 'command',
    summary: 'huge command',
    detail: { command: 'x'.repeat(2_500) }
  })).resolves.toEqual({ decision: 'decline' })
  expect(approve).not.toHaveBeenCalled()
  expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('approval request failed closed'))

  const emptyWorkspaceSink = new KunTimelineTurnSink({ emitter: { emitAll: vi.fn() } as never, approve,
    threadId: 'thread', turnId: 'turn', workspace: '   ', ids: { next: () => 'id' }, diagnostic })
  await expect(emptyWorkspaceSink.requestApproval({
    kind: 'command',
    summary: 'ls',
    detail: { command: 'ls' }
  })).resolves.toEqual({ decision: 'decline' })
  expect(approve).not.toHaveBeenCalled()
})

it('emits a schema-valid approval_requested event through the delegated approval pipeline', async () => {
  const gate = new InMemoryApprovalGate()
  const recorded: unknown[] = []
  const events = {
    record: vi.fn(async (draft: Record<string, unknown>) => {
      const event = {
        ...draft,
        seq: recorded.length + 1,
        timestamp: new Date().toISOString()
      }
      ApprovalEvent.parse(event)
      recorded.push(event)
    })
  } as unknown as RuntimeEventRecorder
  const awaitApproval = makeDelegatedAwaitApproval({ approvalGate: gate, events }, {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalReviewer: 'user',
    actingModelRoute: {} as ActingTurnModelRoute,
    intent: 'Inspect package.json',
    signal: new AbortController().signal
  })
  const sink = new KunTimelineTurnSink({
    emitter: { emitAll: vi.fn() } as never,
    approve: async (approval) => {
      const res = await awaitApproval(approval)
      return typeof res === 'string' ? res : res.decision
    },
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/repo',
    ids: { next: () => 'approval-1' }
  })

  const pending = sink.requestApproval({
    kind: 'command',
    summary: "Get-Content -LiteralPath './frontend/package.json' -Raw",
    detail: {
      command: "Get-Content -LiteralPath './frontend/package.json' -Raw",
      cwd: '/repo',
      reason: 'Inspect dependencies',
      commandActions: [{ type: 'read' }]
    }
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(recorded).toHaveLength(1)
  gate.decide('approval-1', 'allow')
  await expect(pending).resolves.toEqual({ decision: 'accept' })
})
