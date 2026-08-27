import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Router } from './router.js'
import { dispatchRequest } from './http-server.js'
import type { FaultInjectionController } from '../services/fault-injection-controller.js'

export type NodeHttpServerHandle = {
  server: Server
  host: string
  port: number
  close(): Promise<void>
}

export async function startNodeHttpServer(input: {
  router: Router
  host: string
  port: number
  faultInjection?: FaultInjectionController
}): Promise<NodeHttpServerHandle> {
  const activeRequests = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const active = handleNodeRequest(input.router, request, response, input.faultInjection)
      .finally(() => activeRequests.delete(active))
    activeRequests.add(active)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port
  return {
    server,
    host: input.host,
    port,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      // SSE connections are intentionally long lived. Force-close active
      // sockets during shutdown so they cannot hold the HTTP server open.
      server.closeAllConnections?.()
      await closed
      await Promise.allSettled([...activeRequests])
    }
  }
}

async function handleNodeRequest(
  router: Router,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  faultInjection?: FaultInjectionController
): Promise<void> {
  try {
    const timeout = await faultInjection?.activate('http-timeout')
    if (timeout) {
      sendInjectedResponse(outgoing, 504, { code: 'fault_injected', kind: timeout.kind })
      return
    }
    const rateLimit = await faultInjection?.activate('http-429')
    if (rateLimit) {
      outgoing.setHeader('retry-after', '1')
      sendInjectedResponse(outgoing, 429, { code: 'fault_injected', kind: rateLimit.kind })
      return
    }
    const invalidJson = await faultInjection?.activate('invalid-json')
    if (invalidJson) {
      outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      outgoing.end('{"fault_injected":')
      return
    }
    const adapted = toFetchRequest(incoming, outgoing)
    try {
      const response = await dispatchRequest(router, adapted.request)
      await writeFetchResponse(outgoing, response, faultInjection)
    } finally {
      adapted.dispose()
    }
  } catch (error) {
    // A streaming body can fail after status/headers were already written, or
    // the peer can disconnect while the response is draining. Sending a
    // second 500 response would throw ERR_HTTP_HEADERS_SENT and crash a
    // detached Runtime/Manager. Close only that socket once the response has
    // started; there is no valid HTTP response left to replace it with.
    if (outgoing.headersSent || outgoing.writableEnded || outgoing.destroyed) {
      if (!outgoing.writableEnded && !outgoing.destroyed) outgoing.destroy()
      return
    }
    console.error('[kun-http] unexpected request failure', {
      method: incoming.method ?? 'GET',
      pathname: safeRequestPathname(incoming.url),
      error: summarizeRequestError(error)
    })
    const body = JSON.stringify({
      code: 'internal_error',
      message: 'Internal server error.'
    })
    outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    outgoing.end(body)
  }
}

function safeRequestPathname(value: string | undefined): string {
  try {
    return new URL(value ?? '/', 'http://127.0.0.1').pathname.slice(0, 2_048)
  } catch {
    return '/'
  }
}

function summarizeRequestError(error: unknown): { name: string; message: string; code?: string } {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error).slice(0, 2_048) }
  }
  const code = String((error as NodeJS.ErrnoException).code ?? '').trim()
  return {
    name: error.name,
    message: error.message.slice(0, 2_048),
    ...(code ? { code: code.slice(0, 128) } : {})
  }
}

function sendInjectedResponse(outgoing: ServerResponse, status: number, body: unknown): void {
  outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  outgoing.end(JSON.stringify(body))
}

function toFetchRequest(incoming: IncomingMessage, outgoing: ServerResponse): {
  request: Request
  dispose(): void
} {
  const method = incoming.method ?? 'GET'
  const host = incoming.headers.host ?? '127.0.0.1'
  const url = `http://${host}${incoming.url ?? '/'}`
  const headers = new Headers()
  for (const [key, raw] of Object.entries(incoming.headers)) {
    if (raw == null) continue
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value)
    } else {
      headers.set(key, raw)
    }
  }
  // This value is derived from the socket and deliberately overwrites any
  // client-supplied header. Runtime lifecycle routes use it to stay local-only.
  headers.set('x-kun-remote-address', incoming.socket.remoteAddress ?? '')
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const abort = new AbortController()
  const abortRequest = () => abort.abort()
  incoming.once('aborted', abortRequest)
  incoming.once('error', abortRequest)
  outgoing.once('close', abortRequest)
  outgoing.once('error', abortRequest)
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    signal: abort.signal
  }
  if (hasBody) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
    init.duplex = 'half'
  }
  return {
    request: new Request(url, init),
    dispose: () => {
      incoming.off('aborted', abortRequest)
      incoming.off('error', abortRequest)
      outgoing.off('close', abortRequest)
      outgoing.off('error', abortRequest)
    }
  }
}

async function writeFetchResponse(
  outgoing: ServerResponse,
  response: Response,
  faultInjection?: FaultInjectionController
): Promise<void> {
  outgoing.statusCode = response.status
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value)
  })
  if (!response.body) {
    outgoing.end()
    return
  }
  const isSse = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') === true
  if (isSse) outgoing.flushHeaders()
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, outgoing)
      if (done) break
      if (value && !outgoing.write(Buffer.from(value))) {
        await waitForDrain(outgoing)
      }
      if (isSse && await faultInjection?.activate('sse-disconnect')) {
        outgoing.destroy()
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    if (!outgoing.writableEnded && !outgoing.destroyed) outgoing.end()
    reader.releaseLock()
  }
}

function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  outgoing: ServerResponse
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      outgoing.off('close', onClose)
      outgoing.off('error', onError)
    }
    const finish = (result: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onClose = () => {
      void reader.cancel().catch(() => undefined)
      finish({ done: true, value: undefined })
    }
    const onError = (error: Error) => fail(error)
    outgoing.once('close', onClose)
    outgoing.once('error', onError)
    void reader.read().then(finish, fail)
  })
}

function waitForDrain(outgoing: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      outgoing.off('drain', onDrain)
      outgoing.off('close', onClose)
      outgoing.off('error', onError)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('client connection closed before response drain'))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    outgoing.once('drain', onDrain)
    outgoing.once('close', onClose)
    outgoing.once('error', onError)
  })
}
