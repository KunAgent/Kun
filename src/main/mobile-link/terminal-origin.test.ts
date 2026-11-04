import { describe, expect, it, vi } from 'vitest'
import { createRuntimeOriginWorkspace, type OriginAuthority } from './terminal-origin'

const code = { kind: 'code', id: 'thread-1' } as const
const agent = { kind: 'agent', id: 'agent-1' } as const
const answer = (value: Record<string, unknown>) => JSON.stringify(value)
const resolved = answer({ kind: 'code', id: 'thread-1', cwd: '/Users/example/project' })

const authority = (overrides: Partial<OriginAuthority> = {}): OriginAuthority => ({
  accountId: 'account-1',
  deviceId: 'phone-1',
  authorizationId: 'grant-1',
  scopes: ['personal', 'desktop.view', 'desktop.control'],
  current: () => true,
  ...overrides
})

function reader(reply: { ok: boolean; status: number; body: string }) {
  const request = vi.fn(async (_path: string, _method?: string, _body?: string) => reply)
  const acquire = vi.fn(async () => ({ runtimeToken: 'token', request }))
  return { read: createRuntimeOriginWorkspace({ acquireRuntimeRequestLease: acquire }), request, acquire }
}

describe('runtime origin workspace port', () => {
  it('binds the lookup to the session authority and returns the runtime path', async () => {
    const { read, request } = reader({ ok: true, status: 200, body: resolved })
    await expect(read(code, authority())).resolves.toBe('/Users/example/project')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/v1/remote/origin-workspace', 'POST', answer({
      accountId: 'account-1',
      deviceId: 'phone-1',
      authorizationId: 'grant-1',
      scopes: ['personal', 'desktop.view', 'desktop.control'],
      origin: { kind: 'code', id: 'thread-1' }
    }))
    // The phone's directory is never part of the request.
    expect(Object.keys(JSON.parse(String(request.mock.calls[0]?.[2])))).toEqual(
      ['accountId', 'deviceId', 'authorizationId', 'scopes', 'origin']
    )
  })

  it('sends an agent origin without inventing a directory', async () => {
    const { read, request } = reader({
      ok: true,
      status: 200,
      body: answer({ kind: 'agent', id: 'agent-1', cwd: '/Users/example/agent-workspace' })
    })
    await expect(read(agent, authority())).resolves.toBe('/Users/example/agent-workspace')
    expect(JSON.parse(String(request.mock.calls[0]?.[2])).origin).toEqual({ kind: 'agent', id: 'agent-1' })
  })

  it('fails closed when the runtime refuses the origin', async () => {
    const denied = reader({ ok: false, status: 403, body: answer({ code: 'TERMINAL_ORIGIN_UNAVAILABLE' }) })
    await expect(denied.read(code, authority())).resolves.toBeNull()
    const stale = reader({ ok: false, status: 403, body: answer({ code: 'REMOTE_SCOPE_REQUIRED' }) })
    await expect(stale.read(code, authority())).resolves.toBeNull()
  })

  it('checks the authority before the lease and again after the answer', async () => {
    const { read, acquire } = reader({ ok: true, status: 200, body: resolved })
    await expect(read(code, authority({ current: () => false }))).rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
    expect(acquire).not.toHaveBeenCalled()
    let live = true
    const flapping = vi.fn(async (_path: string, _method?: string, _body?: string) => {
      live = false
      return { ok: true, status: 200, body: resolved }
    })
    const readWithFlap = createRuntimeOriginWorkspace({
      acquireRuntimeRequestLease: async () => ({ runtimeToken: 'token', request: flapping })
    })
    await expect(readWithFlap(code, authority({ current: () => live }))).rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
  })

  it('rejects an answer for another origin or a non-path body', async () => {
    for (const body of [
      answer({ kind: 'code', id: 'thread-other', cwd: '/Users/example/project' }),
      answer({ kind: 'agent', id: 'thread-1', cwd: '/Users/example/project' }),
      answer({ kind: 'code', id: 'thread-1', cwd: 42 }),
      answer({ kind: 'code', id: 'thread-1' }),
      answer({ kind: 'code', id: 'thread-1', cwd: '' }),
      'not-json',
      ''
    ]) {
      const { read } = reader({ ok: true, status: 200, body })
      await expect(read(code, authority())).resolves.toBeNull()
    }
  })
})
