import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnPty, spawnRemoteTerminal } from './pty-host'
import { TerminalSpawnError } from './session-service'

const mocks = vi.hoisted(() => ({ gate: vi.fn(), register: vi.fn() }))
vi.mock('../terminal/pty-launch-gate', () => ({ spawnPtyBehindGate: mocks.gate }))
vi.mock('../terminal/pty-environment', () => ({
  loadNodePty: async () => ({}), buildShellEnv: () => ({}),
  resolveTerminalShellCandidates: () => [{ file: '/one', args: [] }, { file: '/two', args: [] }]
}))
vi.mock('../../../kun/src/process/owned-process.js', () => ({ registerOwnedProcessGroup: mocks.register }))

const spec = { origin: { kind: 'code' as const, id: 'thread' }, cwd: '/project', cols: 80, rows: 24 }
const receive = { data: vi.fn(), exit: vi.fn() }
function launch(options: { ready?: Promise<void>; stop?: ReturnType<typeof vi.fn> } = {}) {
  const stop = options.stop ?? vi.fn().mockResolvedValue(undefined)
  return {
    pty: { pid: 123, kill: vi.fn(), write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), onData: vi.fn(), onExit: vi.fn() },
    ready: options.ready ?? Promise.resolve(), exited: Promise.resolve(), release: vi.fn(),
    takeInitialOutput: () => '', ownership: { stop }
  }
}
beforeEach(() => { vi.clearAllMocks() })

describe('remote terminal launch ownership boundary', () => {
  it('retains an unconfirmed launch handle and never starts a fallback shell', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('owned tree still running'))
    const gate = launch({ ready: Promise.reject(new Error('bind failed')), stop })
    mocks.gate.mockResolvedValue(gate)
    let failure: unknown
    try { await spawnRemoteTerminal(spec, receive, () => false) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(TerminalSpawnError)
    expect(mocks.gate).toHaveBeenCalledTimes(1)
    expect(gate.release).not.toHaveBeenCalled()
    stop.mockResolvedValue(undefined)
    await (failure as TerminalSpawnError).pty.kill()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(gate.pty.kill).toHaveBeenCalledOnce()
  })

  it('tries a fallback only after cleanup is confirmed', async () => {
    const first = launch({ ready: Promise.reject(new Error('not available')) })
    const second = launch()
    mocks.gate.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const terminal = await spawnRemoteTerminal(spec, receive, () => false)
    expect(first.ownership.stop).toHaveBeenCalledOnce()
    expect(first.pty.kill).toHaveBeenCalledOnce()
    expect(second.release).toHaveBeenCalledOnce()
    expect(mocks.gate).toHaveBeenCalledTimes(2)
    await terminal.kill()
  })

  it('adopts gate-provided ownership and cleans it on late cancellation', async () => {
    let cancelled = false
    const gate = launch()
    mocks.gate.mockImplementation(async () => { cancelled = true; return gate })
    await expect(spawnPty({ ...spec, file: '/one', args: [] }, receive, () => cancelled))
      .rejects.toThrow('TERMINAL_START_CANCELLED')
    expect(mocks.register).not.toHaveBeenCalled()
    expect(gate.release).not.toHaveBeenCalled()
    expect(gate.ownership.stop).toHaveBeenCalledOnce()
  })
})
