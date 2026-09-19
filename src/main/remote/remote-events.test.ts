import { describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { RemoteEventHub } from './remote-events'

function fakeStream(): ServerResponse & { written: string[]; on: (ev: string, cb: () => void) => void } {
  const written: string[] = []
  const listeners = new Map<string, Array<() => void>>()
  const stream = {
    written,
    destroyed: false,
    writableEnded: false,
    write(chunk: string) {
      written.push(chunk)
      return true
    },
    end() {
      stream.writableEnded = true
      return stream
    },
    on(event: string, cb: () => void) {
      const list = listeners.get(event) ?? []
      list.push(cb)
      listeners.set(event, list)
      return stream
    },
    emitClose() {
      for (const cb of listeners.get('close') ?? []) cb()
    }
  }
  return stream as unknown as ServerResponse & { written: string[]; on: (ev: string, cb: () => void) => void }
}

describe('RemoteEventHub', () => {
  it('routes sender.send payloads to the owning client stream', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    const sender = hub.clientFor('client-1')
    sender.send('terminal:data', { chunk: 1 })
    expect(stream.written.length).toBe(1)
    expect(stream.written[0]).toContain('"channel":"terminal:data"')
  })

  it('drops channels outside the remote event allowlist', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    hub.clientFor('client-1').send('extension:view-event', { x: 1 })
    expect(stream.written).toEqual([])
  })

  it('buffers events while the client has no stream and flushes on reconnect', () => {
    const hub = new RemoteEventHub()
    const sender = hub.clientFor('client-1')
    sender.send('runtime:sse-event', { seq: 7 })
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    expect(stream.written.length).toBe(1)
    expect(stream.written[0]).toContain('"seq":7')
  })

  it('broadcasts only mirrored channels to every attached client', () => {
    const hub = new RemoteEventHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.attachStream('a', a)
    hub.attachStream('b', b)
    hub.broadcast('runtime:status', { state: 'ready' })
    hub.broadcast('tray:internal-refresh', { state: 'x' })
    expect(a.written.length).toBe(1)
    expect(a.written[0]).toContain('"channel":"runtime:status"')
    expect(b.written.length).toBe(1)
  })

  it('destroys senders on disconnectAll so owned sessions are released', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    const sender = hub.clientFor('client-1')
    hub.disconnectAll()
    expect(sender.isDestroyed()).toBe(true)
    expect(hub.clientInfos()).toEqual([])
  })

  it('reports connected clients', () => {
    const hub = new RemoteEventHub()
    hub.attachStream('client-9', fakeStream(), {
      remoteAddress: '192.168.1.9',
      userAgent: 'test-agent'
    })
    const [info] = hub.clientInfos()
    expect(info.id).toBe('client-9')
    expect(info.remoteAddress).toBe('192.168.1.9')
    expect(info.userAgent).toBe('test-agent')
  })

  it('cleans up the sender after the idle grace period once streams close', () => {
    vi.useFakeTimers()
    try {
      const hub = new RemoteEventHub()
      const stream = fakeStream()
      const client = hub.attachStream('client-1', stream)
      const sender = client.sender
      ;(stream as unknown as { emitClose: () => void }).emitClose()
      expect(sender.isDestroyed()).toBe(false)
      vi.advanceTimersByTime(61_000)
      expect(sender.isDestroyed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
