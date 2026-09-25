import { describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { RemoteEventHub } from './remote-events'

type FakeStream = ServerResponse & {
  written: string[]
  ids: string[]
  setBacklog: (bytes: number) => void
  on: (ev: string, cb: () => void) => void
}

function fakeStream(options: { writeReturnsFalse?: boolean } = {}): FakeStream {
  const written: string[] = []
  // id-only SSE blocks (the hub epoch) are recorded apart from event frames.
  const ids: string[] = []
  const listeners = new Map<string, Array<() => void>>()
  const stream = {
    written,
    ids,
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    write(chunk: string) {
      const id = /^id: (.*)\n\n$/.exec(chunk)
      if (id) ids.push(id[1] ?? '')
      else written.push(chunk)
      return !options.writeReturnsFalse
    },
    end() {
      stream.writableEnded = true
      return stream
    },
    destroy() {
      stream.destroyed = true
      stream.emitClose()
      return stream
    },
    setBacklog(bytes: number) {
      stream.writableLength = bytes
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
  return stream as unknown as FakeStream
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

  it('stamps every attach with the hub epoch as the SSE event id', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    expect(stream.ids).toEqual([hub.epoch])
  })

  it('emits remote:sender-reset when a native retry echoes another hub epoch', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    // No resume flag: the browser's own EventSource retry only carries Last-Event-ID.
    hub.attachStream('client-1', stream, { lastEventId: 'previous-hub-epoch' })
    expect(stream.written[0]).toContain('remote:sender-reset')
  })

  it('emits remote:sender-reset for a native retry of a forgotten client on the same hub', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream, { lastEventId: hub.epoch })
    expect(stream.written[0]).toContain('remote:sender-reset')
  })

  it('does not reset a native retry of a client the hub still knows', () => {
    const hub = new RemoteEventHub()
    const first = fakeStream()
    hub.attachStream('client-1', first)
    ;(first as unknown as { emitClose: () => void }).emitClose()
    const retry = fakeStream()
    hub.attachStream('client-1', retry, { lastEventId: hub.epoch })
    expect(retry.written.some((frame) => frame.includes('remote:sender-reset'))).toBe(false)
  })

  it('still resets when an invoke recreated the forgotten entry before the stream reattached', () => {
    const hub = new RemoteEventHub()
    // The returning page's first invoke races ahead of its EventSource.
    hub.clientFor('client-1')
    const stream = fakeStream()
    hub.attachStream('client-1', stream, { resume: true })
    expect(stream.written[0]).toContain('remote:sender-reset')
  })

  it('closes every client bound to a session token on disconnectClientsForSession', () => {
    const hub = new RemoteEventHub()
    const streamA = fakeStream()
    const clientA = hub.attachStream('client-a', streamA, { sessionToken: 'tok-1' })
    const clientB = hub.attachStream('client-b', fakeStream(), { sessionToken: 'tok-2' })
    // An invoke-only client bound to the same session is torn down too.
    const senderC = hub.clientFor('client-c', { sessionToken: 'tok-1' })
    hub.disconnectClientsForSession('tok-1')
    expect(streamA.writableEnded).toBe(true)
    expect(clientA.sender.isDestroyed()).toBe(true)
    expect(senderC.isDestroyed()).toBe(true)
    expect(clientB.sender.isDestroyed()).toBe(false)
    expect(hub.clientInfos().map((info) => info.id)).toEqual(['client-b'])
  })

  it('drops a stalled stream once its socket backlog exceeds the byte cap', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    // Simulate a client that stopped reading: accepted frames sit in the
    // socket buffer far above the per-connection cap.
    stream.setBacklog(8 * 1024 * 1024)
    hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-1', seq: 7 })
    expect(stream.destroyed).toBe(true)
    // Later events land in the bounded buffer instead of a dead socket.
    hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-1', seq: 8 })
    const retry = fakeStream()
    hub.attachStream('client-1', retry, { resume: true })
    const written = retry.written.join('')
    // A sender-reset precedes the replay so every subscription resyncs; the
    // frame accepted by write() before the drop is never resent.
    expect(written).toContain('remote:sender-reset')
    expect(written).toContain('"seq":8')
    expect(written).not.toContain('"seq":7')
  })

  it('does not drop or duplicate a frame merely because write() returned false', () => {
    const hub = new RemoteEventHub()
    const stream = fakeStream({ writeReturnsFalse: true })
    hub.attachStream('client-1', stream)
    hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-1', seq: 1 })
    hub.emitToClient('client-1', 'runtime:sse-event', { streamId: 's-1', seq: 2 })
    // write(false) already queued the frame — the stream stays open and each
    // event is written exactly once while the byte cap is not exceeded.
    expect(stream.destroyed).toBe(false)
    expect(stream.written).toHaveLength(2)
    expect(stream.written[0]).toContain('"seq":1')
    expect(stream.written[1]).toContain('"seq":2')
  })

  it('evicts only as many lossy frames as needed to fit the backlog', () => {
    const hub = new RemoteEventHub()
    hub.clientFor('client-1')
    for (let i = 0; i < 513; i += 1) {
      hub.emitToClient('client-1', 'terminal:data', { sessionId: 'term-1', chunk: i })
    }
    const stream = fakeStream()
    hub.attachStream('client-1', stream)
    expect(stream.written).toHaveLength(512)
    expect(stream.written[0]).toContain('"chunk":1}')
    expect(stream.written[511]).toContain('"chunk":512}')
  })
})
