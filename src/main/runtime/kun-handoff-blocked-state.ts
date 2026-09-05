import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-json-file'

export const HANOFF_BLOCKED_STATE_FILE = 'kun-handoff-blocked.json'
export const MAX_AUTOMATIC_HANDOFF_PROBES = 3

export type HandoffOwnerHint = {
  kind: 'runtime' | 'manager'
  flavor?: string
  pid?: number
  port?: number
}

export type HandoffBlockedState = {
  schemaVersion: 1
  attempts: number
  firstSeenAt: string
  lastAttemptAt: string
  lastError: string
  ownerHints: HandoffOwnerHint[]
  reason: string
}

export function handoffBlockedPath(userDataPath: string): string {
  return join(userDataPath, HANOFF_BLOCKED_STATE_FILE)
}

export async function readHandoffBlockedState(
  userDataPath: string
): Promise<HandoffBlockedState | null> {
  try {
    const value = JSON.parse(await readFile(handoffBlockedPath(userDataPath), 'utf8')) as unknown
    return isHandoffBlockedState(value) ? value : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.warn('[kun-gui] ignored malformed handoff blocked state:', error)
    return null
  }
}

/**
 * Persist one failed (fail-closed) handoff probe. Returns the resulting state
 * plus whether this probe crossed the automatic-retry ceiling. Once capped the
 * caller must stop auto-probing and defer to an explicit user action.
 */
export async function recordHandoffBlocked(
  input: {
    lastError: string
    ownerHints: HandoffOwnerHint[]
    reason: string
  },
  userDataPath: string,
  now: () => number = Date.now
): Promise<{ state: HandoffBlockedState; capped: boolean }> {
  const existing = await readHandoffBlockedState(userDataPath)
  const attempts = (existing?.attempts ?? 0) + 1
  const state: HandoffBlockedState = {
    schemaVersion: 1,
    attempts,
    firstSeenAt: existing?.firstSeenAt ?? new Date(now()).toISOString(),
    lastAttemptAt: new Date(now()).toISOString(),
    lastError: input.lastError,
    ownerHints: input.ownerHints,
    reason: input.reason
  }
  await writeHandoffBlockedState(state, userDataPath)
  return { state, capped: attempts >= MAX_AUTOMATIC_HANDOFF_PROBES }
}

export async function writeHandoffBlockedState(
  state: HandoffBlockedState,
  userDataPath: string
): Promise<void> {
  await atomicWriteFile(handoffBlockedPath(userDataPath), `${JSON.stringify(state, null, 2)}\n`)
}

export async function clearHandoffBlockedState(userDataPath: string): Promise<void> {
  await rm(handoffBlockedPath(userDataPath), { force: true })
}

export function handoffBlockedReachedCap(state: HandoffBlockedState | null): boolean {
  return Boolean(state && state.attempts >= MAX_AUTOMATIC_HANDOFF_PROBES)
}

function isHandoffBlockedState(value: unknown): value is HandoffBlockedState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1 &&
    typeof record.attempts === 'number' &&
    typeof record.firstSeenAt === 'string' &&
    typeof record.lastAttemptAt === 'string' &&
    typeof record.lastError === 'string' &&
    typeof record.reason === 'string' &&
    Array.isArray(record.ownerHints)
}
