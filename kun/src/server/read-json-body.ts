/**
 * [INPUT]: 依赖 Fetch Request body stream 和可选 maxBytes
 * [OUTPUT]: 对外提供有界 JSON body 读取结果，区分无效 JSON 与 413 超限响应
 * [POS]: server 的通用请求体安全边界，避免路由使用 request.text() 无界缓冲
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { KunErrorBody } from '../contracts/errors.js'
import { jsonResponse, type JsonResponse } from './response.js'

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: JsonResponse }

export async function readJsonBody(request: Request, options: { maxBytes?: number } = {}): Promise<ReadJsonBodyResult> {
  if (request.body === null) return { ok: true, value: {} }
  const maxBytes = Math.max(1, options.maxBytes ?? 1024 * 1024)
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return bodyTooLarge(maxBytes)
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return bodyTooLarge(maxBytes)
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
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

function bodyTooLarge(maxBytes: number): ReadJsonBodyResult {
  return {
    ok: false,
    response: jsonResponse({
      code: 'validation_error',
      message: `request body exceeds ${maxBytes} bytes`
    } satisfies KunErrorBody, 413)
  }
}
