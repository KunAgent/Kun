import { it, expect, vi } from 'vitest'
import { fork, type Serializable } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RpcPeer } from '@kun/control-host'
import { ControlDesktop } from './desktop'
import { ControlRelay } from './transport'
import { DesktopInputArbiter } from '../remote-desktop/input-arbiter'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission } from './admission'
import type { DesktopAuthority, DesktopEngineDependencies } from '@kun/control-runtime/desktop'

async function processFixture(handlers: Record<string, (value: any) => any>, event: (name: string, value: any) => void) {
  const root = dirname(createRequire(import.meta.url).resolve('@kun/control-runtime/package.json'))
  const path = join(root, 'baselines', `${process.platform}-${process.arch}`, 'runtime/index.mjs')
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
  let relay!: ControlRelay, socket: any, instance: Awaited<ReturnType<typeof processFixture>>
  const states: boolean[] = [], sends: string[] = []
  instance = await processFixture({
    'relay.ticket': () => relay.ticket(), 'relay.renew': () => relay.renew(),
    'relay.socket.open': value => relay.open(value.key, value.id),
    'relay.socket.send': value => relay.socketSend(value.id, value.data),
    'relay.socket.close': value => relay.socketClose(value.id)
  }, (name, value) => { if (name === 'relay.event') relay.event(value.event, value.value) })
  relay = new ControlRelay({ ticket: async () => ({ url: 'wss://authorized.test/ws', ticket: 'private-one-use-ticket' }),
    renew: async () => ({ expiresAt: Date.now() + 60000 }), state: value => states.push(value),
    socket: (url, headers) => {
      expect(url).toBe('wss://authorized.test/ws'); expect(headers.Authorization).toBe('Ticket private-one-use-ticket')
      socket = { bufferedAmount: 0, send: (data: string) => sends.push(data), close() {} }
      setTimeout(() => { socket.onopen?.(); socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 60000 } }) }) }, 10)
      return socket
    } }, async () => instance.rpc, () => {})
  try {
    relay.start(); await vi.waitFor(() => expect(states).toContain(true))
    relay.send({ kind: 'event', id: 'notice', dst: 'phone', payload: { example: true } })
    await vi.waitFor(() => expect(sends.some(value => value.includes('notice'))).toBe(true))
    const count = sends.filter(value => value.includes('notice')).length
    relay.reconnect(); await vi.waitFor(() => expect(states.filter(Boolean).length).toBe(2))
    expect(sends.filter(value => value.includes('notice'))).toHaveLength(count)
    expect(JSON.stringify(instance.messages)).not.toContain('private-one-use-ticket')
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
