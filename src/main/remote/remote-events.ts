import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { RemoteAccessClientInfo } from '../../shared/remote-access'
import { RemoteClientSender } from './remote-sender'
import {
  REMOTE_ALLOWED_EVENT_CHANNELS,
  REMOTE_BROADCAST_EVENT_CHANNELS
} from './remote-allowlist'

const SSE_HEARTBEAT_MS = 25_000
const MAX_BUFFERED_EVENTS_PER_CLIENT = 512
// Phone lock screens suspend the EventSource for minutes at a time; keep the
// sender alive well beyond a typical lock so owned SSE streams survive.
const SENDER_IDLE_GRACE_MS = 5 * 60_000
// After the sender expires, keep the client entry briefly so its buffered
// terminal frames can still be delivered on the next attach; then forget it.
const EXPIRED_CLIENT_RETENTION_MS = 10 * 60_000
const MAX_EVENT_PAYLOAD_BYTES = 4 * 1024 * 1024
// Per-connection socket backlog bound. The event-count cap only applies while
// no stream is attached; a connected client that stops reading must not grow
// the response buffer without limit.
const MAX_SSE_PENDING_BYTES = 4 * 1024 * 1024

// Buffered-event tiers. `control` frames (stream terminals) are never evicted;
// `stream` frames belong to one owned SSE subscription and can be dropped per
// stream; `lossy` frames are high-frequency mirror data that is safe to drop.
const CONTROL_CHANNELS = new Set([
  'runtime:sse-error',
  'runtime:sse-end',
  'terminal:exit',
  'remote-ssh:terminal:exit'
])
const STREAM_DATA_CHANNELS = new Set(['runtime:sse-event', 'runtime:sse-open'])
const LOSSY_CHANNELS = new Set([
  'terminal:data',
  'remote-ssh:terminal:data',
  'file:workspace-changed',
  'browser-use:state'
])

type BufferedEventKind = 'control' | 'stream' | 'lossy' | 'normal'

type BufferedEvent = {
  channel: string
  payload: unknown
  kind: BufferedEventKind
  streamId?: string
}

type RemoteClient = {
  id: string
  sender: RemoteClientSender
  streams: Set<ServerResponse>
  buffered: BufferedEvent[]
  connectedAt: string
  remoteAddress: string
  userAgent: string
  /** Session that owns this client; revoke/expiry closes its streams. */
  sessionToken: string
  idleTimer: NodeJS.Timeout | null
  expiryTimer: NodeJS.Timeout | null
  overflowedStreams: Set<string>
  /** Set when a destroyed sender was replaced so the next attach learns it. */
  senderRecreated: boolean
  /** True once any EventSource attached to this entry. An entry created by an
   *  invoke (clientFor) that races ahead of the stream reattach is not "known"
   *  to the browser, so it must not suppress remote:sender-reset. */
  hasAttachedStream: boolean
}

function bufferedEventFor(channel: string, payload: unknown): BufferedEvent {
  const streamId = payload && typeof payload === 'object'
    ? (payload as { streamId?: unknown }).streamId
    : undefined
  return {
    channel,
    payload,
    kind: CONTROL_CHANNELS.has(channel)
      ? 'control'
      : STREAM_DATA_CHANNELS.has(channel)
        ? 'stream'
        : LOSSY_CHANNELS.has(channel)
          ? 'lossy'
          : 'normal',
    streamId: typeof streamId === 'string' ? streamId : undefined
  }
}

/**
 * Enforce the backlog bound without dropping control frames. Order:
 * lossy frames first, then every data frame of the single most-buffered
 * stream (replaced by one terminal overflow error per stream), then oldest
 * normal frames. Returns the stream ids whose backlog was dropped this round.
 */
function enforceBufferLimit(client: RemoteClient): Set<string> {
  const overflowedNow = new Set<string>()
  if (client.buffered.length <= MAX_BUFFERED_EVENTS_PER_CLIENT) return overflowedNow

  // Evict only as many of the oldest lossy frames as needed — one extra frame
  // must not wipe the whole buffered terminal/file-change backlog.
  let remaining = client.buffered
  let excess = remaining.length - MAX_BUFFERED_EVENTS_PER_CLIENT
  if (excess > 0) {
    remaining = remaining.filter((frame) => {
      if (excess > 0 && frame.kind === 'lossy') {
        excess -= 1
        return false
      }
      return true
    })
  }
  if (remaining.length <= MAX_BUFFERED_EVENTS_PER_CLIENT) {
    client.buffered = remaining
    return overflowedNow
  }

  // Drop one stream's entire data backlog at a time so its renderer receives a
  // deterministic `remote_buffer_overflow` error instead of a torn prefix.
  while (remaining.length > MAX_BUFFERED_EVENTS_PER_CLIENT) {
    const counts = new Map<string, number>()
    for (const frame of remaining) {
      if (frame.kind !== 'stream' || !frame.streamId) continue
      counts.set(frame.streamId, (counts.get(frame.streamId) ?? 0) + 1)
    }
    let target: string | undefined
    let targetCount = 0
    for (const [streamId, count] of counts) {
      if (count > targetCount) {
        target = streamId
        targetCount = count
      }
    }
    if (!target) break
    overflowedNow.add(target)
    client.overflowedStreams.add(target)
    remaining = remaining.filter(
      (frame) => !(frame.kind === 'stream' && frame.streamId === target)
    )
    remaining.push({
      channel: 'runtime:sse-error',
      payload: { streamId: target, code: 'remote_buffer_overflow' },
      kind: 'control',
      streamId: target
    })
  }

  // Still over: evict oldest non-control frames (normal channels and stream
  // frames that never carried a streamId). Control frames are never dropped.
  while (remaining.length > MAX_BUFFERED_EVENTS_PER_CLIENT) {
    const index = remaining.findIndex((frame) => frame.kind !== 'control')
    if (index < 0) break
    remaining.splice(index, 1)
  }
  client.buffered = remaining
  return overflowedNow
}

function writeSseFrame(res: ServerResponse, channel: string, payload: unknown): boolean {
  if (res.destroyed || res.writableEnded) return false
  let data: string
  try {
    data = JSON.stringify({ channel, payload })
  } catch {
    return false
  }
  if (data.length > MAX_EVENT_PAYLOAD_BYTES) return false
  try {
    res.write(`event: kun-ipc\ndata: ${data}\n\n`)
  } catch {
    return false
  }
  // write() returning false only means this frame was accepted and the next
  // batch must wait for drain — never resend it. The connection is dropped
  // once the accepted-but-undrained backlog passes the byte cap.
  return res.writableLength <= MAX_SSE_PENDING_BYTES
}

/** An id-only SSE block: sets the browser's lastEventId without dispatching. */
function writeSseEventId(res: ServerResponse, id: string): void {
  if (res.destroyed || res.writableEnded) return
  try {
    res.write(`id: ${id}\n\n`)
  } catch { /* best-effort */ }
}

/**
 * Tracks Remote browser clients and fans Electron-side `sender.send` calls out
 * as SSE frames. Events that arrive while a client has no open stream are
 * buffered briefly and flushed on reconnect.
 */
export class RemoteEventHub {
  private readonly clients = new Map<string, RemoteClient>()
  /**
   * Identifies this hub instance. Every attach writes it as the SSE event id,
   * so the browser echoes it back as `Last-Event-ID` on native EventSource
   * retries — a mismatch (app restarted) or an unknown client means every
   * stream registered before is gone.
   */
  readonly epoch = randomUUID()

  clientFor(
    clientId: string,
    meta: { remoteAddress?: string; userAgent?: string; sessionToken?: string } = {}
  ): RemoteClientSender {
    const client = this.ensureClient(clientId, meta)
    if (client.idleTimer) {
      clearTimeout(client.idleTimer)
      client.idleTimer = null
    }
    // An invoke-only client (no open SSE stream) must still age out — re-arm
    // the idle cleanup so repeated invokes without a stream cannot keep the
    // sender alive forever.
    if (client.streams.size === 0) this.scheduleIdleCleanup(client)
    return client.sender
  }

  attachStream(
    clientId: string,
    res: ServerResponse,
    meta: { remoteAddress?: string; userAgent?: string; sessionToken?: string; resume?: boolean; lastEventId?: string } = {}
  ): RemoteClient {
    const client = this.ensureClient(clientId, meta)
    const knownToBrowser = client.hasAttachedStream
    if (client.idleTimer) {
      clearTimeout(client.idleTimer)
      client.idleTimer = null
    }
    if (meta.remoteAddress) client.remoteAddress = meta.remoteAddress
    if (meta.userAgent) client.userAgent = meta.userAgent
    client.streams.add(res)
    // Tell the browser when its sender-side state was recreated: the idle
    // grace expired and ensureClient built a fresh sender; or a returning
    // browser (resume flag, or a native retry echoing Last-Event-ID) reached
    // an entry that never had a stream (forgotten after retention, or
    // recreated by an invoke that raced ahead); or the hub itself is new.
    // Owned streams are gone in every case, so the renderer must resubscribe.
    const lastEventId = meta.lastEventId?.trim() ?? ''
    const returning = meta.resume === true || lastEventId.length > 0
    const epochChanged = lastEventId.length > 0 && lastEventId !== this.epoch
    if (client.senderRecreated || epochChanged || (returning && !knownToBrowser)) {
      writeSseFrame(res, 'remote:sender-reset', {})
      client.senderRecreated = false
    }
    client.hasAttachedStream = true
    writeSseEventId(res, this.epoch)
    const pending = client.buffered
    client.buffered = []
    for (let index = 0; index < pending.length; index += 1) {
      const frame = pending[index]
      if (writeSseFrame(res, frame.channel, frame.payload)) continue
      // Unwritten frames survive for the next attach; the sender-reset flag
      // already forces a resync so ambiguous sent frames cannot leave a gap.
      client.buffered = pending.slice(index).concat(client.buffered)
      this.dropSlowStream(client, res)
      return client
    }
    client.overflowedStreams.clear()
    res.on('close', () => {
      client.streams.delete(res)
      this.scheduleIdleCleanup(client)
    })
    return client
  }

  detachStream(res: ServerResponse): void {
    for (const client of this.clients.values()) {
      if (client.streams.delete(res)) this.scheduleIdleCleanup(client)
    }
  }

  /** Event pushed to one client through its sender stub. */
  emitToClient(clientId: string, channel: string, payload: unknown): void {
    const client = this.clients.get(clientId)
    if (!client) return
    if (!REMOTE_ALLOWED_EVENT_CHANNELS.has(channel)) return
    if (client.streams.size === 0) {
      const frame = bufferedEventFor(channel, payload)
      // Data for a stream whose backlog was already dropped cannot be
      // delivered coherently — drop it rather than reopening a gap the
      // renderer reconciled via remote_buffer_overflow.
      if (
        frame.kind === 'stream' &&
        frame.streamId &&
        client.overflowedStreams.has(frame.streamId)
      ) {
        return
      }
      // browser-use:state is a status mirror — keep only the newest frame per
      // thread so a burst cannot crowd out control frames for other streams.
      if (channel === 'browser-use:state') {
        const threadId = payload && typeof payload === 'object'
          ? (payload as { threadId?: unknown }).threadId
          : undefined
        if (typeof threadId === 'string') {
          client.buffered = client.buffered.filter((existing) => {
            if (existing.channel !== 'browser-use:state') return true
            const existingThread = existing.payload && typeof existing.payload === 'object'
              ? (existing.payload as { threadId?: unknown }).threadId
              : undefined
            return existingThread !== threadId
          })
        }
      }
      client.buffered.push(frame)
      const overflowedNow = enforceBufferLimit(client)
      if (overflowedNow.size > 0) {
        // Ask the stream owners to stop the affected subscriptions now rather
        // than leaking upstream reads until the sender expires.
        client.sender.emit('remote:streams-overflowed', [...overflowedNow])
      }
      return
    }
    const stalled: ServerResponse[] = []
    for (const stream of client.streams) {
      if (!writeSseFrame(stream, channel, payload)) stalled.push(stream)
    }
    for (const stream of stalled) this.dropSlowStream(client, stream)
  }

  /** Broadcast push (mirrors of main-window webContents.send). */
  broadcast(channel: string, payload: unknown): void {
    if (!REMOTE_BROADCAST_EVENT_CHANNELS.has(channel)) return
    for (const client of this.clients.values()) {
      if (client.streams.size === 0) continue
      const stalled: ServerResponse[] = []
      for (const stream of client.streams) {
        if (!writeSseFrame(stream, channel, payload)) stalled.push(stream)
      }
      for (const stream of stalled) this.dropSlowStream(client, stream)
    }
  }

  clientInfos(): RemoteAccessClientInfo[] {
    const infos: RemoteAccessClientInfo[] = []
    for (const client of this.clients.values()) {
      infos.push({
        id: client.id,
        connectedAt: client.connectedAt,
        remoteAddress: client.remoteAddress,
        userAgent: client.userAgent
      })
    }
    return infos
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) {
      for (const stream of client.streams) {
        try {
          stream.end()
        } catch { /* best-effort */ }
      }
      client.streams.clear()
      client.sender.destroy()
      if (client.idleTimer) clearTimeout(client.idleTimer)
      if (client.expiryTimer) clearTimeout(client.expiryTimer)
    }
    this.clients.clear()
  }

  destroyClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return
    for (const stream of client.streams) {
      try {
        stream.end()
      } catch { /* best-effort */ }
    }
    client.streams.clear()
    client.sender.destroy()
    if (client.idleTimer) clearTimeout(client.idleTimer)
    if (client.expiryTimer) clearTimeout(client.expiryTimer)
    this.clients.delete(clientId)
  }

  /** Closes every client bound to a session (logout, expiry, eviction). */
  disconnectClientsForSession(token: string): void {
    for (const client of [...this.clients.values()]) {
      if (client.sessionToken === token) this.destroyClient(client.id)
    }
  }

  /**
   * A stream that stopped draining grows an unbounded socket backlog; cut it
   * so the browser retries into the bounded buffered/replay path instead of
   * accumulating memory in the main process.
   */
  private dropSlowStream(client: RemoteClient, stream: ServerResponse): void {
    if (!client.streams.delete(stream)) return
    // Force a sender-reset on the next attach: frames accepted into the socket
    // before it was destroyed may or may not have reached the browser, so
    // every subscription resyncs rather than trusting a torn sequence.
    client.senderRecreated = true
    try {
      stream.destroy()
    } catch { /* best-effort */ }
    this.scheduleIdleCleanup(client)
  }

  private ensureClient(
    clientId: string,
    meta: { remoteAddress?: string; userAgent?: string; sessionToken?: string }
  ): RemoteClient {
    const existing = this.clients.get(clientId)
    if (existing) {
      if (meta.sessionToken) existing.sessionToken = meta.sessionToken
      if (existing.sender.isDestroyed()) {
        // The idle grace elapsed; hand the client a fresh sender so owned
        // stream registrations bind to a live channel again. Flag it so the
        // next attachStream emits remote:sender-reset before buffered frames.
        if (existing.expiryTimer) {
          clearTimeout(existing.expiryTimer)
          existing.expiryTimer = null
        }
        existing.sender = new RemoteClientSender(clientId, (channel, payload) =>
          this.emitToClient(clientId, channel, payload)
        )
        existing.connectedAt = new Date().toISOString()
        existing.senderRecreated = true
      }
      return existing
    }
    const client: RemoteClient = {
      id: clientId,
      sender: new RemoteClientSender(clientId, (channel, payload) =>
        this.emitToClient(clientId, channel, payload)
      ),
      streams: new Set(),
      buffered: [],
      connectedAt: new Date().toISOString(),
      remoteAddress: meta.remoteAddress ?? '',
      userAgent: meta.userAgent ?? '',
      sessionToken: meta.sessionToken ?? '',
      idleTimer: null,
      expiryTimer: null,
      overflowedStreams: new Set(),
      senderRecreated: false,
      hasAttachedStream: false
    }
    this.clients.set(clientId, client)
    this.scheduleIdleCleanup(client)
    return client
  }

  /**
   * A client with no open stream keeps its sender for a grace period so SSE
   * reconnects do not destroy owned watches/terminals; after that it is torn
   * down exactly like a closed webContents. The entry itself lingers briefly
   * so buffered terminal frames still reach a client that comes back.
   */
  private scheduleIdleCleanup(client: RemoteClient): void {
    if (client.streams.size > 0 || client.idleTimer) return
    client.idleTimer = setTimeout(() => {
      client.idleTimer = null
      if (client.streams.size > 0) return
      client.sender.destroy()
      if (!client.expiryTimer) {
        client.expiryTimer = setTimeout(() => {
          client.expiryTimer = null
          if (client.streams.size > 0 || !client.sender.isDestroyed()) return
          this.clients.delete(client.id)
        }, EXPIRED_CLIENT_RETENTION_MS)
        client.expiryTimer.unref?.()
      }
    }, SENDER_IDLE_GRACE_MS)
    client.idleTimer.unref?.()
  }
}

export function remoteSseHeaders(): Record<string, string> {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  }
}

export function startSseHeartbeat(res: ServerResponse): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(timer)
      return
    }
    // Do not add heartbeat bytes to an already-overflowing socket; the event
    // path drops the stalled stream itself.
    if (res.writableLength > MAX_SSE_PENDING_BYTES) return
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(timer)
    }
  }, SSE_HEARTBEAT_MS)
  timer.unref?.()
  res.on('close', () => clearInterval(timer))
  return timer
}
