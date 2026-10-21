import { createHash } from 'node:crypto'
import { READ_METHODS, type Call } from '@kun/remote-protocol'

/** Splits the phone's optional `ifVersion` off a call; the runtime envelope accepts only the call. */
export function conditionalCall(call: Call): { call: Call; ifVersion?: string } {
  if (call.ifVersion === undefined) return { call }
  const { ifVersion, ...rest } = call
  return { call: rest, ifVersion }
}

/** Opaque version of a read answer. Catalog confirmation time changes on every read, so it is left out. */
export function readVersion(method: string, value: unknown): string {
  let stable = value
  if (method === 'catalog.get' && value && typeof value === 'object' && 'host' in value) {
    const { host, ...rest } = value as { host?: Record<string, unknown> }
    stable = { ...rest, host: host && { ...host, confirmedAt: undefined } }
  }
  return createHash('sha256').update(JSON.stringify(stable) ?? '').digest('base64url')
}

/**
 * The answer that crosses the relay for a conditional read: a short marker when the phone already
 * holds this exact answer, otherwise the answer with its version. Unconditional reads are untouched.
 */
export function conditionalResult(method: string, value: unknown, ifVersion: string | undefined): unknown {
  if (ifVersion === undefined || !READ_METHODS.has(method) || !value || typeof value !== 'object' || Array.isArray(value)) return value
  const version = readVersion(method, value)
  return version === ifVersion ? { readUnchanged: true, readVersion: version } : { ...value, readVersion: version }
}
