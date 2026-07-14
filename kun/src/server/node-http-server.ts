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
  const server = createServer((request, response) => {
    void handleNodeRequest(input.router, request, response, input.faultInjection)
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
  } catch {
    const body = JSON.stringify({
      code: 'internal_error',
      message: 'Internal server error.'
    })
    outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    outgoing.end(body)
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
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
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
