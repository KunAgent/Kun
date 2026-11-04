import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_LIMITS, validateTerminalEvent, validateTerminalResult } from '@kun/remote-protocol'
import {
  RemoteTerminalService, splitOutput,
  type TerminalAuthority, type TerminalPty, type TerminalReceiver, type TerminalSpawnSpec
} from './session-service'
import type { TerminalScreen, TerminalScreenFactory } from './screen'

const tick = () => new Promise((resolve) => setTimeout(resolve, 6))
const TERMINAL_RETENTION = TERMINAL_LIMITS.retentionMs

function fakeScreens() {
  // Bounded like a real screen: it keeps the visible tail, not the whole stream.
  const created: Array<{ writes: string[]; cols: number; rows: number; disposed: boolean; text: string }> = []
  const factory: TerminalScreenFactory = {
    create(cols, rows) {
      const state = { writes: [] as string[], cols, rows, disposed: false, text: '' }
      const screen: TerminalScreen = {
        write: (data) => {
          if (state.disposed) return
          state.writes.push(data)
          state.text = (state.text + data).slice(-4096)
        },
        resize: (nextCols, nextRows) => { state.cols = nextCols; state.rows = nextRows },
        flush: async () => {},
        capture: async () => state.disposed ? '' : `SCREEN|${state.text}`,
        serialize: () => state.disposed ? '' : `SCREEN|${state.text}`,
        dispose: () => { state.disposed = true }
      }
      created.push(state)
      return screen
    }
  }
  return { factory, created }
}

function fakePty(receive: TerminalReceiver) {
  const state = { writes: [] as string[], resizes: [] as Array<[number, number]>, killed: 0, dead: false }
  const pty: TerminalPty = {
    write(data) { if (state.dead) throw new Error('closed'); state.writes.push(data) },
    resize(cols, rows) { state.resizes.push([cols, rows]) },
    async kill() { state.dead = true; state.killed += 1 }
  }
  return { state, pty, data: (value: string) => receive.data(value), exit: (code: number) => receive.exit(code) }
}

type Fixture = ReturnType<typeof fixture>

function fixture(options: {
  scopes?: TerminalAuthority['scopes']
  cwd?: () => string
  deferred?: boolean
  supported?: boolean
} = {}) {
  let current = true
  let remaining = 60_000
  let clock = 1_000
  let ids = 0
  const events: unknown[] = []
  const ptys: Array<ReturnType<typeof fakePty>> = []
  const spawns: Array<{ spec: TerminalSpawnSpec; receive: TerminalReceiver; cancelled: () => boolean }> = []
  const pendingSpawns: Array<() => void> = []
  const screens = fakeScreens()
  const activity = { show: vi.fn(), update: vi.fn(), hide: vi.fn() }
  const originRequests: Array<{ kind: string; id: string }> = []
  const authority: TerminalAuthority = {
    accountId: 'account', deviceId: 'phone', authorizationId: 'authorization',
    scopes: options.scopes ?? ['personal', 'desktop.view', 'desktop.control'],
    current: () => current,
    validForMs: () => remaining,
    emit: (event) => { events.push(event) }
  }
  const service = new RemoteTerminalService({
    resolveOrigin: async (_authority, origin) => {
      originRequests.push(origin)
      return { cwd: options.cwd ? options.cwd() : '/Users/example/project' }
    },
    spawn: vi.fn(async (spec: TerminalSpawnSpec, receive: TerminalReceiver, cancelled: () => boolean) => {
      const entry = fakePty(receive)
      ptys.push(entry)
      spawns.push({ spec, receive, cancelled })
      if (options.deferred) await new Promise<void>((resolve) => pendingSpawns.push(resolve))
      return entry.pty
    }),
    screens: screens.factory,
    supported: () => options.supported ?? true,
    now: () => clock,
    id: () => `session-${++ids}`,
    activity
  })
  return {
    service, authority, events, ptys, spawns, activity, originRequests, screens,
    other: (deviceId: string): TerminalAuthority => ({ ...authority, deviceId }),
    revoke: () => { current = false; remaining = 0 },
    restore: () => { current = true; remaining = 60_000 },
    advance: (ms: number) => { clock += ms },
    releaseSpawns: () => { pendingSpawns.splice(0).forEach((resolve) => resolve()) }
  }
}

async function open(f: Fixture, overrides: Record<string, unknown> = {}) {
  return f.service.invoke('terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' }, ...overrides }, f.authority) as Promise<any>
}

describe('remote terminal sessions', () => {
  it('opens a desktop-resolved shell and answers a valid snapshot', async () => {
    const f = fixture()
    const snapshot = await open(f, { cols: 100, rows: 30 })
    expect(validateTerminalResult('terminal.open', snapshot)).toBe(snapshot)
    expect(snapshot.session).toMatchObject({ cwd: '/Users/example/project', cols: 100, rows: 30, epoch: 1, state: 'running' })
    expect(f.spawns[0].spec).toEqual({ origin: { kind: 'code', id: 'thread' }, cwd: '/Users/example/project', cols: 100, rows: 30 })
    expect(f.originRequests).toEqual([{ kind: 'code', id: 'thread' }])
    expect(f.activity.show).toHaveBeenCalledTimes(1)
    expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions).toHaveLength(1)
  })

  it('advertises terminal.v1 only when supported and authorized', () => {
    const enabled = fixture()
    expect(enabled.service.capabilities(['personal', 'desktop.view', 'desktop.control'])).toEqual(['terminal.v1'])
    expect(enabled.service.descriptors(['personal', 'desktop.view', 'desktop.control'])).toHaveLength(6)
    expect(enabled.service.descriptors(['personal', 'desktop.view'])).toEqual([])
    expect(enabled.service.capabilities(['personal'])).toEqual([])
    expect(fixture({ supported: false }).service.capabilities(['personal', 'desktop.view', 'desktop.control'])).toEqual([])
  })

  it('refuses to open when the host backend is unavailable', async () => {
    const f = fixture({ supported: false })
    await expect(open(f)).rejects.toThrow('TERMINAL_UNSUPPORTED')
    expect(f.spawns).toHaveLength(0)
  })

  it('never exposes one controller’s session to another', async () => {
    const f = fixture()
    const snapshot = await open(f)
    expect((await f.service.invoke('terminal.list', {}, f.other('other-phone')) as any).sessions).toEqual([])
    expect(await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.other('other-phone'))).toEqual({ state: 'missing' })
    await expect(f.service.invoke('terminal.write',
      { sessionId: snapshot.session.sessionId, epoch: 1, sequence: 1, data: 'ls' }, f.other('other-phone')))
      .rejects.toThrow('TERMINAL_SESSION_ENDED')
    expect(f.ptys[0].state.writes).toEqual([])
  })

  it('refuses a view-only grant before touching the host', async () => {
    const f = fixture({ scopes: ['personal', 'desktop.view'] })
    await expect(open(f)).rejects.toThrow('TERMINAL_CONTROL_REQUIRED')
    expect(f.spawns).toHaveLength(0)
    expect(f.originRequests).toHaveLength(0)
  })

  it('rejects an origin the desktop cannot resolve to an absolute path', async () => {
    for (const cwd of ['relative/project', '', '/tmp/\0bad']) {
      const f = fixture({ cwd: () => cwd })
      await expect(open(f)).rejects.toThrow('TERMINAL_ORIGIN_UNAVAILABLE')
      expect(f.spawns).toHaveLength(0)
      expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions).toEqual([])
    }
  })

  it('fences stale authorization and ends the session on revocation', async () => {
    const f = fixture()
    const snapshot = await open(f)
    f.revoke()
    await expect(f.service.invoke('terminal.write',
      { sessionId: snapshot.session.sessionId, epoch: 1, sequence: 1, data: 'ls' }, f.authority))
      .rejects.toThrow('TERMINAL_AUTHORITY_CHANGED')
    expect(f.ptys[0].state.writes).toEqual([])
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(1)
    f.restore()
    expect(await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.authority)).toEqual({ state: 'missing' })
  })

  it('ends the peer’s terminals immediately when the grant changes', async () => {
    const f = fixture()
    const snapshot = await open(f)
    f.service.authorityChanged('phone')
    await tick()
    expect(f.ptys[0].state.killed).toBe(1)
    expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions).toEqual([])
    await expect(f.service.invoke('terminal.write',
      { sessionId: snapshot.session.sessionId, epoch: 1, sequence: 1, data: 'ls' }, f.authority))
      .rejects.toThrow('TERMINAL_SESSION_ENDED')
  })

  it('treats a duplicate start and a duplicate write as a single effect', async () => {
    const f = fixture()
    const first = await open(f)
    const again = await open(f)
    expect(again.session.sessionId).toBe(first.session.sessionId)
    expect(again.epoch).toBe(1)
    expect(f.spawns).toHaveLength(1)
    await expect(open(f, { cols: 120 })).rejects.toThrow('INVALID_REQUEST')
    await expect(open(f, { origin: { kind: 'agent', id: 'agent' } })).rejects.toThrow('INVALID_REQUEST')

    const call = { sessionId: first.session.sessionId, epoch: 1, sequence: 1, data: 'ls\r' }
    expect(await f.service.invoke('terminal.write', call, f.authority)).toEqual({ accepted: true, sequence: 1 })
    expect(await f.service.invoke('terminal.write', call, f.authority)).toEqual({ accepted: true, sequence: 1 })
    expect(f.ptys[0].state.writes).toEqual(['ls\r'])
  })

  it('rejects a sequence gap and a stale epoch instead of replaying keys', async () => {
    const f = fixture()
    const snapshot = await open(f)
    const id = snapshot.session.sessionId
    await expect(f.service.invoke('terminal.write', { sessionId: id, epoch: 1, sequence: 2, data: 'ls' }, f.authority))
      .rejects.toThrow('TERMINAL_SEQUENCE_GAP')
    await f.service.invoke('terminal.write', { sessionId: id, epoch: 1, sequence: 1, data: 'a' }, f.authority)

    const attached = await f.service.invoke('terminal.attach', { sessionId: id }, f.authority) as any
    expect(attached.epoch).toBe(2)
    expect(attached.inputSequence).toBe(0)
    await expect(f.service.invoke('terminal.write', { sessionId: id, epoch: 1, sequence: 2, data: 'b' }, f.authority))
      .rejects.toThrow('TERMINAL_STALE_EPOCH')
    await expect(f.service.invoke('terminal.write', { sessionId: id, epoch: 2, sequence: 2, data: 'c' }, f.authority))
      .rejects.toThrow('TERMINAL_SEQUENCE_GAP')
    expect(await f.service.invoke('terminal.write', { sessionId: id, epoch: 2, sequence: 1, data: 'c' }, f.authority))
      .toEqual({ accepted: true, sequence: 1 })
    expect(f.ptys[0].state.writes).toEqual(['a', 'c'])
  })

  it('chunks and sheds output, and re-attach repaints from screen state', async () => {
    const f = fixture()
    const snapshot = await open(f)
    const id = snapshot.session.sessionId
    for (let index = 0; index < 200; index++) f.ptys[0].data('x'.repeat(8192))
    await tick()
    const output = f.events.filter((event: any) => event.event === 'terminal.output') as any[]
    expect(output.length).toBeGreaterThan(0)
    expect(output.length).toBeLessThanOrEqual(64)
    for (const event of output) expect(validateTerminalEvent(event)).toBe(event)
    const sequences = output.map((event) => event.sequence)
    // Shedding removes the oldest prefix; even a contiguous retained suffix
    // must trigger recovery against the client's previous baseline (zero).
    expect(sequences[0]).toBeGreaterThan(snapshot.sequence + 1)
    expect(f.screens.created[0].writes).toHaveLength(200)

    const attached = await f.service.invoke('terminal.attach', { sessionId: id }, f.authority) as any
    expect(validateTerminalResult('terminal.attach', attached)).toBe(attached)
    // The snapshot is the serialized screen, never a raw output suffix.
    expect(attached.snapshot.startsWith('SCREEN|')).toBe(true)
    expect(attached.snapshot.length).toBeLessThanOrEqual('SCREEN|'.length + 4096)
    expect(attached.sequence).toBe(200)
    const before = f.events.length
    await tick()
    expect(f.events.length).toBe(before)
  })

  it('splits frames on the byte budget and never tears a surrogate pair', () => {
    for (const value of ['a'.repeat(9000), '你'.repeat(4000), '😀'.repeat(3000)]) {
      const parts = splitOutput(value)
      expect(parts.join('')).toBe(value)
      for (const part of parts) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(8192)
    }
    expect(splitOutput('').length).toBe(0)
  })

  it('reports exit after the final chunk and keeps the session for re-attach', async () => {
    const f = fixture()
    const snapshot = await open(f)
    f.ptys[0].data('done\n')
    f.ptys[0].exit(0)
    await tick()
    const [output, exited] = f.events as any[]
    expect(validateTerminalEvent(output)).toBe(output)
    expect(validateTerminalEvent(exited)).toBe(exited)
    expect(exited.event).toBe('terminal.exited')
    expect(exited.sequence).toBe(output.sequence + 1)
    const attached = await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.authority) as any
    expect(attached.state).toBe('exited')
    expect(attached.session.exitCode).toBe(0)
    expect(validateTerminalResult('terminal.attach', attached)).toBe(attached)
    await expect(f.service.invoke('terminal.write',
      { sessionId: snapshot.session.sessionId, epoch: attached.epoch, sequence: 1, data: 'x' }, f.authority))
      .rejects.toThrow('TERMINAL_SESSION_ENDED')
    expect(f.activity.hide).toHaveBeenCalled()
  })

  it('kills a PTY that is still spawning when the host stops', async () => {
    const f = fixture({ deferred: true })
    const opening = open(f)
    await tick()
    const closing = f.service.stopAll('application_quit')
    f.releaseSpawns()
    await expect(opening).rejects.toThrow('TERMINAL_START_CANCELLED')
    await closing
    expect(f.ptys[0].state.killed).toBe(1)
    expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions).toEqual([])
    await expect(open(f)).rejects.toThrow('TERMINAL_START_RETIRED')
  })

  it('closes idempotently, disposes the screen and retires the start id', async () => {
    const f = fixture()
    const snapshot = await open(f)
    const first = await f.service.invoke('terminal.close', { sessionId: snapshot.session.sessionId, reason: 'user_closed' }, f.authority)
    expect(first).toEqual({ state: 'closed', sessionId: snapshot.session.sessionId, reason: 'user_closed', confirmed: true })
    expect(validateTerminalResult('terminal.close', first)).toBe(first)
    expect(f.ptys[0].state.killed).toBe(1)
    expect(f.screens.created[0].disposed).toBe(true)
    expect(await f.service.invoke('terminal.close', { sessionId: snapshot.session.sessionId, reason: 'again' }, f.authority))
      .toEqual({ state: 'missing' })
    await expect(open(f)).rejects.toThrow('TERMINAL_START_RETIRED')
    expect(await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.authority)).toEqual({ state: 'missing' })
  })

  it('retires a detached session after the retention window', async () => {
    const f = fixture()
    const snapshot = await open(f)
    f.service.peerGone('phone')
    f.advance(4 * 60_000)
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(0)
    expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions).toHaveLength(1)
    f.advance(61_000)
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(1)
    expect(await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.authority)).toEqual({ state: 'missing' })
  })

  it('keeps sessions across a transport drop but reclaims them later', async () => {
    const f = fixture()
    const snapshot = await open(f)
    f.service.detachAll()
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(0)
    f.advance(TERMINAL_RETENTION)
    await f.service.sweep()
    expect(f.ptys[0].state.killed).toBe(1)
    expect(await f.service.invoke('terminal.attach', { sessionId: snapshot.session.sessionId }, f.authority)).toEqual({ state: 'missing' })
  })

  it('limits each controller to a fixed number of terminals', async () => {
    const f = fixture()
    for (let index = 0; index < 4; index++) await open(f, { startId: `start-${index}` })
    await expect(open(f, { startId: 'start-4' })).rejects.toThrow('BACKPRESSURE')
    expect(f.spawns).toHaveLength(4)
  })

  it('resizes the live terminal, its screen and reports the applied size', async () => {
    const f = fixture()
    const snapshot = await open(f)
    const result = await f.service.invoke('terminal.resize', { sessionId: snapshot.session.sessionId, cols: 90, rows: 20 }, f.authority)
    expect(result).toEqual({ accepted: true, cols: 90, rows: 20 })
    expect(f.ptys[0].state.resizes).toEqual([[90, 20]])
    expect(f.screens.created[0]).toMatchObject({ cols: 90, rows: 20 })
    expect((await f.service.invoke('terminal.list', {}, f.authority) as any).sessions[0]).toMatchObject({ cols: 90, rows: 20 })
  })
})
