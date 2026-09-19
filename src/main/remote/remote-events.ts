import type { ServerResponse } from 'node:http'
import type { RemoteAccessClientInfo } from '../../shared/remote-access'
import { RemoteClientSender } from './remote-sender'
import {
  REMOTE_ALLOWED_EVENT_CHANNELS,
  REMOTE_BROADCAST_EVENT_CHANNELS
} from './remote-allowlist'

const SSE_HEARTBEAT_MS = 25_000
const MAX_BUFFERED_EVENTS_PER_CLIENT = 512
const SENDER_IDLE_GRACE_MS = 60_000
const MAX_EVENT_PAYLOAD_BYTES = 4 * 1024 * 1024

type RemoteClient = {
  id: string
  sender: RemoteClientSender
  streams: Set<ServerResponse>
  buffered: Array<{ channel: string; payload: unknown }>
  connectedAt: string
  remoteAddress: string
  userAgent: string
  idleTimer: NodeJS.Timeout | null
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
    return true
  } catch {
    return false
  }
}

/**
 * Tracks Remote browser clients and fans Electron-side `sender.send` calls out
 * as SSE frames. Events that arrive while a client has no open stream are
 * buffered briefly and flushed on reconnect.
 */
export class RemoteEventHub {
  private readonly clients = new Map<string, RemoteClient>()

  clientFor(
    clientId: string,
    meta: { remoteAddress?: string; userAgent?: string } = {}
  ): RemoteClientSender {
    const client = this.ensureClient(clientId, meta)
    if (client.idleTimer) {
      clearTimeout(client.idleTimer)
      client.idleTimer = null
    }
    return client.sender
  }

  attachStream(
    clientId: string,
    res: ServerResponse,
    meta: { remoteAddress?: string; userAgent?: string } = {}
  ): RemoteClient {
    const client = this.ensureClient(clientId, meta)
    if (client.idleTimer) {
      clearTimeout(client.idleTimer)
      client.idleTimer = null
    }
    if (meta.remoteAddress) client.remoteAddress = meta.remoteAddress
    if (meta.userAgent) client.userAgent = meta.userAgent
    client.streams.add(res)
    for (const frame of client.buffered) writeSseFrame(res, frame.channel, frame.payload)
    client.buffered = []
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
      client.buffered.push({ channel, payload })
      if (client.buffered.length > MAX_BUFFERED_EVENTS_PER_CLIENT) client.buffered.shift()
      return
    }
    for (const stream of client.streams) writeSseFrame(stream, channel, payload)
  }

  /** Broadcast push (mirrors of main-window webContents.send). */
  broadcast(channel: string, payload: unknown): void {
    if (!REMOTE_BROADCAST_EVENT_CHANNELS.has(channel)) return
    for (const client of this.clients.values()) {
      if (client.streams.size === 0) continue
      for (const stream of client.streams) writeSseFrame(stream, channel, payload)
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
    this.clients.delete(clientId)
  }

  private ensureClient(
    clientId: string,
    meta: { remoteAddress?: string; userAgent?: string }
  ): RemoteClient {
    const existing = this.clients.get(clientId)
    if (existing) return existing
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
      idleTimer: null
    }
    this.clients.set(clientId, client)
    this.scheduleIdleCleanup(client)
    return client
  }

  /**
   * A client with no open stream keeps its sender for a grace period so SSE
   * reconnects do not destroy owned watches/terminals; after that it is torn
   * down exactly like a closed webContents.
   */
  private scheduleIdleCleanup(client: RemoteClient): void {
    if (client.streams.size > 0 || client.idleTimer) return
    client.idleTimer = setTimeout(() => {
      client.idleTimer = null
      if (client.streams.size > 0) return
      client.sender.destroy()
      this.clients.delete(client.id)
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
