import { afterEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_LIMITS } from '@kun/remote-protocol'
import {
  RemoteTerminalService, TerminalSpawnError,
  type TerminalAuthority, type TerminalPty, type TerminalReceiver, type TerminalSpawnSpec
} from './session-service'
import type { TerminalScreen, TerminalScreenFactory } from './screen'

const tick = () => new Promise((resolve) => setTimeout(resolve, 6))

function screens() {
  const created: Array<{ text: string; pending: string[] }> = []
  const factory: TerminalScreenFactory = {
    create() {
      const state = { text: '', pending: [] as string[] }
      const screen: TerminalScreen = {
        // Writes only become visible after flush(), like headless xterm.
        write: (data) => { state.pending.push(data) },
        resize: () => {},
        flush: async () => { state.text += state.pending.join(''); state.pending = [] },
        capture: async () => { state.text += state.pending.join(''); state.pending = []; return `SCREEN|${state.text}` },
        serialize: () => `SCREEN|${state.text}`,
        dispose: () => { state.text = ''; state.pending = [] }
      }
      created.push(state)
      return screen
    }
  }
  return { factory, created }
}

function pty(receive: TerminalReceiver, options: { kill?: () => Promise<void> } = {}) {
  const state = { writes: [] as string[], killed: 0, dead: false }
  const handle: TerminalPty = {
    write(data) { if (state.dead) throw new Error('closed'); state.writes.push(data) },
    resize() {},
    async kill() {
      if (options.kill) return options.kill()
      state.dead = true; state.killed += 1
    }
  }
  return { state, handle, data: (value: string) => receive.data(value), exit: (code: number) => receive.exit(code) }
}

function fixture(options: { deferredOrigin?: boolean; kill?: () => Promise<void>; spawnFailure?: boolean } = {}) {
  let remaining = 60_000
  let clock = 10_000
  let ids = 0
  let releaseOrigin: () => void = () => {}
  const originGate = new Promise<void>((resolve) => { releaseOrigin = resolve })
  const events: any[] = []
  const ptys: Array<ReturnType<typeof pty>> = []
  const spawns: TerminalSpawnSpec[] = []
  const screenFactory = screens()
  const authority = (overrides: Partial<TerminalAuthority> = {}): TerminalAuthority => ({
    accountId: 'account', deviceId: 'phone', authorizationId: 'authorization',
    scopes: ['personal', 'desktop.view', 'desktop.control'],
    current: () => true, validForMs: () => remaining, emit: (event) => { events.push(event) }, ...overrides
  })
  const service = new RemoteTerminalService({
    resolveOrigin: async () => { if (options.deferredOrigin) await originGate; return { cwd: '/Users/example/project' } },
    spawn: async (spec, receive) => {
      spawns.push(spec)
      const entry = pty(receive, { kill: options.kill })
      ptys.push(entry)
      if (options.spawnFailure) throw new TerminalSpawnError(entry.handle, new Error('gate failed'))
      return entry.handle
    },
    screens: screenFactory.factory,
    supported: () => true,
    now: () => clock,
    id: () => `session-${++ids}`
  })
  return {
    service, authority, events, ptys, spawns, screens: screenFactory.created,
    advance: (ms: number) => { clock += ms },
    releaseOrigin,
    expire: () => { remaining = 0 }
  }
}

const open = (f: ReturnType<typeof fixture>, authority: TerminalAuthority, startId = 'start') =>
  f.service.invoke('terminal.open', { startId, origin: { kind: 'code', id: 'thread' } }, authority) as Promise<any>

afterEach(() => { vi.useRealTimers() })

describe('remote terminal lifecycle fixes', () => {
  it('never exposes or returns an unresolved start, and duplicate open waits for it', async () => {
    const f = fixture({ deferredOrigin: true })
    const first = open(f, f.authority())
    const second = open(f, f.authority())
    await tick()
    // Not yet resolved: no cwd, so it is not listed and not openable twice.
    expect((await f.service.invoke('terminal.list', {}, f.authority()) as any).sessions).toEqual([])
    f.releaseOrigin()
    const [a, b] = await Promise.all([first, second])
    expect(a.session.sessionId).toBe(b.session.sessionId)
    expect(a.session.cwd).toBe('/Users/example/project')
    expect(b.session.cwd).toBe('/Users/example/project')
    expect(f.spawns).toHaveLength(1)
  })

  it('keeps open idempotent after a resize because the fingerprint is fixed at open', async () => {
    const f = fixture()
    const first = await open(f, f.authority())
    await f.service.invoke('terminal.resize', { sessionId: first.session.sessionId, cols: 90, rows: 20 }, f.authority())
    const again = await open(f, f.authority())
    expect(again.session.sessionId).toBe(first.session.sessionId)
    expect(again.session).toMatchObject({ cols: 90, rows: 20 })
    expect(f.spawns).toHaveLength(1)
  })

  it('rebinds a reconnecting controller to fresh closures but rejects a new authorization', async () => {
    const f = fixture()
    const first = await open(f, f.authority())
    const longLived = f.authority()
    await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, longLived)
    f.ptys[0].data('after-rebind')
    await tick()
    expect(f.events.at(-1)).toMatchObject({ event: 'terminal.output', data: 'after-rebind', epoch: 2 })

    const reauthorized = f.authority({ authorizationId: 'other-authorization' })
    expect(await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, reauthorized)).toEqual({ state: 'missing' })
    await tick()
    expect(f.ptys[0].state.killed).toBe(1)
  })

  it('does not report a close as confirmed when the PTY could not be stopped', async () => {
    let fail = true
    const f = fixture({ kill: async () => { if (fail) throw new Error('stubborn process tree') } })
    const first = await open(f, f.authority())
    await expect(f.service.invoke('terminal.close', { sessionId: first.session.sessionId, reason: 'user' }, f.authority()))
      .rejects.toThrow('TERMINAL_CLOSE_UNCONFIRMED')
    // A closed-but-unconfirmed session refuses input and stays retryable.
    expect((await f.service.invoke('terminal.list', {}, f.authority()) as any).sessions).toEqual([])
    fail = false
    const retried = await f.service.invoke('terminal.close', { sessionId: first.session.sessionId, reason: 'user' }, f.authority())
    expect(retried).toEqual({ state: 'closed', sessionId: first.session.sessionId, reason: 'user', confirmed: true })
  })

  it('retries natural-exit tree cleanup without treating shell exit as confirmation', async () => {
    let fail = true
    const kill = vi.fn(async () => { if (fail) throw new Error('descendant alive') })
    const f = fixture({ kill })
    await open(f, f.authority())
    f.ptys[0].exit(0)
    await tick()
    const run = [...(f.service as any).runs.values()][0]
    expect(run.stopConfirmed).toBe(false)
    expect(run.session).toBe(f.ptys[0].handle)
    fail = false
    await f.service.sweep()
    expect(kill).toHaveBeenCalledTimes(2)
    expect(run.stopConfirmed).toBe(true)
  })

  it('keeps a failed launch with unconfirmed cleanup for sweep retry', async () => {
    let fail = true
    const kill = vi.fn(async () => { if (fail) throw new Error('owned tree alive') })
    const f = fixture({ kill, spawnFailure: true })
    await expect(open(f, f.authority())).rejects.toThrow('TERMINAL_CLOSE_UNCONFIRMED')
    expect((f.service as any).runs.size).toBe(1)
    fail = false
    await f.service.sweep()
    expect((f.service as any).runs.size).toBe(0)
    expect(kill).toHaveBeenCalledTimes(2)
  })

  it('bounds an unresolved spawn so close cannot wait forever', async () => {
    vi.useFakeTimers()
    const f = fixture({ deferredOrigin: true })
    const opening = open(f, f.authority())
    const openingResult = expect(opening).rejects.toThrow(/TERMINAL_START_(TIMEOUT|CANCELLED)/)
    const run = [...(f.service as any).runs.values()][0]
    const closing = f.service.invoke('terminal.close', { sessionId: run.info.sessionId, reason: 'user' }, f.authority())
    const closingResult = expect(closing).rejects.toThrow('TERMINAL_CLOSE_UNCONFIRMED')
    await vi.advanceTimersByTimeAsync(TERMINAL_LIMITS.closeTimeoutMs + 1)
    await closingResult
    await vi.advanceTimersByTimeAsync(TERMINAL_LIMITS.startTimeoutMs + 1)
    await openingResult
    expect(f.spawns).toHaveLength(0)
  })

  it('retires an exited session on the exit clock even after attach', async () => {
    const f = fixture()
    const first = await open(f, f.authority())
    f.ptys[0].exit(0)
    await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, f.authority())
    f.advance(TERMINAL_LIMITS.retentionMs + 1)
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(1)
    expect(await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, f.authority())).toEqual({ state: 'missing' })
  })

  it('retires rather than reusing the attach epoch at the protocol maximum', async () => {
    const f = fixture()
    const first = await open(f, f.authority())
    const run = [...(f.service as any).runs.values()][0]
    run.info = { ...run.info, epoch: TERMINAL_LIMITS.sequence }
    const attached = await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, f.authority())
    expect(attached).toEqual({ state: 'missing' })
    expect(f.ptys[0].state.killed).toBe(1)
  })

  it('holds output until the attach result is delivered, so no event races the snapshot', async () => {
    const f = fixture()
    const first = await open(f, f.authority())
    f.ptys[0].data('before-attach')
    await tick()
    const attached = await f.service.invoke('terminal.attach', { sessionId: first.session.sessionId }, f.authority()) as any
    expect(attached.snapshot).toBe('SCREEN|before-attach')
    // Output produced during the attach window is not emitted before the result.
    f.ptys[0].data('during-attach')
    await Promise.resolve()
    expect(f.events.filter((event) => event.data === 'during-attach')).toEqual([])
    await tick()
    const during = f.events.filter((event) => event.data === 'during-attach')
    expect(during).toHaveLength(1)
    expect(during[0].epoch).toBe(attached.epoch)
    expect(during[0].sequence).toBeGreaterThan(attached.sequence)
  })

  it('validates params at the invoke boundary and results before returning them', async () => {
    const f = fixture()
    await expect(f.service.invoke('terminal.write', { sessionId: 'session-1', sequence: 1, data: 'x' }, f.authority()))
      .rejects.toThrow('INVALID_PARAMS')
    const first = await open(f, f.authority())
    await expect(f.service.invoke('terminal.list', { path: '/private' }, f.authority())).rejects.toThrow('INVALID_PARAMS')
    expect(first.session.cwd).toBe('/Users/example/project')
  })
})
