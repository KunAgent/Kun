import { expect, it, vi } from 'vitest'
import { KunTimelineTurnSink } from './turn-sink.js'
import { ApprovalActionEnvelopeSchema } from '../contracts/approvals.js'
import type { ApprovalRequest } from '../domain/approval.js'

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
})
