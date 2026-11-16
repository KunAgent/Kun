import { describe, expect, it, vi } from 'vitest'
import { RemoteSimulatorService, type SimulatorAuthority, type SimulatorBackend } from './service'
import { RawSimulatorFrames } from './frames'
const udid = '4C58782A-1055-48FC-910C-3A12AE320426'
const origin = { kind: 'code' as const, id: 'thread' }
function fixture() {
  let live = true
  const authority: SimulatorAuthority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant',
    scopes: ['personal', 'desktop.view', 'desktop.control'], current: () => live }
  const stream = { frame: vi.fn(async () => ({ image: 'data:image/jpeg;base64,/9j/AA==', width: 402, height: 874, capturedAt: Date.now() })), stop: vi.fn(async () => {}) }
  const backend: SimulatorBackend = { supported: () => true, available: async () => true,
    list: async () => [{ udid, name: 'QA', runtime: 'iOS', state: 'Booted' }], boot: vi.fn(async () => {}),
    stream: vi.fn(async () => stream), input: vi.fn(async () => {}) }
  const authorize = vi.fn(async () => {}), service = new RemoteSimulatorService(backend, authorize)
  const start = () => service.invoke('simulator.start', { origin, udid, startId: 'start' }, authority) as Promise<{ sessionId: string }>
  return { authority, stream, backend, service, authorize, start, revoke: () => { live = false } }
}
describe('simulator session authorization and lifetime', () => {
  it('prevents direct and relay hosts from simultaneously controlling the same device', async () => {
    const relay = fixture(), direct = fixture()
    await relay.start()
    try { await expect(direct.start()).rejects.toThrow('SIMULATOR_BUSY') }
    finally { await relay.service.stopAll() }
    await direct.start(); await direct.service.stopAll()
  })
  it('authorizes the source, owns one device and refuses replayed or foreign inputs', async () => {
    const f = fixture(), session = await f.start()
    expect(f.authorize).toHaveBeenCalledWith(origin, f.authority)
    expect((await f.start()).sessionId).toBe(session.sessionId)
    const p = { sessionId: session.sessionId, sequence: 1, input: { kind: 'tap', x: 0.5, y: 0.5 } }
    await f.service.invoke('simulator.input', p, f.authority)
    await expect(f.service.invoke('simulator.input', p, f.authority)).rejects.toThrow('SIMULATOR_INPUT_REPLAY')
    await expect(f.service.invoke('simulator.frame', { sessionId: session.sessionId }, { ...f.authority, deviceId: 'another' })).rejects.toThrow('SIMULATOR_NOT_ALLOWED')
    expect(f.backend.input).toHaveBeenCalledTimes(1)
    await f.service.stopAll()
    expect(f.stream.stop).toHaveBeenCalledTimes(1)
  })
  it('refuses view-only input and tears down a revoked stream without shutting down the device', async () => {
    const f = fixture(), session = await f.start()
    await expect(f.service.invoke('simulator.input', { sessionId: session.sessionId, sequence: 1, input: { kind: 'button', button: 'home' } },
      { ...f.authority, scopes: ['personal', 'desktop.view'] })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    f.revoke(); await f.service.sweep()
    expect(f.stream.stop).toHaveBeenCalledTimes(1)
    expect(f.backend.boot).not.toHaveBeenCalled()
  })
  it('does not expose a stream that finishes starting after shutdown', async () => {
    const f = fixture()
    let release!: (v: typeof f.stream) => void
    f.backend.stream = vi.fn(() => new Promise<typeof f.stream>(resolve => { release = resolve }))
    const starting = f.start()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.service.stopAll(); release(f.stream)
    await expect(starting).rejects.toThrow('SIMULATOR_AUTHORITY_CHANGED')
    expect(f.stream.stop).toHaveBeenCalledTimes(1)
  })
})
describe('bounded raw frame decoder', () => {
  it('handles fragmented/coalesced packets, bounds memory and removes stale images on end', async () => {
    const parser = new RawSimulatorFrames(() => ({ image: 'data:image/jpeg;base64,/9j/AA==', width: 100, height: 200 }))
    const header = Buffer.alloc(4); header.writeUInt32BE(3)
    const first = parser.first()
    parser.accept(header.subarray(0, 2)); parser.accept(Buffer.concat([header.subarray(2), Buffer.from('abc'), header, Buffer.from('def')]))
    await first; expect(parser.snapshot().width).toBe(100)
    parser.end(); expect(() => parser.snapshot()).toThrow('SIMULATOR_FRAME_STALE')
    const invalid = new RawSimulatorFrames(() => { throw Error('never') })
    invalid.accept(Buffer.from([255, 255, 255, 255])); await expect(invalid.first()).rejects.toThrow('SIMULATOR_STREAM_ENDED')
  })
})
