import { describe, expect, it, vi } from 'vitest'
import type { ReceptionEmployeePublication } from '../../shared/collaboration/contracts'
import { ReceptionInvocationGateway } from './reception-invocation-gateway'

const publication: ReceptionEmployeePublication = {
  id: 'publication-1',
  employeeId: 'employee-1',
  displayName: 'Release reviewer',
  description: 'Reviews release changes',
  ownerDeviceId: 'local',
  allowedToolNames: ['read', 'grep', 'write'],
  meetingIds: [],
  taskIds: [],
  status: 'available',
  updatedAt: '2026-07-17T00:00:00.000Z'
}

describe('ReceptionInvocationGateway', () => {
  it('starts an isolated Kun turn with the intersected tool policy and mandatory approval', async () => {
    const runtimeRequest = vi.fn(async (
      path: string,
      _init: { method?: string; body?: string }
    ) => {
      if (path === '/v1/threads') return { ok: true, status: 201, body: JSON.stringify({ id: 'thread-1' }) }
      if (path === '/v1/threads/thread-1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thread-1', turnId: 'turn-1', userMessageItemId: 'item-1' }) }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const gateway = new ReceptionInvocationGateway({
      runtimeRequest,
      workspaceRoot: 'D:/workspace',
      localAllowedToolNames: ['read', 'grep']
    })

    const result = await gateway.invoke({ publication, prompt: 'Review the release' })

    expect(result).toEqual({
      status: 'running',
      ownerDeviceId: 'local',
      threadId: 'thread-1',
      turnId: 'turn-1',
      allowedToolNames: ['read', 'grep']
    })
    const turnCall = runtimeRequest.mock.calls.find(([path]) => path === '/v1/threads/thread-1/turns')
    expect(JSON.parse(String(turnCall?.[1]?.body))).toMatchObject({
      prompt: 'Review the release',
      approvalPolicy: 'always',
      disableUserInput: true,
      allowedToolNames: ['read', 'grep']
    })
  })

  it('interrupts the real Kun turn', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({ status: 'aborted' }) }))
    const gateway = new ReceptionInvocationGateway({
      runtimeRequest,
      workspaceRoot: '',
      localAllowedToolNames: ['read']
    })

    await gateway.interrupt({ threadId: 'thread-1', turnId: 'turn-1' })

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/threads/thread-1/turns/turn-1/interrupt', {
      method: 'POST',
      body: '{}'
    })
  })

  it('reads the terminal Kun turn and returns its final summary', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        turns: [{
          id: 'turn-1',
          status: 'completed',
          items: [{ kind: 'assistant_text', turnId: 'turn-1', text: 'Release is ready.' }]
        }]
      })
    }))
    const gateway = new ReceptionInvocationGateway({
      runtimeRequest,
      workspaceRoot: '',
      localAllowedToolNames: ['read']
    })

    await expect(gateway.inspect({ threadId: 'thread-1', turnId: 'turn-1' })).resolves.toEqual({
      status: 'completed',
      resultSummary: 'Release is ready.'
    })
  })
})
