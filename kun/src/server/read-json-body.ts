import type { KunErrorBody } from '../contracts/errors.js'
import { jsonResponse, type JsonResponse } from './response.js'

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: JsonResponse }

/** Default for control-plane JSON routes; binary/base64 uploads opt in explicitly. */
export const DEFAULT_MAX_JSON_BODY_BYTES = 1 * 1024 * 1024

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
  signal?: AbortSignal
): Promise<ReadJsonBodyResult> {
  if (request.body === null) return { ok: true, value: {} }
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await request.body.cancel().catch(() => undefined)
    return bodyTooLarge(maxBytes)
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await readChunk(reader, signal)
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return bodyTooLarge(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  // Buffer.concat accepts Uint8Array chunks directly. Avoiding one Buffer copy
  // per chunk matters for bounded-but-large JSON bodies such as attachments.
  const text = Buffer.concat(chunks, totalBytes).toString('utf8')
  if (!text) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const body: KunErrorBody = {
      code: 'validation_error',
      message: 'invalid JSON body',
      details: error instanceof Error ? error.message : String(error)
    }
    return { ok: false, response: jsonResponse(body, 400) }
  }
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read()
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('request body read aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      void reader.cancel(signal.reason).catch(() => undefined)
      reject(signal.reason ?? new Error('request body read aborted'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => { cleanup(); resolve(result) },
      (error) => { cleanup(); reject(error) }
    )
  })
}

function bodyTooLarge(maxBytes: number): ReadJsonBodyResult {
  return {
    ok: false,
    response: jsonResponse({ code: 'validation_error', message: `JSON body exceeds ${maxBytes} byte limit` }, 413)
  }
}
