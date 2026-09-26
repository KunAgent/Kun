import type { IncomingMessage, ServerResponse } from 'node:http'

const DEFAULT_BODY_LIMIT = 16 * 1024 * 1024

export class RemoteRequestBodyTooLargeError extends Error {
  readonly code = 'remote_body_too_large'
}

export function readRemoteRequestBody(req: IncomingMessage, limit = DEFAULT_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const fail = (error: Error): void => {
      req.destroy()
      reject(error)
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
        fail(new RemoteRequestBodyTooLargeError('Remote request body is too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => reject(error))
  })
}

export function sendRemoteJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  if (res.writableEnded) return
  const data = JSON.stringify(body ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(data)
}

export function sendRemoteText(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {}
): void {
  if (res.writableEnded) return
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

export function remoteAddressOf(req: IncomingMessage): string {
  return String(req.socket?.remoteAddress ?? '')
}

export function remoteRequestPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://remote.local').pathname
  } catch {
    return '/'
  }
}
