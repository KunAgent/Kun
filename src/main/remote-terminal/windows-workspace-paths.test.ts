import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_LIMITS, validateTerminalSession } from '@kun/remote-protocol'
import { RemoteTerminalService, type TerminalAuthority, type TerminalSpawnSpec } from './session-service'
import { resolveOriginWorkspace } from './origin-workspace'

// Keep the real host resolver and service, substituting only Windows path semantics and PTY I/O.
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual, isAbsolute: actual.win32.isAbsolute }
})

const paths = [
  '/workspace/repo', 'C:\\repo', 'D:/repo with spaces',
  '\\\\server\\share\\repo', '\\\\server\\share', '\\\\server\\share$\\repo',
  '\\\\?\\C:\\repo', '\\\\?\\UNC\\server\\share\\repo',
  '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\repo'
]
const invalid = ['', 'repo', './repo', 'C:repo', '\\repo', '\\\\server', '\\\\server\\',
  '\\\\?\\C:repo', '\\\\?\\UNC\\server', '/tmp/\0bad', '/' + '\u4e2d'.repeat(1400)]
const origin = { kind: 'code', id: 'thread' } as const
const session = (cwd: string) => ({ schemaVersion: 1, startId: 'start', sessionId: 'session',
  epoch: 1, origin, cwd, cols: 80, rows: 24, state: 'running' })

function fixture(cwd: string) {
  const authority: TerminalAuthority = { accountId: 'account', deviceId: 'phone', authorizationId: 'grant',
    scopes: ['personal', 'desktop.view', 'desktop.control'], current: () => true,
    validForMs: () => 60_000, emit: vi.fn() }
  const invoke = vi.fn(async () => ({}))
  const readWorkspace = vi.fn(async () => cwd)
  const spawn = vi.fn(async (_spec: TerminalSpawnSpec) => ({ write: vi.fn(), resize: vi.fn(), kill: vi.fn(async () => {}) }))
  const service = new RemoteTerminalService({
    resolveOrigin: (auth, selected) => resolveOriginWorkspace(invoke, readWorkspace, auth, selected),
    spawn, id: () => 'session'
  })
  return { authority, invoke, readWorkspace, spawn, service }
}

describe('Windows remote terminal workspace path contract', () => {
  it.each(paths)('keeps the authorized absolute workspace through origin, PTY and wire validation: %s', async cwd => {
    const f = fixture(cwd)
    try {
      await expect(f.service.invoke('terminal.open', { startId: 'start', origin }, f.authority))
        .resolves.toMatchObject({ session: { cwd } })
      expect(f.spawn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cwd }), expect.any(Object), expect.any(Function))
      expect(f.readWorkspace).toHaveBeenCalledExactlyOnceWith(origin, f.authority)
      expect(validateTerminalSession(session(cwd))).toMatchObject({ cwd })
    } finally { await f.service.stopAll() }
  })

  it.each(invalid)('rejects relative, incomplete, NUL-containing and oversized paths before spawning (case %#)', async cwd => {
    const f = fixture(cwd)
    try {
      await expect(f.service.invoke('terminal.open', { startId: 'start', origin }, f.authority))
        .rejects.toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
      expect(f.spawn).not.toHaveBeenCalled()
      expect(() => validateTerminalSession(session(cwd))).toThrow('INVALID_PARAMS')
    } finally { await f.service.stopAll() }
  })

  it('retains the UTF-8 byte boundary and never obtains a workspace before authorization', async () => {
    expect(validateTerminalSession(session('/' + 'a'.repeat(TERMINAL_LIMITS.cwdBytes - 1)))).toBeTruthy()
    const f = fixture('\\\\server\\share\\repo')
    f.authority.current = () => false
    await expect(f.service.invoke('terminal.open', { startId: 'start', origin }, f.authority))
      .rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
    expect(f.readWorkspace).not.toHaveBeenCalled()
    expect(f.spawn).not.toHaveBeenCalled()
  })
})
