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
      // The grace covers a phone lock screen — 5 minutes, not 60 seconds.
      vi.advanceTimersByTime(5 * 60_000 + 1_000)
      expect(sender.isDestroyed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the client entry briefly after sender expiry and recreates the sender on reattach', () => {
    vi.useFakeTimers()
    try {
      const hub = new RemoteEventHub()
      const first = fakeStream()
      const client = hub.attachStream('client-1', first)
      const sender = client.sender
      ;(first as unknown as { emitClose: () => void }).emitClose()
      // An invoke-only gap re-arms idle cleanup; the sender still expires.
      vi.advanceTimersByTime(5 * 60_000 - 1_000)
      hub.clientFor('client-1')
      vi.advanceTimersByTime(5 * 60_000 + 1_000)
      expect(sender.isDestroyed()).toBe(true)
      // Events buffered while expired survive until the retention elapses.
      hub.emitToClient('client-1', 'runtime:sse-error', { streamId: 's-1', code: 'remote_client_expired' })
      const stream = fakeStream()
      const reattached = hub.attachStream('client-1', stream)
      expect(reattached.sender).not.toBe(sender)
      expect(reattached.sender.isDestroyed()).toBe(false)
      // The recreated sender is announced before the buffered terminal so the
      // renderer resubscribes every stream it owned on the old sender.
      expect(stream.written.length).toBe(2)
      expect(stream.written[0]).toContain('remote:sender-reset')
      expect(stream.written[1]).toContain('remote_client_expired')
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits remote:sender-reset when a resume attach finds no client entry', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream, { resume: true })
    expect(stream.written.length).toBe(1)
    expect(stream.written[0]).toContain('remote:sender-reset')
  })

  it('does not emit remote:sender-reset on a first attach or a live reconnect', () => {
    const hub = new RemoteEventHub()
    const first = fakeStream()
    hub.attachStream('client-1', first)
    expect(first.written.some((frame) => frame.includes('remote:sender-reset'))).toBe(false)
    const second = fakeStream()
    hub.attachStream('client-1', second, { resume: true })
    expect(second.written.some((frame) => frame.includes('remote:sender-reset'))).toBe(false)
  })

  it('drops the most-buffered stream backlog with a per-stream terminal error', () => {
    const hub = new RemoteEventHub()
    const sender = hub.clientFor('client-1')
    const overflowed: string[][] = []
    sender.on('remote:streams-overflowed', (ids: unknown) => {
      overflowed.push(ids as string[])
    })
    for (let i = 0; i < 300; i += 1) {
      hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-a', seq: i })
    }
    for (let i = 0; i < 300; i += 1) {
      hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-b', seq: i })
    }
    expect(overflowed.flat()).toEqual(['s-a'])
    // Late frames for the overflowed stream must not reopen the reconciled gap.
    hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-a', seq: 999 })
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    const written = stream.written.join('')
    expect(written).toContain('remote_buffer_overflow')
    expect(written).toContain('"streamId":"s-a"')
    expect(written).not.toContain('"streamId":"s-a","seq":999')
    // The other stream's backlog survived the drop untouched.
    expect(written).toContain('"streamId":"s-b","seq":299')
  })

  it('evicts lossy mirror frames before touching stream data or control frames', () => {
    const hub = new RemoteEventHub()
    hub.clientFor('client-1')
    for (let i = 0; i < 500; i += 1) {
      hub.emitToClient('client-1', 'terminal:data', { streamId: 'term-1', chunk: i })
    }
    hub.emitToClient('client-1', 'runtime:sse-error', { streamId: 's-1', code: 'remote_client_expired' })
    for (let i = 0; i < 30; i += 1) {
      hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-1', seq: i })
    }
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    const written = stream.written.join('')
    expect(written).toContain('remote_client_expired')
    expect(written).toContain('"seq":29')
    expect(written).not.toContain('remote_buffer_overflow')
  })
})
