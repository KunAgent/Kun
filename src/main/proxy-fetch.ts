import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import {
  disposeProxyAgents,
  cachedProxyAgentCountForTests,
  proxyTransportRequest
} from '../../kun/src/adapters/model/proxy-transport.js'

export { disposeProxyAgents, cachedProxyAgentCountForTests } from '../../kun/src/adapters/model/proxy-transport.js'

export async function fetchWithOptionalProxy(
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
): Promise<Response> {
  const normalizedProxyUrl = proxyUrl.trim()
  if (!normalizedProxyUrl) return fetch(input, init)
  return fetchViaProxy(input, init, normalizedProxyUrl)
}

async function fetchViaProxy(input: string | URL, init: RequestInit | undefined, proxyUrl: string): Promise<Response> {
  const url = new URL(input.toString())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported proxied request protocol: ${url.protocol}`)
  }

  const headers = headersToRecord(init?.headers)
  const body = await materializeProxyRequestBody(init?.body)
  for (const [key, value] of Object.entries(body.headers)) {
    if (!hasHeader(headers, key)) headers[key] = value
  }
  if (body.buffer && !hasHeader(headers, 'content-length')) {
    headers['content-length'] = String(body.buffer.byteLength)
  }

  return proxyTransportRequest({
    url,
    method: init?.method ?? 'GET',
    headers,
    proxyUrl,
    body: { buffer: body.buffer, stream: body.stream },
    signal: init?.signal ?? undefined
  })
}

type MaterializedRequestBody = {
  buffer: Buffer | null
  stream: Readable | null
  headers: Record<string, string>
}

export async function materializeProxyRequestBody(body: BodyInit | null | undefined): Promise<MaterializedRequestBody> {
  if (body === null || body === undefined) return { buffer: null, stream: null, headers: {} }
  if (typeof body === 'string') return { buffer: Buffer.from(body), stream: null, headers: {} }
  if (body instanceof URLSearchParams) {
    return {
      buffer: Buffer.from(body.toString()),
      stream: null,
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    }
  }
  if (body instanceof ArrayBuffer) return { buffer: Buffer.from(body), stream: null, headers: {} }
  if (ArrayBuffer.isView(body)) {
    return {
      buffer: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      stream: null,
      headers: {}
    }
  }
  if (body instanceof Blob) {
    return {
      buffer: null,
      stream: Readable.fromWeb(body.stream() as unknown as NodeWebReadableStream),
      headers: body.type
        ? { 'content-type': body.type, 'content-length': String(body.size) }
        : { 'content-length': String(body.size) }
    }
  }
  if (body instanceof FormData) {
    const encoded = new Response(body)
    const contentType = encoded.headers.get('content-type')
    return {
      buffer: null,
      stream: encoded.body ? Readable.fromWeb(encoded.body as unknown as NodeWebReadableStream) : null,
      headers: contentType ? { 'content-type': contentType } : {}
    }
  }
  throw new Error('Unsupported proxied request body type.')
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const normalized = new Headers(headers)
  normalized.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized)
}
