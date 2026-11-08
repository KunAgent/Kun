import { it, expect, vi } from 'vitest'
import { fork, type Serializable } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RpcPeer } from '@kun/control-host'
import { LIMITS } from '@kun/remote-protocol'
import { ControlDesktop } from './desktop'
import { ControlRelay } from './transport'
import { DesktopInputArbiter } from '../remote-desktop/input-arbiter'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission } from './admission'
import type { DesktopAuthority, DesktopEngineDependencies } from '@kun/control-runtime/desktop'

async function processFixture(handlers: Record<string, (value: any) => any>, event: (name: string, value: any) => void) {
  const root = dirname(createRequire(import.meta.url).resolve('@kun/control-runtime/package.json'))
  const path = process.env.KUN_CONTROL_RUNTIME_FIXTURE ?? join(root, 'baselines', `${process.platform}-${process.arch}`, 'runtime/index.mjs')
  const child = fork(path, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], env: {} })
  const generation = randomUUID(), messages: unknown[] = []
  const rpc = new RpcPeer(value => { messages.push(value); child.send(value as Serializable) }, generation, handlers, event)
  const exited = new Promise<void>(resolve => child.once('exit', () => { rpc.close(); resolve() }))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('start_timeout')), 5000)
    child.on('message', (value: any) => { if (value.type === 'ready') { clearTimeout(timer); resolve() } else void rpc.receive(value) })
    child.send({ type: 'bootstrap', generation })
  })
  return { rpc, messages, async stop() { rpc.close(); child.kill(); await exited } }
}
it('runs mobile transport out of process without exposing the ticket and reconnects without replay', async () => {
  let relay!: ControlRelay, socket: any, socketId = '', instance: Awaited<ReturnType<typeof processFixture>>
  const states: boolean[] = [], sends: string[] = [], diagnostics: string[] = []
  instance = await processFixture({
    'relay.ticket': () => relay.ticket(), 'relay.renew': () => relay.renew(),
    'relay.socket.open': value => { socketId = value.id; return relay.open(value.key, value.id) },
    'relay.socket.send': value => relay.socketSend(value.id, value.data),
    'relay.socket.close': value => relay.socketClose(value.id)
  }, (name, value) => { if (name === 'relay.event') relay.event(value.event, value.value) })
  relay = new ControlRelay({ ticket: async () => ({ url: 'wss://authorized.test/ws', ticket: 'private-one-use-ticket' }),
    renew: async () => ({ expiresAt: Date.now() + 60000 }),
    state: value => {
      states.push(value)
      // MobileLinkService notifies existing paired phones as soon as hello arrives.
      if (value) relay.send({ kind: 'resync_required', id: randomUUID(), dst: 'phone', payload: { reason: 'host_reconnected' } })
    },
    diagnostic: code => diagnostics.push(code),
    socket: (url, headers) => {
      expect(url).toBe('wss://authorized.test/ws'); expect(headers.Authorization).toBe('Ticket private-one-use-ticket')
      socket = { bufferedAmount: 0, send: (data: string) => sends.push(data), close() {} }
      setTimeout(() => { socket.onopen?.(); socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 60000 } }) }) }, 10)
      return socket
    } }, async () => instance.rpc, () => {})
  try {
    relay.start(); await vi.waitFor(() => expect(sends.filter(value => value.includes('host_reconnected'))).toHaveLength(1))
    expect(relay.online).toBe(true)
    expect(() => relay.send({ kind: 'result', id: 'too-large', dst: 'phone', payload: { text: 'x'.repeat(LIMITS.message) } })).toThrow('MESSAGE_LIMIT')
    expect(relay.online).toBe(true)
    relay.send({ kind: 'event', id: 'notice', dst: 'phone', payload: { example: true } })
    await vi.waitFor(() => expect(sends.some(value => value.includes('notice'))).toBe(true))
    const count = sends.filter(value => value.includes('notice')).length
    relay.reconnect(); await vi.waitFor(() => expect(sends.filter(value => value.includes('host_reconnected'))).toHaveLength(2))
    expect(states.filter(Boolean)).toHaveLength(2)
    expect(relay.online).toBe(true)
    expect(diagnostics).not.toContain('SOCKET_ERROR')
    const rejected = JSON.stringify({ v: 1, kind: 'invoke', id: 'forbidden', dst: 'phone', payload: {} })
    expect(() => relay.socketSend(socketId, rejected)).toThrow('CONTROL_RPC_REJECTED')
    expect(sends).not.toContain(rejected)
    expect(sends.filter(value => value.includes('notice'))).toHaveLength(count)
    expect(JSON.stringify(instance.messages)).not.toContain('private-one-use-ticket')
  } finally { relay.stop(); await instance.stop() }
})

it('keeps the broker usable after sender backpressure and reconnects without replaying the rejected result', async () => {
  let relay!: ControlRelay, socketId = ''
  const sockets: any[] = [], states: boolean[] = [], sends: string[] = []
  const instance = await processFixture({
    'relay.ticket': () => relay.ticket(), 'relay.renew': () => relay.renew(),
    'relay.socket.open': value => { socketId = value.id; return relay.open(value.key, value.id) },
    'relay.socket.send': value => relay.socketSend(value.id, value.data),
    'relay.socket.close': value => relay.socketClose(value.id)
  }, (name, value) => { if (name === 'relay.event') relay.event(value.event, value.value) })
  relay = new ControlRelay({ticket: async () => ({url: 'wss://authorized.test/ws', ticket: 'private-ticket'}),
    renew: async () => ({expiresAt: Date.now() + 60000}), state: online => states.push(online),
    socket: () => {
      const socket: any = {bufferedAmount: 0, send: (raw: string) => sends.push(raw), close: vi.fn()}
      sockets.push(socket)
      setTimeout(() => {socket.onopen?.(); socket.onmessage?.({data: JSON.stringify({v: 1, kind: 'hello', payload: {leaseExpiresAt: Date.now() + 60000}})})}, 10)
      return socket
    }
  }, async () => instance.rpc, () => {})
  try {
    relay.start(); await vi.waitFor(() => expect(relay.online).toBe(true))
    const oldSocket = socketId
    sockets[0].bufferedAmount = LIMITS.bytes
    relay.send({kind: 'event', id: 'warm', dst: 'phone', payload: {}})
    await vi.waitFor(() => expect(sends.some(raw => raw.includes('warm'))).toBe(true))
    sockets[0].bufferedAmount = 0
    // The round trip follows the buffer acknowledgement on the same IPC channel.
    await instance.rpc.call('health')
    relay.send({kind: 'result', id: 'rejected-result', dst: 'phone', payload: {}})
    await vi.waitFor(() => expect(states).toContain(false))
    // Also cover a later heartbeat observing the failed old connection.
    instance.rpc.notify('relay.socket.event', {id: oldSocket, event: 'error'})
    await vi.waitFor(() => expect(states.filter(Boolean)).toHaveLength(2), {timeout: 4000})
    expect(sockets).toHaveLength(2)
    relay.send({kind: 'event', id: 'after-reconnect', dst: 'phone', payload: {}})
    await vi.waitFor(() => expect(sends.some(raw => raw.includes('after-reconnect'))).toBe(true))
    expect(sends.some(raw => raw.includes('rejected-result'))).toBe(false)
  } finally {relay.stop(); await instance.stop()}
})

it('restores host registration after stop/start and ignores attachments while suspended', async () => {
  const registered = new Map<string, ControlRelay>(), states: boolean[] = [], sends: string[] = []
  const find = (id: string) => {
    const relay = registered.get(id)
    if (!relay) throw Error('CONTROL_RPC_REJECTED')
    return relay
  }
  const instance = await processFixture({
    'relay.ticket': value => find(value.id).ticket(), 'relay.renew': value => find(value.id).renew(),
    'relay.socket.open': value => find(value.clientId).open(value.key, value.id),
    'relay.socket.send': value => find(value.id.split(':')[0]).socketSend(value.id, value.data),
    'relay.socket.close': value => find(value.id.split(':')[0]).socketClose(value.id)
  }, (name, value) => { if (name === 'relay.event') registered.get(value.id)?.event(value.event, value.value) })
  const relay = new ControlRelay({
    ticket: async () => ({ url: 'wss://authorized.test/ws', ticket: 'private-ticket' }),
    renew: async () => ({ expiresAt: Date.now() + 60000 }), state: value => states.push(value),
    socket: () => {
      const socket: any = { bufferedAmount: 0, send: (data: string) => sends.push(data), close: vi.fn() }
      setTimeout(() => {
        socket.onopen?.()
        socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 60000 } }) })
      }, 10)
      return socket
    }
  }, async () => instance.rpc, tracked => {
    if (tracked) registered.set(relay.id, relay)
    else registered.delete(relay.id)
  })
  registered.set(relay.id, relay)
  try {
    for (let round = 0; round < 3; round++) {
      relay.start()
      await vi.waitFor(() => expect(states.filter(Boolean)).toHaveLength(round + 1))
      expect(relay.online).toBe(true)
      expect(registered.size).toBe(1)
      relay.send({ kind: 'event', id: `notice-${round}`, dst: 'phone', payload: { round } })
      await vi.waitFor(() => expect(sends).toHaveLength(round + 1))
      relay.stop()
      expect(relay.online).toBe(false)
      expect(registered.size).toBe(0)
      // A delayed host activation must not bind an idle relay without creating it.
      if (round === 1) await relay.attach(instance.rpc)
    }
  } finally { relay.stop(); await instance.stop() }
})

it('runs the desktop engine through real RPC while the host owns permissions, input arbitration and cleanup', async () => {
  let desktop!: ControlDesktop, capture: any, live = true
  const arbiter = new DesktopInputArbiter(), inputs: any[] = []
  const instance = await processFixture({ 'desktop.port': value => desktop.ports.call(value) }, (name, value) => {
    if (name === 'desktop.emit') desktop.emit(value.handle, value.event)
  })
  const deps: DesktopEngineDependencies = {
    supported: () => true, displays: () => [{ id: 1, primary: true, fingerprint: 'display', label: 'Synthetic', pixelWidth: 1280, pixelHeight: 720, rotation: 0 }],
    permissions: async () => ({ screenRecording: 'granted', accessibility: 'granted' }),
    capture: (_id, receive) => capture = { receive, open: async () => {}, identity: async () => ({ pid: 42, birth: '1:2' }),
      start: async () => ({ type: 'offer' as const, sdp: 'v=0\r\n' }), answer: async () => {}, ice: async () => {}, send: async () => {}, quality: async () => {}, stop: vi.fn(async () => {}) },
    input: () => { const input = { start: async () => {}, ready: async () => {}, setupLease: async () => {}, lease: async () => {}, input: vi.fn(async () => {}), release: vi.fn(async () => {}), stop: vi.fn(async () => {}) }; inputs.push(input); return input },
    ice: async () => [], authorizeOrigin: async () => {}, id: randomUUID, now: Date.now, arbiter
  }
  desktop = new ControlDesktop(deps, async () => instance.rpc)
  const authority: DesktopAuthority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant', scopes: ['desktop.view', 'desktop.control'], current: () => live, emit: () => {} }
  try {
    await desktop.attach(instance.rpc); await desktop.configureRemoteAccess(true)
    const display = (await desktop.status()).displays[0]
    const result = await desktop.invoke('desktop.session.start', { startId: 'start', origin: { kind: 'code', id: 'thread' }, displayToken: display.token, displayRevision: display.revision, quality: 'balanced' }, authority)
    const session = result.session
    await desktop.invoke('desktop.session.answer', { sessionId: session.sessionId, epoch: session.epoch, answer: { type: 'answer', sdp: 'v=0\r\n' } }, authority)
    capture.receive({ event: 'data', value: { label: 'kun.desktop.control.v1', raw: JSON.stringify({ v: 1, sessionId: session.sessionId, epoch: session.epoch, type: 'hello', seq: 0 }) } })
    capture.receive({ event: 'health', value: { sampleId: 1, trackState: 'live', muted: false, sourceFrames: 1, framesEncoded: 1, framesSent: 1 } })
    await vi.waitFor(async () => expect((await desktop.status()).active?.mode).toBe('view'))
    await desktop.invoke('desktop.control.acquire', { sessionId: session.sessionId, epoch: session.epoch }, authority)
    expect(() => arbiter.beginAi()).toThrow('HUMAN_CONTROL_ACTIVE')
    live = false; desktop.pulse()
    await desktop.stopAll('authorization_changed')
    expect(inputs[0].stop).toHaveBeenCalled(); expect(capture.stop).toHaveBeenCalled()
    expect(desktop.ports.busy()).toBe(false)
    arbiter.beginAi()()
  } finally { await desktop.stopAll().catch(() => {}); await instance.stop() }
})

it('the update admission gate drains accepted work and never admits a second mutation during switching', () => {
  resumeControlAdmission()
  const finishAcceptedRequest = admitControlOperation()
  expect(pauseControlAdmission()).toBe(false)
  finishAcceptedRequest()
  expect(pauseControlAdmission()).toBe(true)
  expect(() => admitControlOperation()).toThrow('CONTROL_UPDATING')
  resumeControlAdmission()
  admitControlOperation()()
})
