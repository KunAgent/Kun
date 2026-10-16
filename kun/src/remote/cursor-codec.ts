import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
export function cursorScope(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
export function readCursor<T>(raw: string | undefined, scope: string, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (parsed.v === 1 && parsed.scope === scope && parsed.position && typeof parsed.position === 'object')
      return parsed.position as T
  } catch {}
  throw new Error('INVALID_CURSOR')
}
export function writeCursor(scope: string, position: unknown) {
  return Buffer.from(JSON.stringify({ v: 1, scope, position })).toString('base64url')
}
