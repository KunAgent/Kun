import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { authorizeOrigin, parseWorkspace, resolveOriginWorkspace } from './origin-workspace'
import type { TerminalAuthority } from './session-service'

const authority = (overrides: Partial<TerminalAuthority> = {}): TerminalAuthority => ({
  accountId: 'account', deviceId: 'phone', authorizationId: 'authorization',
  scopes: ['personal', 'desktop.view', 'desktop.control'],
  current: () => true, validForMs: () => 60_000, emit: () => {}, ...overrides
})
const code = { kind: 'code', id: 'thread' } as const
const agent = { kind: 'agent', id: 'agent' } as const

describe('terminal origin workspace', () => {
  it('accepts only absolute, bounded paths', () => {
    const project = resolve('fixture-project')
    expect(parseWorkspace(project)).toBe(project)
    expect(parseWorkspace('/' + '中'.repeat(1300))).toBe('/' + '中'.repeat(1300))
    for (const value of ['/' + '中'.repeat(1400), '/' + 'é'.repeat(2049)])
      expect(() => parseWorkspace(value)).toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
    const windowsPath = 'C:\\Users\\example\\project'
    if (isAbsolute(windowsPath)) expect(parseWorkspace(windowsPath)).toBe(windowsPath)
    else expect(() => parseWorkspace(windowsPath)).toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
    for (const value of ['', 'project', './project', '/tmp/\0bad', 42, null, undefined, '/'.repeat(5000)])
      expect(() => parseWorkspace(value)).toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
  })

  it('authorizes with the exact confirmed history methods', async () => {
    const invoke = vi.fn(async (..._args: unknown[]) => ({ threadId: 'thread', turns: [] }))
    await authorizeOrigin(invoke, authority(), code)
    expect(invoke).toHaveBeenCalledWith({ method: 'code.history', params: { threadId: 'thread' } }, expect.objectContaining({ deviceId: 'phone' }))
    await authorizeOrigin(invoke, authority(), agent)
    expect(invoke).toHaveBeenLastCalledWith({ method: 'agent.history', params: { agentId: 'agent' } }, expect.anything())
  })

  it('takes the directory from the host record, not from the remote answer', async () => {
    // The remote history page has no workspace field; the host port supplies it.
    const invoke = vi.fn(async (..._args: unknown[]) => ({ threadId: 'thread', revision: 'thread-v1:1' }))
    const readWorkspace = vi.fn(async () => '/Users/example/project')
    await expect(resolveOriginWorkspace(invoke, readWorkspace, authority(), code)).resolves.toEqual({ cwd: '/Users/example/project' })
    expect(readWorkspace).toHaveBeenCalledWith(code, expect.objectContaining({ accountId: 'account', deviceId: 'phone', authorizationId: 'authorization' }))
    expect(JSON.stringify(invoke.mock.calls[0][0])).not.toContain('workspace')
  })

  it('fails closed when the host cannot resolve the origin', async () => {
    for (const value of [null, undefined, '', 'relative/path', '/tmp/\0bad']) {
      const readWorkspace = vi.fn(async () => value)
      await expect(resolveOriginWorkspace(vi.fn(), readWorkspace, authority(), code)).rejects.toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
    }
  })

  it('rejects a stale authorization before and after the runtime answers', async () => {
    const invoke = vi.fn()
    await expect(resolveOriginWorkspace(invoke, vi.fn(), authority({ current: () => false }), code)).rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
    let live = true
    const readWorkspace = vi.fn(async () => { live = false; return '/Users/example/project' })
    await expect(resolveOriginWorkspace(vi.fn(async () => ({})), readWorkspace, authority({ current: () => live }), code))
      .rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
  })

  it('never reads a workspace for an origin that failed authorization', async () => {
    const readWorkspace = vi.fn(async () => '/Users/example/project')
    const invoke = vi.fn(async () => { throw new Error('TERMINAL_ORIGIN_UNAVAILABLE') })
    await expect(resolveOriginWorkspace(invoke, readWorkspace, authority(), code)).rejects.toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
    expect(readWorkspace).not.toHaveBeenCalled()
  })
})
