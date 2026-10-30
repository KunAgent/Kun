import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'
import { applyRuntimeEvent, createRuntimeEventProjection } from '../../../kun/src/domain/runtime-event-reducer'
import { ApprovalEvent } from '../../../kun/src/contracts/events'
import { createApprovalActionEnvelope } from '../../../kun/src/domain/approval'

const { allowWorkspaceTool } = createRequire(import.meta.url)('../../../scripts/smoke-workspace-tool-consent.cjs')

describe('workspace smoke consent observation contract', () => {
  it('keeps the raw approval read forbidden to renderer runtime requests', () => {
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/approvals/approval-1', method: 'GET' }))
      .toThrow('runtime request path is not allowed')
  })

  it.each(['allowed', 'denied', 'missing', 'agent', 'pending', 'wrong-turn', 'wrong-action'] as const)('observes canonical %s through only permitted run routes', async (outcome) => {
    const expected = { toolName: 'write', arguments: { path: 'workspace-evidence.txt', content: 'fixture\n' } }
    const approval = { id: 'approval-1', threadId: 'thread-1', turnId: 'turn-1', status: 'pending',
      toolName: 'write', summary: 'Write fixture', action: createApprovalActionEnvelope({ ...expected, workspace: '/fixture', reason: 'Fixture write' }) }
    const base = { threadId: approval.threadId, turnId: approval.turnId, approvalId: approval.id,
      toolName: approval.toolName, summary: approval.summary, action: approval.action,
      timestamp: '2026-10-30T00:00:00Z' }
    let projection = applyRuntimeEvent(createRuntimeEventProjection('thread-1'), ApprovalEvent.parse({
      ...base, kind: 'approval_requested', status: 'pending', seq: 1
    }))
    let clicked = false
    const paths: string[] = []
    const allow = { waitFor: async () => {}, evaluate: async (fn: (button: { click(): void }) => void) => fn({ click() {} }),
      click: async () => {
        clicked = true
        projection = applyRuntimeEvent(projection, ApprovalEvent.parse({ ...base, kind: 'approval_resolved', seq: 2,
          status: outcome === 'denied' ? 'denied' : outcome === 'pending' ? 'pending' : 'allowed', approvalReviewer: outcome === 'agent' ? 'agent' : 'user'
        }))
        if (outcome === 'wrong-turn') projection.items[0].turnId = 'other-turn'
        if (outcome === 'wrong-action' && projection.items[0].kind === 'approval') {
          projection.items[0].action = undefined
        }
      } }
    const card = { count: async () => 1, locator: () => ({ innerText: async () => JSON.stringify(expected.arguments) }),
      getByRole: () => allow }
    const run = { id: 'run-1', roomId: 'room-1', requestId: 'request-1', threadId: 'thread-1', turnId: 'turn-1' }
    const options = { page: { locator: () => card }, roomId: 'room-1', expected,
      request: async (_page: unknown, path: string) => {
        // Exercise the actual production IPC validator on every helper request.
        runtimeRequestPayloadSchema.parse({ path, method: 'GET' })
        paths.push(path)
        const url = new URL(path, 'http://fixture')
        if (url.pathname.endsWith('/direct')) return { active: { ...run, id: run.requestId, runId: run.id },
          approvals: clicked ? [] : [structuredClone(approval)] }
        if (url.pathname.endsWith('/run-1')) return { run }
        expect(url.pathname).toBe('/v1/rooms/room-1/runs/run-1/items')
        const itemId = url.searchParams.get('item_id')
        return { availability: { status: 'available' }, items: clicked && outcome === 'missing' ? [] :
          projection.items.filter((item) => !itemId || item.id === itemId) }
      }, poll: async (check: () => Promise<boolean>) => expect(await check()).toBe(true), capture: async () => {} }
    if (outcome === 'allowed') expect(await allowWorkspaceTool(options)).toMatchObject({ approvalId: approval.id, status: 'allowed' })
    else await expect(allowWorkspaceTool(options)).rejects.toThrow()
    expect(clicked).toBe(true)
    expect(paths.every((path) => path.startsWith('/v1/rooms/room-1/'))).toBe(true)
    expect(paths.some((path) => path.includes('&item_id=item_approval-1'))).toBe(true)
  })
})
