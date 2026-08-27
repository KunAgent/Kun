import type { IpcMain, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type { AppSettingsV1 } from '../shared/app-settings'
import { kunThreadEventsPath } from '../shared/kun-endpoints'
import { sseAckPayloadSchema, sseStartPayloadSchema, streamIdSchema } from './ipc/app-ipc-schemas'
import type { JsonSettingsStore } from './settings-store'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './runtime/kun-adapter'

type SseControllerState = {
  controller: AbortController
  stoppedByClient: boolean
  pendingAck?: {
    batchId: string
    resolve: (acknowledged: boolean) => void
  }
}

const SSE_RECONNECT_BASE_MS = 750
const SSE_RECONNECT_MAX_MS = 5_000
const SSE_START_TIMEOUT_MS = 15_000
const SSE_ACK_TIMEOUT_MS = 15_000
export const MAX_SSE_FRAME_BUFFER_BYTES = 1 * 1024 * 1024
export const MAX_SSE_BATCH_EVENTS = 128
export const MAX_SSE_BATCH_BYTES = 512 * 1024


const sseControllers = new Map<string, SseControllerState>()

function waitForSseBatchAck(
  state: SseControllerState,
  batchId: string,
  signal: AbortSignal
): Promise<boolean> {
  if (state.stoppedByClient || signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (acknowledged: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (state.pendingAck?.batchId === batchId) state.pendingAck = undefined
      resolve(acknowledged)
    }
    const timer = setTimeout(() => finish(false), SSE_ACK_TIMEOUT_MS)
    const onAbort = () => finish(false)
    state.pendingAck = { batchId, resolve: finish }
    signal.addEventListener('abort', onAbort, { once: true })
  })
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
    void event
    assertRendererRuntimeReady()
    const request = sseStartPayloadSchema.parse(args)
    const loadedSettings = await store.load()
    const ensuredSettings = await ensureRuntime(loadedSettings)
    let connectionSettings = ensuredSettings ?? loadedSettings
    const requestedId = request.streamId?.trim() ?? ''
    const id = requestedId || randomUUID()
    const existing = sseControllers.get(id)
    if (existing) {
      existing.stoppedByClient = true
      existing.pendingAck?.resolve(false)
      existing.controller.abort()
      sseControllers.delete(id)
    }
    const ac = new AbortController()
    const state: SseControllerState = { controller: ac, stoppedByClient: false }
    sseControllers.set(id, state)
    const acknowledgedBatches = request.acknowledgedBatches === true

    ;(async () => {
      const wc = event.sender
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
                if (!sendSseMessage(wc, 'runtime:sse-error', { streamId: id, status: res.status, ...(res.status === 404 ? { threadMissing: true } : {}) })) {
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
                const acknowledged = await waitForSseBatchAck(state, batchId, ac.signal)
                if (!acknowledged) {
                  if (state.stoppedByClient || ac.signal.aborted) return false
                  throw new Error('sse renderer acknowledgement timeout')
                }
              }
              nextSinceSeq = batchMaxSeq
              return true
            }

            const enqueueParsedEvent = async (block: string): Promise<boolean> => {
              const parsed = parseSseData(block)
              if (parsed === null) return true
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
            if (state.stoppedByClient || ac.signal.aborted) return
            const msg = e instanceof Error ? e.message : String(e)
            if (isTransientSseErrorMessage(msg)) {
              await sleepWithAbort(reconnectDelayMs, ac.signal)
              reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_RECONNECT_MAX_MS)
              continue
            }
            if (!sendSseMessage(wc, 'runtime:sse-error', { streamId: id, message: msg })) {
              state.stoppedByClient = true
              ac.abort()
              return
            }
            logError('sse', `SSE stream error for thread ${request.threadId}`, { message: msg, streamId: id })
            return
          }
        }
      } finally {
        state.pendingAck?.resolve(false)
        if (!state.stoppedByClient && !ac.signal.aborted) {
          sendSseMessage(wc, 'runtime:sse-end', { streamId: id })
        }
        sseControllers.delete(id)
      }
    })().catch((error) => {
      sseControllers.delete(id)
      logError('sse', `SSE worker crashed for thread ${request.threadId}`, {
        message: error instanceof Error ? error.message : String(error),
        streamId: id
      })
    })

    return { streamId: id }
  })

  ipcMain.handle('runtime:sse:ack', async (_, args: unknown) => {
    const acknowledgement = sseAckPayloadSchema.parse(args)
    const state = sseControllers.get(acknowledgement.streamId)
    if (!state || state.pendingAck?.batchId !== acknowledgement.batchId) return false
    state.pendingAck.resolve(true)
    return true
  })

  ipcMain.handle('runtime:sse:stop', async (_, streamId: unknown) => {
    const normalizedStreamId = streamIdSchema.parse(streamId)
    const state = sseControllers.get(normalizedStreamId)
    if (state) {
      state.stoppedByClient = true
      state.pendingAck?.resolve(false)
      state.controller.abort()
    }
    return true
  })
}
