import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteDesktopService, type DesktopAuthority, type DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { DesktopInputArbiter } from './input-arbiter'
import type { CaptureEvent } from '../../shared/remote-desktop'
import { validateDesktopEvent, validateDesktopDataMessage } from '@kun/remote-protocol'
import { EventEmitter } from 'node:events'
import { bindDesktopPrivacyStops } from './host-lifecycle'

const services: RemoteDesktopService[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000) })
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.stopAll().catch(() => {}))); vi.useRealTimers() })
function fixture(autoHealth = true) {
  let id = 0, live = true, fingerprint = 'display-geometry'
  const events: unknown[] = [], captures: any[] = [], inputs: any[] = []
  const arbiter = new DesktopInputArbiter()
  const deps: DesktopEngineDependencies = {
    supported: () => true, permissions: async () => ({ screenRecording: 'granted', accessibility: 'granted' }),
    displays: () => [{ id: 123, fingerprint, label: 'Mac', pixelWidth: 2560, pixelHeight: 1600, rotation: 0 }],
    capture: (_display, receive) => {
      const value = { open: vi.fn(async () => {}), identity: vi.fn(async () => ({ pid: 42, birth: '1:2' })),
        start: vi.fn(async () => ({ type: 'offer' as const, sdp: 'v=0\r\n' })), answer: vi.fn(async () => {}), ice: vi.fn(async () => {}),
        send: vi.fn(async (label: string, data: unknown) => { validateDesktopDataMessage(data, label as any, 'host') }), quality: vi.fn(async () => {}), stop: vi.fn(async () => {}), event: receive }
      captures.push(value); return value
    },
    input: lost => { const value = { start: vi.fn(async () => {}), lease: vi.fn(async () => {}), input: vi.fn(async () => {}), release: vi.fn(async () => {}), stop: vi.fn(async () => {}), lost }; inputs.push(value); return value },
    ice: vi.fn(async () => []), authorizeOrigin: vi.fn(async () => {}), now: Date.now, id: () => `id-${++id}`, arbiter,
    indicator: { show: vi.fn(), update: vi.fn(), hide: vi.fn() }
  }
  const authority: DesktopAuthority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'authority', scopes: ['personal', 'desktop.view', 'desktop.control'], current: () => live, emit: value => { validateDesktopEvent(value); events.push(value) } }
  const service = new RemoteDesktopService(deps); services.push(service)
  const setup = async () => { const status = await service.status(); await service.configure({ enabled: true, displayTokens: status.displays.map(display => display.token) }) }
  const startParams = async (startId = 'start') => { const status = await service.status(), display = status.displays[0]; return { startId, origin: { kind: 'code', id: 'thread' }, displayToken: display.token, displayRevision: display.revision, quality: 'balanced' } }
  const start = async (startId = 'start') => service.invoke('desktop.session.start', await startParams(startId), authority) as Promise<any>
  let sampleId = 0
  const health = (extra: Record<string, unknown> = {}) => captures.at(-1).event({ event: 'health', value: {
    sampleId: ++sampleId, trackState: 'live', muted: false, sourceFrames: 10, framesEncoded: 10, framesSent: 10, ...extra
  } })
  const data = (session: any, type: string, seq: number, extra: Record<string, unknown> = {}, channel = 'kun.desktop.control.v1') => { captures.at(-1).event({ event: 'data', value: {
    label: channel, raw: JSON.stringify({ v: 1, sessionId: session.sessionId, epoch: session.epoch, type, seq, ...extra })
  } } as CaptureEvent); if (type === 'hello' && autoHealth) health() }
  return { service, deps, authority, events, captures, inputs, arbiter, setup, start, startParams, data, health, offline: () => { live = false }, changeDisplay: () => { fingerprint = 'different' } }
}
describe('RemoteDesktopService', () => {
  it('reports OS permissions independently of sharing and display selection, and rechecks revocations', async () => {
    const f = fixture()
    expect(await f.service.status()).toMatchObject({ enabled: false, ready: false, screenRecordingReady: true, inputReady: true })
    await f.setup()
    expect(await f.service.status()).toMatchObject({ ready: true, screenRecordingReady: true })
    f.deps.permissions = async () => ({ screenRecording: 'denied', accessibility: 'denied' })
    expect(await f.service.status()).toMatchObject({ ready: false, screenRecordingReady: false, inputReady: false })
  })
  it('reports actionable connection failures on the computer without retaining raw upstream errors', async () => {
    const f = fixture(); await f.setup()
    f.deps.permissions = async () => ({ screenRecording: 'denied', accessibility: 'granted' })
    await expect(f.start()).rejects.toThrow('SCREEN_PERMISSION_REQUIRED')
    expect((await f.service.status()).lastFailure).toBe('SCREEN_PERMISSION_REQUIRED')
    await f.setup()
    expect((await f.service.status()).lastFailure).toBeUndefined()
    f.deps.permissions = async () => ({ screenRecording: 'granted', accessibility: 'granted' })
    f.deps.ice = async () => { throw Error('private-vendor-token') }
    await expect(f.start('next')).rejects.toThrow('private-vendor-token')
    expect((await f.service.status()).lastFailure).toBe('DESKTOP_CONNECTION_FAILED')
  })
  it('enables the primary display without a separate selection or permission bypass', async () => {
    const f = fixture()
    f.deps.displays = () => [
      { id: 1, fingerprint: 'external', label: 'External', pixelWidth: 1920, pixelHeight: 1080, rotation: 0 },
      { id: 2, primary: true, fingerprint: 'primary', label: 'Primary', pixelWidth: 2560, pixelHeight: 1600, rotation: 0 }
    ]
    f.deps.permissions = async () => ({ screenRecording: 'denied', accessibility: 'denied' })
    const status = await f.service.configureRemoteAccess(true)
    expect(status).toMatchObject({ enabled: true, ready: false, screenRecordingReady: false, inputReady: false })
    expect(status.displays.filter(d => d.allowed).map(d => d.label)).toEqual(['Primary'])
    await expect(f.start()).rejects.toThrow()
    expect(f.captures).toHaveLength(0)
    await f.service.configureRemoteAccess(false)
    expect(await f.service.status()).toMatchObject({ enabled: false, ready: false })
  })
  it('a delayed unified enable cannot overwrite a newer stop or owner change', async () => {
    const f = fixture()
    let release!: () => void
    vi.spyOn(f.service, 'stopAll').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const enabling = f.service.configureRemoteAccess(true).catch(error => error)
    await f.service.configureRemoteAccess(false)
    release()
    expect(await enabling).toMatchObject({ message: 'DESKTOP_AUTHORITY_CHANGED' })
    expect((await f.service.status()).enabled).toBe(false)
    await expect(f.service.configureRemoteAccess(true, () => false)).rejects.toThrow('DESKTOP_AUTHORITY_CHANGED')
    expect((await f.service.status()).enabled).toBe(false)
  })
  it('unsupported hosts keep desktop disabled without breaking mobile access', async () => {
    const f = fixture(); f.deps.supported = () => false
    expect(await f.service.configureRemoteAccess(true)).toMatchObject({ enabled: false, supported: false })
  })
  it('requires separate local enablement and desktop view authorization', async () => {
    const f = fixture()
    await expect(f.start()).rejects.toThrow('DESKTOP_DISABLED')
    await f.setup(); f.authority.scopes = ['personal']
    await expect(f.start()).rejects.toThrow('DESKTOP_VIEW_REQUIRED')
    expect(f.captures).toHaveLength(0)
  })
  it('owns one session, deduplicates matching startId and rejects conflicting starts', async () => {
    const f = fixture(); await f.setup(); const result = await f.start()
    expect((await f.start()).session.sessionId).toBe(result.session.sessionId)
    expect(f.captures).toHaveLength(1)
    await expect(f.start('second')).rejects.toThrow('DESKTOP_BUSY')
    await expect(f.service.invoke('desktop.session.start', { ...await f.startParams(), quality: 'sharp' }, f.authority)).rejects.toThrow('INVALID_REQUEST')
  })
  it('a cancel that arrives before start prevents future allocation', async () => {
    const f = fixture(); await f.setup()
    const ended = await f.service.invoke('desktop.session.cancel', { startId: 'cancelled', reason: 'user' }, f.authority)
    expect(ended).toMatchObject({ state: 'ended', confirmed: true })
    expect(await f.start('cancelled')).toEqual(ended); expect(f.captures).toHaveLength(0)
  })
  it('cancel during ICE fetch cannot resurrect a late capture', async () => {
    const f = fixture(); await f.setup()
    let resolve!: (value: unknown[]) => void
    f.deps.ice = () => new Promise(done => { resolve = done })
    const start = f.start().catch(error => error)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await f.service.invoke('desktop.session.cancel', { startId: 'start', reason: 'user' }, f.authority)
    resolve([]); await start; expect(f.captures).toHaveLength(0)
  })
  it('only emits host candidates after the answer is accepted', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    f.captures[0].event({ event: 'ice', value: { candidates: [], complete: true } })
    expect(f.events).toHaveLength(0)
    await f.service.invoke('desktop.session.answer', { sessionId: session.sessionId, epoch: session.epoch, answer: { type: 'answer', sdp: 'v=0\r\n' } }, f.authority)
    expect(f.events).toContainEqual(expect.objectContaining({ event: 'desktop.signal.ice', complete: true }))
  })
  it('requires authenticated hello and fresh heartbeat before accepting input', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    await expect(f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)).rejects.toThrow('DESKTOP_CONTROL_REQUIRED')
    f.data(session, 'hello', 1)
    await vi.advanceTimersByTimeAsync(250)
    const probe = f.captures[0].send.mock.calls.find((call: any[]) => call[1].type === 'probe')![1]
    f.data(session, 'probe.ack', 2, { challenge: probe.challenge })
    const control = await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority) as any
    const key = { controlEpoch: control.controlEpoch, displayRevision: session.display.revision, challenge: probe.challenge, code: 'ShiftLeft', pressed: true }
    f.data(session, 'key', 1, key, 'kun.desktop.input.v1')
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(f.inputs[0].input).toHaveBeenCalledTimes(1)
    f.data(session, 'key', 1, key, 'kun.desktop.input.v1')
    expect(f.inputs[0].input).toHaveBeenCalledTimes(1)
    expect(() => f.arbiter.beginAi()).toThrow('HUMAN_CONTROL_ACTIVE')
    await f.service.invoke('desktop.session.stop', { sessionId: session.sessionId, observedEpoch: 1, reason: 'user' }, f.authority)
    expect(f.inputs[0].release).toHaveBeenCalled(); expect(() => f.arbiter.beginAi()).not.toThrow()
  })
  it('stop works with a stale observed epoch, and repeated stop confirms the same terminated session', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    f.data(session, 'hello', 1)
    await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'recover' }, f.authority)
    const args = { sessionId: session.sessionId, observedEpoch: 1, reason: 'user' }
    const ended = await f.service.invoke('desktop.session.stop', args, f.authority)
    expect(await f.service.invoke('desktop.session.stop', args, f.authority)).toEqual(ended)
    expect(f.captures[1].stop).toHaveBeenCalledTimes(1); expect(f.inputs[1].stop).toHaveBeenCalledTimes(1)
    f.data(session, 'hello', 1); expect(f.captures[1].send).not.toHaveBeenCalled()
  })
  it('does not claim cleanup success until native resource shutdown succeeds', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    f.captures[0].stop.mockRejectedValueOnce(Error('not-dead'))
    const args = { sessionId: session.sessionId, observedEpoch: 1, reason: 'user' }
    await expect(f.service.invoke('desktop.session.stop', args, f.authority)).rejects.toThrow('DESKTOP_CLEANUP_UNCONFIRMED')
    expect(f.events.some((event: any) => event.event === 'desktop.session.ended')).toBe(false)
    await expect(f.service.invoke('desktop.session.stop', args, f.authority)).resolves.toMatchObject({ state: 'ended', confirmed: true })
  })
  it.each(['authority', 'display', 'heartbeat'])('ends safely on %s invalidation', async reason => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    if (reason === 'authority') f.offline()
    if (reason === 'display') f.changeDisplay()
    await vi.advanceTimersByTimeAsync(reason === 'heartbeat' ? 6250 : 250)
    expect(f.captures[0].stop).toHaveBeenCalled(); expect(f.inputs[0].stop).toHaveBeenCalled()
  })
  it('another paired phone cannot stop or inspect this phone session', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    const other = { ...f.authority, deviceId: 'other' }
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, other)).toEqual({ state: 'missing' })
    expect(await f.service.invoke('desktop.session.stop', { sessionId: session.sessionId, observedEpoch: 1, reason: 'other' }, other)).toEqual({ state: 'missing' })
    expect(f.captures[0].stop).not.toHaveBeenCalled()
  })
  it('serializes duplicate release and reacquire without dropping newer input ownership', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    let finish!: () => void
    f.inputs[0].release.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const release = f.service.invoke('desktop.control.release', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    const acquire = f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(() => f.arbiter.beginAi()).toThrow('HUMAN_CONTROL_ACTIVE')
    finish(); await release; await acquire
    expect(() => f.arbiter.beginAi()).toThrow('HUMAN_CONTROL_ACTIVE')
    await expect(f.service.invoke('desktop.control.release', { sessionId: session.sessionId, epoch: 2 }, f.authority)).rejects.toThrow('DESKTOP_STALE_EPOCH')
    expect(f.arbiter.owns(session.sessionId)).toBe(true)
  })
  it('intentional refresh and late initial callbacks cannot close the replacement media', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    f.captures[0].stop.mockImplementationOnce(async () => { f.captures[0].event({ event: 'closed' }) })
    f.inputs[0].stop.mockImplementationOnce(async () => { f.inputs[0].lost() })
    const result = await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }, f.authority) as any
    expect(result.session.epoch).toBe(2)
    f.captures[0].event({ event: 'closed' }); f.inputs[0].lost()
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, f.authority)).toMatchObject({ session: { epoch: 2 } })
    expect(f.captures[1].stop).not.toHaveBeenCalled()
  })
  it('a healthy refresh has a bounded fresh setup window, but stale media cannot renew itself by reconnecting', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }, f.authority)
    await vi.advanceTimersByTimeAsync(7000)
    expect(f.captures[1].stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8250)
    expect(f.captures[1].stop).toHaveBeenCalled()
    const g = fixture(); await g.setup(); const started = await g.start(); g.data(started.session, 'hello', 1)
    await vi.advanceTimersByTimeAsync(4000)
    await g.service.invoke('desktop.session.reconnect', { sessionId: started.session.sessionId, epoch: 1, attemptId: 'fault' }, g.authority)
    await vi.advanceTimersByTimeAsync(2250)
    expect(g.captures[1].stop).toHaveBeenCalled()
  })
  it('caps native and capture activity to the underlying WSS authority deadline', async () => {
    const f = fixture(); await f.setup(); f.authority.validForMs = () => Math.max(0, 101500 - Date.now())
    const { session } = await f.start(); f.data(session, 'hello', 1)
    expect(f.inputs[0].lease).toHaveBeenCalledWith(1500)
    await vi.advanceTimersByTimeAsync(1750)
    expect(f.captures[0].stop).toHaveBeenCalled()
  })
  it('deduplicates a pending reconnect and refuses competing attempts and negotiation churn', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    let finish!: (value: unknown[]) => void
    f.deps.ice = vi.fn(() => new Promise<unknown[]>(resolve => { finish = resolve }))
    const args = { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }
    const first = f.service.invoke('desktop.session.reconnect', args, f.authority)
    const duplicate = f.service.invoke('desktop.session.reconnect', args, f.authority)
    await expect(f.service.invoke('desktop.session.reconnect', { ...args, attemptId: 'other' }, f.authority)).rejects.toThrow('DESKTOP_BUSY')
    expect(f.deps.ice).toHaveBeenCalledTimes(1)
    finish([]); expect(await duplicate).toEqual(await first)
    await expect(f.service.invoke('desktop.session.reconnect', { ...args, epoch: 2, attemptId: 'again' }, f.authority)).rejects.toThrow('DESKTOP_BUSY')
    expect(f.captures).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(15250)
    expect(f.captures[1].stop).toHaveBeenCalledTimes(1)
  })
  it('a pending old send or guard rejection cannot end a replacement capture', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start()
    let rejectSend!: (reason: Error) => void, rejectLease!: (reason: Error) => void
    f.captures[0].send.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSend = reject }))
    f.inputs[0].lease.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectLease = reject }))
    f.data(session, 'hello', 1)
    await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }, f.authority)
    rejectSend(Error('old media closed')); rejectLease(Error('old helper closed'))
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(f.captures[1].stop).not.toHaveBeenCalled()
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, f.authority)).toMatchObject({ state: 'negotiating', session: { epoch: 2 } })
  })
  it('a delayed releaseAll lifts keys without relinquishing newly acquired control', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    await f.service.invoke('desktop.control.release', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    const control = await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    f.data(session, 'input.releaseAll', 2)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(f.inputs[0].release).toHaveBeenCalledTimes(2)
    expect(f.arbiter.owns(session.sessionId)).toBe(true)
    expect(await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)).toEqual(control)
  })
  it('caps a fresh renegotiation setup window to remaining authorization', async () => {
    const f = fixture(); await f.setup(); f.authority.validForMs = () => Math.max(0, 104000 - Date.now())
    const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }, f.authority)
    await vi.advanceTimersByTimeAsync(4250)
    expect(f.captures[1].stop).toHaveBeenCalledTimes(1)
  })
  it('a late old answer cannot accept the replacement epoch or flush its candidates', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    let finish!: () => void
    f.captures[0].answer.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const answer = f.service.invoke('desktop.session.answer', { sessionId: session.sessionId, epoch: 1, answer: { type: 'answer', sdp: 'v=0\r\n' } }, f.authority)
    const rejected = expect(answer).rejects.toThrow('DESKTOP_STALE_EPOCH')
    await f.service.invoke('desktop.session.reconnect', { sessionId: session.sessionId, epoch: 1, attemptId: 'rotation' }, f.authority)
    f.captures[1].event({ event: 'ice', value: { candidates: [], complete: true } })
    finish(); await rejected
    expect(f.events.some((event: any) => event.event === 'desktop.signal.ice' && event.epoch === 2)).toBe(false)
    await f.service.invoke('desktop.session.answer', { sessionId: session.sessionId, epoch: 2, answer: { type: 'answer', sdp: 'v=0\r\n' } }, f.authority)
    expect(f.events).toContainEqual(expect.objectContaining({ event: 'desktop.signal.ice', epoch: 2 }))
  })
  it('requires fresh real sender health before granting input and releases control when health expires', async () => {
    const f = fixture(false); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    const args = { sessionId: session.sessionId, epoch: 1 }
    await expect(f.service.invoke('desktop.control.acquire', args, f.authority)).rejects.toThrow('DESKTOP_CONTROL_REQUIRED')
    f.health(); await f.service.invoke('desktop.control.acquire', args, f.authority)
    await vi.advanceTimersByTimeAsync(2250)
    expect(f.inputs[0].release).toHaveBeenCalled()
    expect(f.arbiter.owns(session.sessionId)).toBe(false)
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, f.authority)).toMatchObject({ state: 'viewing' })
    await expect(f.service.invoke('desktop.control.acquire', args, f.authority)).rejects.toThrow('DESKTOP_CONTROL_REQUIRED')
  })
  it.each([{ muted: true }, { trackState: 'ended' }, { framesEncoded: null }, { framesSent: null }])('disables input for an explicit media anomaly %j', async anomaly => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    f.health(anomaly)
    for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(f.arbiter.owns(session.sessionId)).toBe(false)
    expect(f.inputs[0].release).toHaveBeenCalled()
  })
  it('retains control on a live static screen even when duplicate source frames grow without new encoded frames', async () => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); f.data(session, 'hello', 1)
    await f.service.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: 1 }, f.authority)
    let seq = 1
    for (let sample = 1; sample <= 8; sample++) {
      await vi.advanceTimersByTimeAsync(500); f.health({ sourceFrames: 10 + sample })
      const probe = f.captures[0].send.mock.calls.filter((call: any[]) => call[1].type === 'probe').at(-1)?.[1]
      if (probe) f.data(session, 'probe.ack', ++seq, { challenge: probe.challenge })
    }
    expect(f.arbiter.owns(session.sessionId)).toBe(true)
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, f.authority)).toMatchObject({ state: 'controlling' })
  })
  it.each(['lock-screen', 'suspend', 'user-did-resign-active'])('ends capture/input on %s without restarting on resume', async event => {
    const f = fixture(); await f.setup(); const { session } = await f.start(); const power = new EventEmitter()
    bindDesktopPrivacyStops(power, reason => f.service.stopAll(reason)); power.emit(event)
    for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(f.captures[0].stop).toHaveBeenCalledTimes(1); expect(f.inputs[0].stop).toHaveBeenCalledTimes(1)
    power.emit('unlock-screen'); power.emit('resume'); power.emit('user-did-become-active')
    expect(f.captures).toHaveLength(1)
    expect(await f.service.invoke('desktop.session.get', { sessionId: session.sessionId }, f.authority)).toMatchObject({ state: 'ended', reason: 'host_inactive', confirmed: true })
  })
})
