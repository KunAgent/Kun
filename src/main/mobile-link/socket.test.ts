import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { MobileLinkSockets, mobileSocketProxy } from './socket'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } } }))
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as net.AddressInfo).port
}
async function localRelay() {
  let upgrades = 0, connects = 0, proxySawTicket = false, originSawTicket = false
  const origin = http.createServer(), proxy = http.createServer()
  const relay = new WebSocketServer({ noServer: true })
  const pipes = new Set<Duplex>()
  const originPort = await listen(origin), proxyPort = await listen(proxy)
  origin.on('upgrade', (request, socket, head) => {
    upgrades++
    originSawTicket = request.headers.authorization === 'Ticket local-test-ticket'
    relay.handleUpgrade(request, socket, head, (ws) => relay.emit('connection', ws, request))
  })
  relay.on('connection', (ws) => ws.on('message', (data) => ws.send(data)))
  proxy.on('connect', (request, socket, head) => {
    connects++
    proxySawTicket = Boolean(request.headers.authorization)
    const target = net.connect(originPort, '127.0.0.1')
    pipes.add(socket); pipes.add(target)
    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
    target.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) target.write(head)
      target.pipe(socket).pipe(target)
    })
  })
  cleanups.push(async () => {
    for (const ws of relay.clients) ws.terminate()
    for (const socket of pipes) socket.destroy()
    await new Promise<void>((resolve) => relay.close(() => resolve()))
    await Promise.all([origin, proxy].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  })
  return { url: 'ws://127.0.0.1:' + originPort + '/relay',
    rule: 'PROXY 127.0.0.1:' + proxyPort,
    counts: () => ({ upgrades, connects, proxySawTicket, originSawTicket }) }
}
async function exchange(ws: WebSocket) {
  const reply = once(ws, 'message')
  await once(ws, 'open')
  ws.send('local-route-probe')
  expect(String((await reply)[0])).toBe('local-route-probe')
  const closed = once(ws, 'close')
  ws.close()
  await closed
}

describe('mobile WSS follows the Electron HTTP proxy policy', () => {
  it('uses an actual HTTP CONNECT tunnel instead of the old Node direct route', async () => {
    const relay = await localRelay()
    await exchange(new WebSocket(relay.url, { headers: { Authorization: 'Ticket local-test-ticket' } }))
    expect(relay.counts()).toMatchObject({ upgrades: 1, connects: 0 })
    const rules = vi.fn(async () => relay.rule), diagnostic = vi.fn()
    const sockets = new MobileLinkSockets(rules, diagnostic)
    cleanups.push(() => sockets.dispose())
    await exchange(sockets.open(relay.url, { Authorization: 'Ticket local-test-ticket' }) as unknown as WebSocket)
    expect(relay.counts()).toEqual({ upgrades: 2, connects: 1, proxySawTicket: false, originSawTicket: true })
    expect(rules).toHaveBeenCalledWith(relay.url.replace('ws:', 'http:'))
    expect(diagnostic).toHaveBeenCalledWith('WSS_PROXY')
  })
  it('re-resolves each connection and honors a first DIRECT rule instead of a later proxy', async () => {
    const relay = await localRelay()
    let policy = 'DIRECT; ' + relay.rule
    const rules = vi.fn(async () => policy)
    const sockets = new MobileLinkSockets(rules)
    cleanups.push(() => sockets.dispose())
    await exchange(sockets.open(relay.url, {}) as unknown as WebSocket)
    expect(relay.counts().connects).toBe(0)
    policy = relay.rule
    await exchange(sockets.open(relay.url, {}) as unknown as WebSocket)
    expect(relay.counts().connects).toBe(1)
    expect(rules).toHaveBeenCalledTimes(2)
  })
  it('fails closed on an unsupported proxy policy without leaking resolver errors or bypassing it', async () => {
    const relay = await localRelay(), diagnostic = vi.fn()
    const sockets = new MobileLinkSockets(async () => { throw new Error('private resolver content') }, diagnostic)
    cleanups.push(() => sockets.dispose())
    const socket = sockets.open(relay.url, {}) as unknown as WebSocket
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve))
    expect(error.message).toBe('PROXY_RESOLUTION_FAILED')
    expect(relay.counts().upgrades).toBe(0)
    expect(diagnostic.mock.calls).toEqual([['WSS_PROXY_RESOLUTION_FAILED']])
    await expect(mobileSocketProxy('wss://relay.test/ws', async () => 'INVALID hidden; DIRECT'))
      .rejects.toThrow('PROXY_RESOLUTION_FAILED')
  })
  it('keeps pending-handshake cancellation safe after RemoteClient removes its error callback', async () => {
    const relay = await localRelay()
    let release!: (rule: string) => void
    const sockets = new MobileLinkSockets(() => new Promise((resolve) => { release = resolve }))
    cleanups.push(() => sockets.dispose())
    const socket = sockets.open(relay.url, {}) as unknown as WebSocket
    await new Promise((resolve) => setImmediate(resolve))
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    socket.onerror = null
    socket.close()
    await closed
    release('DIRECT')
    await new Promise((resolve) => setImmediate(resolve))
    expect(relay.counts().upgrades).toBe(0)
  })
  it('uses HTTPS proxy rules for secure upgrades and keeps supported SOCKS/HTTPS routes', async () => {
    for (const [rule, expected] of [
      ['PROXY 127.0.0.1:8080', 'http://127.0.0.1:8080/'],
      ['HTTPS proxy.invalid:443', 'https://proxy.invalid/'],
      ['SOCKS5 proxy.invalid:1080', 'socks5://proxy.invalid:1080']
    ]) {
      const rules = vi.fn(async () => rule)
      expect(await mobileSocketProxy('wss://relay.test/ws', rules)).toBe(expected)
      expect(rules).toHaveBeenCalledWith('https://relay.test/ws')
    }
    await expect(mobileSocketProxy('wss://user:password@relay.test/ws', async () => 'DIRECT'))
      .rejects.toThrow('INVALID_RELAY_URL')
    await expect(mobileSocketProxy('wss://relay.test/ws?ticket=not-allowed', async () => 'DIRECT'))
      .rejects.toThrow('INVALID_RELAY_URL')
  })
})
