import { randomInt } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { OutputAccumulator } from './output-accumulator.js'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from './truncate.js'
import { DEFAULT_BACKGROUND_BASH_TIMEOUT_SECONDS, type BackgroundShellRecordInput, type TextSlice, type TruncateMode } from './builtin-tool-types.js'
import { describeKind, normalizePositiveInteger, terminateSpawnTree } from './builtin-tool-utils.js'
import type { BackgroundSessionLimits, BashPayload, BashSession, BashSessionStatus } from './builtin-bash-types.js'

const DEFAULT_BASH_YIELD_SECONDS = 10
const MAX_BASH_YIELD_SECONDS = 60
const SESSION_EXIT_FLUSH_MS = 50
export const STOP_GRACE_MS = 1000
export const STOP_WAIT_MS = 5000
const FINISHED_SESSION_RETENTION_MS = 10 * 60 * 1000
export const DEFAULT_FOREGROUND_BASH_LIVENESS_INTERVAL_MS = 30 * 1000
export const DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS = 32
export const DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS_PER_THREAD = 4
export const DEFAULT_MAX_BACKGROUND_BASH_TIMEOUT_SECONDS = DEFAULT_BACKGROUND_BASH_TIMEOUT_SECONDS

export async function terminateBashProcessTree(child: ChildProcess): Promise<void> {
  const treeTerminator = terminateSpawnTree(child)
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    let forced = false
    const waitOrForce = () => {
      if (!bashProcessTreeIsAlive(child)) {
        resolve()
        return
      }
      const elapsedMs = Date.now() - startedAt
      if (!forced && elapsedMs >= STOP_GRACE_MS) {
        forced = true
        terminateSpawnTree(child, { signal: 'SIGKILL' })
      }
      if (elapsedMs >= STOP_WAIT_MS) {
        reject(new Error('bash process tree did not terminate after SIGKILL'))
        return
      }
      setTimeout(waitOrForce, 25)
    }
    setTimeout(waitOrForce, 25)
  })
  if (treeTerminator && treeTerminator.exitCode === null && treeTerminator.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STOP_GRACE_MS)
      treeTerminator.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      treeTerminator.once('error', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

export function bashProcessTreeIsAlive(child: ChildProcess): boolean {
  const pid = child.pid
  if (!pid || process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null
  }
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const bashSessions = new Map<string, BashSession>()
export const backgroundSessionReservations = new Map<string, number>()

export function runningBackgroundSessionCount(threadId?: string): number {
  let count = 0
  for (const session of bashSessions.values()) {
    if (session.status !== 'running') continue
    if (threadId && session.threadId !== threadId) continue
    count += 1
  }
  return count
}

export function pendingBackgroundSessionCount(threadId?: string): number {
  if (threadId) return backgroundSessionReservations.get(threadId) ?? 0
  let count = 0
  for (const pending of backgroundSessionReservations.values()) count += pending
  return count
}

/**
 * Reserve capacity before the first async startup step. This prevents several
 * concurrent `bash background=true` requests from all observing spare capacity
 * and collectively exceeding the process or per-thread cap.
 */
export function reserveBackgroundSession(
  threadId: string,
  limits: Pick<BackgroundSessionLimits, 'maxRunningSessions' | 'maxRunningSessionsPerThread'>
): () => void {
  const total = runningBackgroundSessionCount() + pendingBackgroundSessionCount()
  if (total >= limits.maxRunningSessions) {
    throw new Error(`background shell capacity reached (${limits.maxRunningSessions} running sessions)`)
  }
  const perThread = runningBackgroundSessionCount(threadId) + pendingBackgroundSessionCount(threadId)
  if (perThread >= limits.maxRunningSessionsPerThread) {
    throw new Error(
      `background shell capacity reached for thread ${threadId} (${limits.maxRunningSessionsPerThread} running sessions)`
    )
  }
  backgroundSessionReservations.set(threadId, (backgroundSessionReservations.get(threadId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const next = (backgroundSessionReservations.get(threadId) ?? 1) - 1
    if (next > 0) backgroundSessionReservations.set(threadId, next)
    else backgroundSessionReservations.delete(threadId)
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SESSION_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const SESSION_ID_LENGTH = 8
const SESSION_ID_PATTERN = /^[a-z0-9]{8}$/

export function nextSessionId(): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let id = ''
    for (let i = 0; i < SESSION_ID_LENGTH; i++) {
      id += SESSION_ID_ALPHABET[randomInt(SESSION_ID_ALPHABET.length)]!
    }
    if (!bashSessions.has(id)) return id
  }
  throw new Error('failed to allocate unique bash session id')
}

export function isBashSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

function textSliceFromSnapshot(snapshot: ReturnType<OutputAccumulator['snapshot']>): TextSlice {
  return {
    text: snapshot.content,
    truncated: snapshot.truncation.truncated,
    totalLines: snapshot.truncation.totalLines,
    shownLines: snapshot.truncation.outputLines,
    totalBytes: snapshot.truncation.totalBytes,
    shownBytes: snapshot.truncation.outputBytes,
    firstLineExceedsLimit: snapshot.truncation.firstLineExceedsLimit,
    truncatedBy: snapshot.truncation.truncatedBy ?? undefined,
    lastLinePartial: snapshot.truncation.lastLinePartial
  }
}

function truncationPayload(truncated: TextSlice): BashPayload['truncation'] {
  return truncated.truncated
    ? {
        total_lines: truncated.totalLines,
        output_lines: truncated.shownLines,
        total_bytes: truncated.totalBytes,
        output_bytes: truncated.shownBytes,
        truncated_by: truncated.truncatedBy ?? null,
        last_line_partial: truncated.lastLinePartial === true
      }
    : null
}

export function resultPayload(input: {
  command: string
  cwd: string
  shell: string
  exitCode: number | null
  output: string
  truncated: TextSlice
  maxBytes: number
  fullOutputPath?: string
}): BashPayload {
  return {
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    exit_code: input.exitCode,
    output: appendTruncationNotice(input.output, input.truncated, 'tail', input.maxBytes),
    full_output_path: input.fullOutputPath ?? null,
    truncation: truncationPayload(input.truncated)
  }
}

export async function finalizeSessionOutput(session: BashSession): Promise<void> {
  if (session.finalized) return
  if (session.finalization) return session.finalization
  const finalization = (async () => {
    // `exit` can arrive just before the final stdout/stderr data callback.
    // Retain the small flush grace period, then close both backing writers even
    // when nobody polls or reads the completed session again.
    await sleep(SESSION_EXIT_FLUSH_MS)
    session.output.finish()
    await session.output.closeTempFile()
    await session.outputWriter?.close()
    session.finalized = true
  })()
  session.finalization = finalization
  try {
    await finalization
  } finally {
    if (session.finalization === finalization) session.finalization = undefined
  }
}

export async function backgroundSessionPayload(
  session: BashSession,
  options: { stopSent?: boolean } = {}
): Promise<BashPayload> {
  if (session.status !== 'running') {
    await finalizeSessionOutput(session)
  }
  const fields = await backgroundShellOutputFields(session)
  return {
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    exit_code: session.exitCode,
    output: fields.output,
    output_file: fields.output_file,
    session_id: session.id,
    status: session.status,
    started_at: session.startedAt,
    ...(session.finishedAt ? { finished_at: session.finishedAt } : {}),
    ...(typeof session.child.pid === 'number' ? { pid: session.child.pid } : {}),
    ...(session.status === 'running' ? { partial: true } : {}),
    ...(options.stopSent ? { stop_sent: true } : {}),
    ...(session.error ? { error: session.error } : {})
  }
}

export async function sessionPayload(
  session: BashSession,
  options: { stopSent?: boolean } = {}
): Promise<BashPayload> {
  if (session.outputWriter) {
    return backgroundSessionPayload(session, options)
  }
  if (session.status !== 'running') {
    await finalizeSessionOutput(session)
  }
  const snapshot = session.output.snapshot({ persistIfTruncated: true })
  const truncated = textSliceFromSnapshot(snapshot)
  return {
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    exit_code: session.exitCode,
    output: appendTruncationNotice(snapshot.content, truncated, 'tail', session.outputMaxBytes),
    full_output_path: snapshot.fullOutputPath ?? null,
    truncation: truncationPayload(truncated),
    session_id: session.id,
    status: session.status,
    started_at: session.startedAt,
    ...(session.finishedAt ? { finished_at: session.finishedAt } : {}),
    ...(typeof session.child.pid === 'number' ? { pid: session.child.pid } : {}),
    ...(session.status === 'running' ? { partial: true } : {}),
    ...(options.stopSent ? { stop_sent: true } : {}),
    ...(session.error ? { error: session.error } : {})
  }
}

function scheduleSessionCleanup(session: BashSession): void {
  const timer = setTimeout(() => {
    if (session.status === 'running') return
    // Defensive finalization for a failed exit callback. Do not leave an open
    // output stream behind merely because no caller subsequently polled it.
    void finalizeSessionOutput(session)
      .catch(() => undefined)
      .finally(() => bashSessions.delete(session.id))
  }, FINISHED_SESSION_RETENTION_MS)
  timer.unref?.()
}

export function settleSession(
  session: BashSession,
  status: Exclude<BashSessionStatus, 'running'>,
  exitCode: number | null,
  error?: string
): boolean {
  if (session.status !== 'running') return false
  session.status = status
  session.exitCode = exitCode
  session.finishedAt = new Date().toISOString()
  if (error) session.error = error
  for (const waiter of session.exitWaiters) waiter()
  session.exitWaiters.clear()
  scheduleSessionCleanup(session)
  return true
}

export function waitForSessionExitOrDelay(session: BashSession, ms: number): Promise<boolean> {
  if (session.status !== 'running') return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.exitWaiters.delete(onExit)
      resolve(false)
    }, Math.max(0, ms))
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    session.exitWaiters.add(onExit)
  })
}

export function stopSession(session: BashSession): Promise<void> {
  if (session.status !== 'running') return session.stopCleanup ?? Promise.resolve()
  session.stopRequested = true
  session.stopCleanup ??= terminateBashProcessTree(session.child)
  return session.stopCleanup
}

function normalizeYieldSeconds(value: unknown): number {
  const raw = normalizePositiveInteger(value, DEFAULT_BASH_YIELD_SECONDS)
  return Math.max(1, Math.min(MAX_BASH_YIELD_SECONDS, raw))
}

function recordFromSession(
  session: BashSession,
  output: string,
  truncated?: boolean,
  detached = false,
  outputFilePath?: string
): BackgroundShellRecordInput {
  return {
    id: session.id,
    threadId: session.threadId ?? '',
    turnId: session.turnId ?? '',
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    status: session.status,
    startedAt: session.startedAt,
    ...(session.finishedAt ? { finishedAt: session.finishedAt } : {}),
    exitCode: session.exitCode,
    output,
    ...(truncated ? { outputTruncated: true } : {}),
    ...(outputFilePath ? { outputFilePath } : {}),
    ...(session.error ? { error: session.error } : {}),
    detached
  }
}

async function backgroundShellOutputFields(session: BashSession): Promise<{
  output: string
  output_truncated: boolean
  output_total_chars: number
  output_file: string
}> {
  const writer = session.outputWriter
  if (!writer) {
    return {
      output: '',
      output_truncated: false,
      output_total_chars: 0,
      output_file: ''
    }
  }
  const fields = await writer.buildReturnFields()
  return {
    output: fields.summary,
    output_truncated: fields.truncated,
    output_total_chars: fields.totalChars,
    output_file: fields.output_file
  }
}

export async function recordFromBackgroundSession(session: BashSession, detached: boolean): Promise<BackgroundShellRecordInput> {
  const fields = await backgroundShellOutputFields(session)
  return recordFromSession(
    session,
    fields.output,
    fields.output_truncated,
    detached,
    fields.output_file
  )
}

function sessionById(sessionId: unknown, threadId?: string): BashSession | null {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  const session = id ? bashSessions.get(id) ?? null : null
  if (!session) return null
  if (threadId && session.threadId !== threadId) return null
  return session
}

export async function stopBashSessionById(sessionId: string, threadId?: string): Promise<boolean> {
  const session = sessionById(sessionId, threadId)
  if (!session || session.status !== 'running') return false
  await stopSession(session)
  await waitForSessionExitOrDelay(session, STOP_WAIT_MS - STOP_GRACE_MS)
  if (session.status === 'running') return false
  await session.settlement?.catch(() => undefined)
  return true
}

export async function readBashSessionPayload(sessionId: string, threadId?: string): Promise<BashPayload | null> {
  const session = sessionById(sessionId, threadId)
  if (!session) return null
  return sessionPayload(session)
}

export async function listBashSessionRecords(threadId?: string): Promise<BackgroundShellRecordInput[]> {
  const records: BackgroundShellRecordInput[] = []
  for (const session of bashSessions.values()) {
    if (threadId && session.threadId !== threadId) continue
    records.push(await recordFromBackgroundSession(session, session.detached))
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function pollBashSession(
  sessionId: string,
  yieldSeconds: number,
  threadId?: string
): Promise<BashPayload | null> {
  const session = sessionById(sessionId, threadId)
  if (!session) return null
  await waitForSessionExitOrDelay(session, normalizeYieldSeconds(yieldSeconds) * 1000)
  return sessionPayload(session)
}

export async function writeBashSessionStdin(
  sessionId: string,
  input: string,
  yieldSeconds: number,
  threadId?: string
): Promise<BashPayload | null> {
  const session = sessionById(sessionId, threadId)
  if (!session) return null
  if (session.status !== 'running') return sessionPayload(session)
  session.child.stdin.write(input)
  await waitForSessionExitOrDelay(session, normalizeYieldSeconds(yieldSeconds) * 1000)
  return sessionPayload(session)
}


export function appendTruncationNotice(
  text: string,
  truncated: TextSlice,
  mode: TruncateMode,
  maxBytes: number
): string {
  if (!truncated.truncated) return text
  const prefix = text.trimEnd()
  const notice = truncated.firstLineExceedsLimit
    ? `[first line exceeds ${formatSize(maxBytes)}; refine the read range or use bash for a byte-limited slice]`
    : `[truncated: showing ${describeKind(mode)} ${truncated.shownLines} of ${truncated.totalLines} lines, ${truncated.shownBytes} of ${truncated.totalBytes} bytes]`
  return prefix ? `${prefix}\n\n${notice}` : notice
}
