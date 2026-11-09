import { createHash } from 'node:crypto'
import { StartTurnRequest } from '../contracts/turns.js'

export function fingerprintStartTurnRequest(request: StartTurnRequest): string | undefined {
  if (!request.clientRequestId?.trim()) return undefined
  const normalized = StartTurnRequest.parse(request)
  // Notice acknowledgements are transport metadata, not retry-stable semantics.
  const { ackNoticeIds: _ackNoticeIds, ...content } = normalized
  return createHash('sha256').update(JSON.stringify(canonicalizeFingerprintValue(content)), 'utf8').digest('hex')
}

export function canonicalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue)
  if (!value || typeof value !== 'object') return value
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry !== undefined) canonical[key] = canonicalizeFingerprintValue(entry)
  }
  return canonical
}
