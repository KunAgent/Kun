import type { IpcMain, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type { AppSettingsV1 } from '../shared/app-settings'
import { kunThreadEventsPath } from '../shared/kun-endpoints'
import { sseAckPayloadSchema, sseStartPayloadSchema, streamIdSchema } from './ipc/app-ipc-schemas'
import type { JsonSettingsStore } from './settings-store'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './runtime/kun-adapter'
import { SseAckWindow } from './runtime/sse-ack-window'

type SseControllerState = {
  controller: AbortController
  owner: WebContents
  stoppedByClient: boolean
  ackWindow: SseAckWindow
}

const SSE_RECONNECT_BASE_MS = 750
const SSE_RECONNECT_MAX_MS = 5_000
const SSE_START_TIMEOUT_MS = 15_000
export const MAX_SSE_FRAME_BUFFER_BYTES = 1 * 1024 * 1024
export const MAX_SSE_BATCH_EVENTS = 128
export const MAX_SSE_BATCH_BYTES = 512 * 1024


const sseControllers = new Map<string, SseControllerState>()
const observedSseOwners = new WeakSet<WebContents>()

function stopSseState(state: SseControllerState): void {
  state.stoppedByClient = true
  state.ackWindow.rejectAll()
  state.controller.abort()
}

function observeSseOwner(owner: WebContents): void {
  if (observedSseOwners.has(owner)) return
  observedSseOwners.add(owner)
  const onDestroyed = (): void => {
    for (const [streamId, state] of sseControllers) {
      if (state.owner !== owner) continue
      stopSseState(state)
      sseControllers.delete(streamId)
    }
  }
  ;(owner as WebContents & { once?: (event: 'destroyed', listener: () => void) => void })
    .once?.('destroyed', onDestroyed)
}

function sendSseMessage(wc: WebContents, channel: string, payload: unknown): boolean {
  if (wc.isDestroyed()) return false
  try {
    wc.send(channel, payload)
    return true
  } catch {
    return false
  }
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseSseData(raw: string): { data: unknown; event?: string; id?: string } | null {
  const lines = raw.split('\n')
  const dataLines: string[] = []
  let eventName = ''
  let eventId = ''
  for (const line of lines) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized.startsWith('event:')) {
      eventName = normalized.slice(6).trim()
      continue
    }
    if (normalized.startsWith('id:')) {
      eventId = normalized.slice(3).trim()
      continue
    }
    if (normalized.startsWith('data:')) {
      dataLines.push(normalized.slice(5).trimStart())
    }
  }
  if (!dataLines.length) return null
  const payload = dataLines.join('\n')
  try {
    return {
      data: JSON.parse(payload),
      ...(eventName ? { event: eventName } : {}),
      ...(eventId ? { id: eventId } : {})
    }
  } catch {
    return null
  }
}

function takeSseBlock(buffer: string): { block: string; rest: string } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return {
      block: buffer.slice(0, crlf),
      rest: buffer.slice(crlf + 4)
    }
  }
  return {
    block: buffer.slice(0, lf),
    rest: buffer.slice(lf + 2)
  }
}

function coerceSsePayload(parsed: { data: unknown; event?: string; id?: string }): Record<string, unknown> {
  const payload: Record<string, unknown> =
    parsed.data && typeof parsed.data === 'object'
      ? { ...(parsed.data as Record<string, unknown>) }
      : { value: parsed.data }
  if (typeof payload.seq !== 'number' && parsed.id && /^\d+$/.test(parsed.id)) {
    payload.seq = Number(parsed.id)
  }
  if (typeof payload.kind !== 'string' && parsed.event) {
    payload.kind = parsed.event
  }
  return payload
}

function isFatalSseStatus(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

// A just-created thread can briefly 404 on the events route while its durable
// record becomes visible (runtime restart, writer hand-off). Retry a bounded
// number of times before declaring the thread missing so a raced subscription
// does not permanently strand an empty transcript.
const SSE_NOT_FOUND_RETRY_BASE_MS = 750
const SSE_NOT_FOUND_RETRY_MAX = 3


function isTransientSseErrorMessage(message: string): boolean {
  return /sse start timeout|sse renderer acknowledgement timeout|fetch failed|network|terminated|aborted|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR/i.test(message)
}

async function fetchSseWithStartTimeout(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<Response> {
  const attempt = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    attempt.abort()
  }, timeoutMs)
  const onAbort = (): void => {
    attempt.abort()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(url, { signal: attempt.signal, headers })
  } catch (error) {
    if (timedOut) {
      throw new Error('sse start timeout')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

export function registerRuntimeSseIpc(options: {
  ipcMain: IpcMain
  store: JsonSettingsStore
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
  assertRendererRuntimeReady: () => void
  logError: (category: string, message: string, detail?: unknown) => void
}): void {
  const { ipcMain, store, ensureRuntime, assertRendererRuntimeReady, logError } = options
  ipcMain.handle('runtime:sse:start', async (event, args: unknown) => {
    assertRendererRuntimeReady()
    const wc = event.sender
    observeSseOwner(wc)
    const request = sseStartPayloadSchema.parse(args)
    const loadedSettings = await store.load()
    const ensuredSettings = await ensureRuntime(loadedSettings)
    let connectionSettings = ensuredSettings ?? loadedSettings
    const requestedId = request.streamId?.trim() ?? ''
    const id = requestedId || randomUUID()
    // Exactly-once terminal signal. Every exit path must send either a
    // runtime:sse-error or runtime:sse-end so a subscribed renderer always
    // receives a terminal and can clean up its IPC listeners. `stoppedByClient`
    // (renderer-initiated stop, destroyed owner, or same-id resubscribe) is the
    // only case where no terminal is required.
    let terminalSent = false
    const sendTerminal = (
      channel: 'runtime:sse-error' | 'runtime:sse-end',
      payload: Record<string, unknown>
    ): boolean => {
      if (terminalSent) return true
      terminalSent = true
      return sendSseMessage(wc, channel, payload)
    }
    const existing = sseControllers.get(id)
    if (existing) {
      stopSseState(existing)
      sseControllers.delete(id)
    }
    const ac = new AbortController()
    const state: SseControllerState = {
      controller: ac,
      owner: wc,
      stoppedByClient: false,
      ackWindow: undefined as unknown as SseAckWindow
    }
    state.ackWindow = new SseAckWindow(undefined, undefined, Date.now, (batchId) => {
      // A single unacknowledged batch is fatal even when the window is not
      // full. Send an explicit terminal error before aborting so the renderer
      // can finish its subscription and clean up its IPC listeners, then tear
      // the stream down. Its recovery path can resubscribe from its durable
      // snapshot cursor.
      sendTerminal('runtime:sse-error', {
        streamId: id,
        code: 'renderer_ack_timeout',
        threadId: request.threadId,
        batchId
      })
      ac.abort()
    })
    sseControllers.set(id, state)
    const acknowledgedBatches = request.acknowledgedBatches === true

    ;(async () => {
      let nextSinceSeq = request.sinceSeq
      let reconnectDelayMs = SSE_RECONNECT_BASE_MS
      let notFoundRetries = 0

      try {
        while (!state.stoppedByClient && !ac.signal.aborted) {
          try {
            // A shared runtime may be restarted by the GUI, a TUI, or
            // `kun runtime restart`. Re-resolve discovery before every SSE
            // reconnect so the stream follows the new URL/token while
            // retaining its sequence cursor.
            const latestSettings = await store.load()
            const latestEnsured = await ensureRuntime(latestSettings)
            connectionSettings = latestEnsured ?? latestSettings
            const base = getRuntimeBaseUrlForSettings(connectionSettings)
            const headers: Record<string, string> = { Accept: 'text/event-stream' }
            runtimeAuthHeaders(connectionSettings).forEach((value, key) => {
              headers[key] = value
            })
            const url = new URL(`${base}${kunThreadEventsPath(request.threadId)}`)
            url.searchParams.set('since_seq', String(nextSinceSeq))
            const requestHeaders = { ...headers }
            if (nextSinceSeq > 0) {
              requestHeaders['Last-Event-ID'] = String(nextSinceSeq)
            } else {
              delete requestHeaders['Last-Event-ID']
            }
            const res = await fetchSseWithStartTimeout(url, requestHeaders, ac.signal, SSE_START_TIMEOUT_MS)
            if (!res.ok || !res.body) {
              if (isFatalSseStatus(res.status)) {
                if (res.status === 404 && notFoundRetries < SSE_NOT_FOUND_RETRY_MAX) {
                  notFoundRetries += 1
                  const delayMs = SSE_NOT_FOUND_RETRY_BASE_MS * 2 ** (notFoundRetries - 1)
                  logError('sse', `SSE 404 for thread ${request.threadId}; retry ${notFoundRetries}/${SSE_NOT_FOUND_RETRY_MAX} in ${delayMs}ms`, {
                    streamId: id
                  })
                  await sleepWithAbort(delayMs, ac.signal)
                  continue
                }
                if (!sendTerminal('runtime:sse-error', { streamId: id, status: res.status, ...(res.status === 404 ? { threadMissing: true } : {}) })) {
                  state.stoppedByClient = true
                  ac.abort()
                  return
                }
                logError('sse', `SSE connection failed for thread ${request.threadId}`, {
                  status: res.status,
                  streamId: id
                })
                return
              }
              await sleepWithAbort(reconnectDelayMs, ac.signal)
              reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_RECONNECT_MAX_MS)
              continue
            }
            reconnectDelayMs = SSE_RECONNECT_BASE_MS
            notFoundRetries = 0
            const reader = res.body.getReader()
            if (!sendSseMessage(wc, 'runtime:sse-open', { streamId: id })) {
              state.stoppedByClient = true
              ac.abort()
              return
            }
            const dec = new TextDecoder()
            let buffer = ''

            let pendingEvents: Record<string, unknown>[] = []
            let pendingBytes = 0

            const flushEvents = async (): Promise<boolean> => {
              if (state.stoppedByClient || ac.signal.aborted) {
                pendingEvents = []
                pendingBytes = 0
                return false
              }
              if (pendingEvents.length === 0) return true

              let batchMaxSeq = nextSinceSeq
              for (const event of pendingEvents) {
                if (typeof event.seq === 'number') {
                  batchMaxSeq = Math.max(batchMaxSeq, event.seq)
                } else if (
                  event.kind === 'replay_synchronized' &&
                  typeof event.cursor === 'number' &&
                  Number.isSafeInteger(event.cursor) &&
                  event.cursor >= 0
                ) {
                  batchMaxSeq = Math.max(batchMaxSeq, event.cursor)
                }
              }

              const batch = pendingEvents
              pendingEvents = []
              pendingBytes = 0
              const batchId = acknowledgedBatches ? randomUUID() : undefined
              // Sliding-window flow control: wait for a free slot before the
              // send so at most MAX_INFLIGHT_SSE_BATCHES batches are in
              // flight, then advance the reconnect cursor on send. ACK remains
              // the renderer's per-batch flow signal, but a busy renderer no
              // longer stalls the upstream read loop one batch at a time.
              if (batchId && !await state.ackWindow.waitForCapacity(ac.signal)) {
                if (state.stoppedByClient || ac.signal.aborted) return false
                throw new Error('sse renderer acknowledgement timeout')
              }
              if (!sendSseMessage(wc, 'runtime:sse-event', {
                streamId: id,
                events: batch,
                ...(batchId ? { batchId } : {})
              })) {
                state.stoppedByClient = true
                ac.abort()
                return false
              }
              if (batchId) {
                state.ackWindow.registerSentBatch({
                  batchId,
                  eventCount: batch.length,
                  signal: ac.signal
                })
              }
              // Advance on send: IPC delivery to a live renderer is reliable;
              // a dead renderer re-subscribes from its snapshot cursor, so no
              // event can be lost or duplicated across those paths.
              nextSinceSeq = batchMaxSeq
              return true
            }

            const enqueueParsedEvent = async (block: string): Promise<boolean> => {
              const parsed = parseSseData(block)
              if (parsed === null) return true
              if (parsed.event === 'replay_reset_required' && !parsed.id) {
                const reset = parsed.data && typeof parsed.data === 'object'
                  ? parsed.data as { threadId?: unknown; floorSeq?: unknown }
                  : undefined
                if (
                  reset?.threadId !== request.threadId ||
                  typeof reset.floorSeq !== 'number' ||
                  !Number.isSafeInteger(reset.floorSeq) ||
                  reset.floorSeq < 0
                ) {
                  throw new Error('SSE server returned an invalid replay reset')
                }
                sendTerminal('runtime:sse-error', {
                  streamId: id,
                  code: 'replay_reset_required',
                  threadId: request.threadId,
                  floorSeq: reset.floorSeq,
                  message: 'Runtime event history was compacted; reload the thread snapshot.'
                })
                // Never reconnect this worker with the rejected cursor. The
                // renderer must replace its projection from /state first and
                // then create a fresh subscription at the snapshot high-water.
                state.stoppedByClient = true
                ac.abort()
                return false
              }
              // Route-level SSE failures are control frames without an event
              // id. They must not be treated as normal runtime `error` events:
              // acknowledging one would retain the old cursor and reconnect
              // into the same corrupt/oversized record forever.
              if (parsed.event === 'error' && !parsed.id) {
                const message = parsed.data && typeof parsed.data === 'object'
                  ? (parsed.data as { message?: unknown }).message
                  : undefined
                throw new Error(typeof message === 'string' ? message : 'SSE server replay error')
              }
              const bytes = Buffer.byteLength(block, 'utf8')
              if (
                pendingEvents.length > 0 &&
                (pendingEvents.length >= MAX_SSE_BATCH_EVENTS || pendingBytes + bytes > MAX_SSE_BATCH_BYTES)
              ) {
                if (!await flushEvents()) return false
              }
              pendingEvents.push(coerceSsePayload(parsed))
              pendingBytes += bytes
              if (pendingEvents.length >= MAX_SSE_BATCH_EVENTS || pendingBytes >= MAX_SSE_BATCH_BYTES) {
                return flushEvents()
              }
              return true
            }

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += dec.decode(value, { stream: true })

                let next: { block: string; rest: string } | null
                while ((next = takeSseBlock(buffer)) !== null) {
                  const block = next.block
                  buffer = next.rest
                  if (!await enqueueParsedEvent(block)) return
                }
                if (Buffer.byteLength(buffer, 'utf8') > MAX_SSE_FRAME_BUFFER_BYTES) {
                  throw new Error(`SSE frame exceeds ${MAX_SSE_FRAME_BUFFER_BYTES} bytes`)
                }
                if (!await flushEvents()) return
              }
              buffer += dec.decode()
              const trailing = buffer.trim()
              if (trailing) {
                if (!await enqueueParsedEvent(trailing)) return
              }
              await flushEvents()
            } finally {
              try {
                await reader.cancel()
              } catch {
                // Test doubles and already-closed readers may not support a
                // cancellable body; there is nothing left to retain here.
              }
            }
          } catch (e) {
            if (state.stoppedByClient) return
            if (ac.signal.aborted) {
              // Watchdog timeouts abort the subscription; do not convert that
              // teardown into an immediate in-process reconnect loop. The
              // renderer's existing SSE recovery path can resubscribe from its
              // durable snapshot cursor.
              return
            }
            const msg = e instanceof Error ? e.message : String(e)
            if (isTransientSseErrorMessage(msg)) {
              await sleepWithAbort(reconnectDelayMs, ac.signal)
              reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_RECONNECT_MAX_MS)
              continue
            }
            if (!sendTerminal('runtime:sse-error', { streamId: id, message: msg })) {
              state.stoppedByClient = true
              ac.abort()
              return
            }
            logError('sse', `SSE stream error for thread ${request.threadId}`, { message: msg, streamId: id })
            return
          }
        }
      } finally {
        state.ackWindow.rejectAll()
        if (!terminalSent && !state.stoppedByClient && !ac.signal.aborted) {
          sendTerminal('runtime:sse-end', { streamId: id })
        }
        if (sseControllers.get(id) === state) sseControllers.delete(id)
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!state.stoppedByClient) {
        sendTerminal('runtime:sse-error', { streamId: id, message })
      }
      if (sseControllers.get(id) === state) sseControllers.delete(id)
      logError('sse', `SSE worker crashed for thread ${request.threadId}`, {
        message,
        streamId: id
      })
    })

    return { streamId: id }
  })

  ipcMain.handle('runtime:sse:ack', async (event, args: unknown) => {
    const acknowledgement = sseAckPayloadSchema.parse(args)
    const state = sseControllers.get(acknowledgement.streamId)
    if (!state || state.owner !== event.sender) return false
    return state.ackWindow.acknowledge(acknowledgement.batchId)
  })

  ipcMain.handle('runtime:sse:stop', async (event, streamId: unknown) => {
    const normalizedStreamId = streamIdSchema.parse(streamId)
    const state = sseControllers.get(normalizedStreamId)
    if (state?.owner === event.sender) stopSseState(state)
    return true
  })
}
