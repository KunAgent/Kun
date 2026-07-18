import { mkdir } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { OutputAccumulator } from './output-accumulator.js'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from './truncate.js'
import type { BashLocalToolOptions, TextSlice, TruncateMode, BackgroundShellRecordInput } from './builtin-tool-types.js'
import { DEFAULT_BASH_TIMEOUT_SECONDS } from './builtin-tool-types.js'
import {
  BackgroundShellOutputWriter
} from '../../services/background-shell-output.js'
import {
  describeKind,
  normalizePositiveInteger,
  createShellCommandRunner,
  ShellSpawnError,
  type ShellCommandRunner,
  terminateSpawnTree,
  waitForSpawnExit,
  withToolBoundary,
  workspaceRoot
} from './builtin-tool-utils.js'

const DEFAULT_BASH_YIELD_SECONDS = 10
const MAX_BASH_YIELD_SECONDS = 60
const SESSION_EXIT_FLUSH_MS = 50
const STOP_GRACE_MS = 1000
const FINISHED_SESSION_RETENTION_MS = 10 * 60 * 1000
export const DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS = 32
export const DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS_PER_THREAD = 4
export const DEFAULT_MAX_BACKGROUND_BASH_TIMEOUT_SECONDS = 24 * 60 * 60

type BackgroundSessionLimits = {
  maxRunningSessions: number
  maxRunningSessionsPerThread: number
  maxTimeoutSeconds: number
}

type BashSessionStatus = 'running' | 'completed' | 'stopped' | 'failed'

type BashSession = {
  id: string
  threadId?: string
  turnId?: string
  command: string
  cwd: string
  shell: string
  child: ChildProcessWithoutNullStreams
  output: OutputAccumulator
  outputMaxBytes: number
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  status: BashSessionStatus
  error?: string
  stopRequested: boolean
  finalized: boolean
  finalization?: Promise<void>
  settlement?: Promise<void>
  detached: boolean
  exitWaiters: Set<() => void>
  outputWriter?: BackgroundShellOutputWriter
}

type BashPayload = {
  command: string
  cwd: string
  shell: string
  exit_code: number | null
  output: string
  full_output_path?: string | null
  truncation?: null | {
    total_lines: number
    output_lines: number
    total_bytes: number
    output_bytes: number
    truncated_by: string | null
    last_line_partial: boolean
  }
  session_id?: string
  status?: BashSessionStatus
  started_at?: string
  finished_at?: string
  pid?: number
  partial?: boolean
  stop_sent?: boolean
  error?: string
  output_file?: string
}

const bashSessions = new Map<string, BashSession>()
const backgroundSessionReservations = new Map<string, number>()

function runningBackgroundSessionCount(threadId?: string): number {
  let count = 0
  for (const session of bashSessions.values()) {
    if (session.status !== 'running') continue
    if (threadId && session.threadId !== threadId) continue
    count += 1
  }
  return count
}

function pendingBackgroundSessionCount(threadId?: string): number {
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
function reserveBackgroundSession(
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

async function bashExecute(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutSeconds: number,
  outputLimits: { maxLines: number; maxBytes: number },
  onUpdate?: (update: { output: unknown; isError?: boolean }) => Promise<void> | void,
  execOperation?: (
    command: string,
    cwd: string,
    options: { signal: AbortSignal; timeoutSeconds: number; onData?: (data: Buffer) => void }
  ) => Promise<{ exitCode: number | null; shell?: string }>,
  shellRunner: ShellCommandRunner = createShellCommandRunner()
): Promise<{
  output: string
  exitCode: number | null
  shell: string
  truncated: TextSlice
  fullOutputPath?: string
}> {
  await mkdir(cwd, { recursive: true })
  let resultShell = shellRunner.runtime.name
  const started = execOperation
    ? null
    : signal.aborted
      ? null
      : await shellRunner.spawn(command, {
          cwd,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
  const child = started?.child ?? null
  if (started) resultShell = started.runtime.name
  if (!execOperation && signal.aborted) {
    if (child) terminateSpawnTree(child)
    throw new Error('command aborted')
  }
  let timedOut = false
  let settled = false
  const output = new OutputAccumulator({
    maxLines: outputLimits.maxLines,
    maxBytes: outputLimits.maxBytes,
    tempFilePrefix: 'kun-bash'
  })
  let updateDirty = false
  let updateTimer: NodeJS.Timeout | undefined
  let lastUpdateAt = 0
  const handleData = (chunk: Buffer) => {
    output.append(chunk)
    scheduleUpdate()
  }
  const emitUpdate = async () => {
    if (!onUpdate || !updateDirty) return
    updateDirty = false
    lastUpdateAt = Date.now()
    const snapshot = output.snapshot({ persistIfTruncated: true })
    await onUpdate({
      output: {
        command,
        cwd,
        shell: resultShell,
        exit_code: null,
        output: snapshot.content,
        full_output_path: snapshot.fullOutputPath ?? null,
        truncation: snapshot.truncation.truncated
          ? {
              total_lines: snapshot.truncation.totalLines,
              output_lines: snapshot.truncation.outputLines,
              total_bytes: snapshot.truncation.totalBytes,
              output_bytes: snapshot.truncation.outputBytes,
              truncated_by: snapshot.truncation.truncatedBy ?? null,
              last_line_partial: snapshot.truncation.lastLinePartial === true
            }
          : null,
        partial: true
      }
    })
  }
  const scheduleUpdate = () => {
    if (!onUpdate) return
    updateDirty = true
    const delay = 100 - (Date.now() - lastUpdateAt)
    if (delay <= 0) {
      void emitUpdate()
      return
    }
    if (updateTimer) return
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      void emitUpdate()
    }, delay)
  }
  const kill = () => {
    if (settled) return
    if (!child) return
    terminateSpawnTree(child)
  }
  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeoutSeconds * 1000)
  const onAbort = () => kill()
  let exitCode: number | null
  if (execOperation) {
    try {
      const result = await execOperation(command, cwd, {
        signal,
        timeoutSeconds,
        onData: handleData
      })
      exitCode = result.exitCode
      resultShell = result.shell ?? resultShell
    } finally {
      settled = true
      clearTimeout(timer)
      if (updateTimer) clearTimeout(updateTimer)
    }
  } else {
    if (!child) throw new Error('shell process failed to start')
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    exitCode = await waitForSpawnExit(child).finally(() => {
      settled = true
      clearTimeout(timer)
      if (updateTimer) clearTimeout(updateTimer)
      signal.removeEventListener('abort', onAbort)
    })
  }

  if (signal.aborted) {
    throw new Error('command aborted')
  }
  if (timedOut) {
    throw new Error(`command timed out after ${timeoutSeconds} seconds`)
  }

  output.finish()
  await emitUpdate()
  const snapshot = output.snapshot({ persistIfTruncated: true })
  await output.closeTempFile()
  const truncated: TextSlice = {
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
  return {
    output: snapshot.content,
    exitCode,
    shell: resultShell,
    truncated,
    fullOutputPath: snapshot.fullOutputPath
  }
}

function createOutputAccumulator(
  outputLimits: { maxLines: number; maxBytes: number } = {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES
  },
  options: { persistFullOutput?: boolean } = {}
): OutputAccumulator {
  return new OutputAccumulator({
    maxLines: outputLimits.maxLines,
    maxBytes: outputLimits.maxBytes,
    tempFilePrefix: 'kun-bash',
    ...options
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SESSION_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const SESSION_ID_LENGTH = 8
const SESSION_ID_PATTERN = /^[a-z0-9]{8}$/

function nextSessionId(): string {
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

function resultPayload(input: {
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

async function finalizeSessionOutput(session: BashSession): Promise<void> {
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

async function backgroundSessionPayload(
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

async function sessionPayload(
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

function settleSession(
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

function waitForSessionExitOrDelay(session: BashSession, ms: number): Promise<boolean> {
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

function stopSession(session: BashSession): void {
  if (session.status !== 'running') return
  session.stopRequested = true
  terminateSpawnTree(session.child)
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

async function recordFromBackgroundSession(session: BashSession, detached: boolean): Promise<BackgroundShellRecordInput> {
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
  stopSession(session)
  await waitForSessionExitOrDelay(session, STOP_GRACE_MS)
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

async function startBackgroundBashSession(
  input: {
    command: string
    cwd: string
    threadId: string
    turnId: string
    signal: AbortSignal
    timeoutSeconds: number
    detached: boolean
    dataDir?: string
    outputLimits: { maxLines: number; maxBytes: number }
    backgroundLimits: BackgroundSessionLimits
  },
  hooks: BashLocalToolOptions['backgroundShell'],
  onUpdate?: (update: { output: unknown; isError?: boolean }) => Promise<void> | void,
  shellRunner: ShellCommandRunner = createShellCommandRunner()
): Promise<{ payload: BashPayload; isError?: boolean }> {
  if (!input.dataDir?.trim()) {
    throw new Error('background shell sessions require runtime dataDir')
  }
  await mkdir(input.cwd, { recursive: true })
  const releaseReservation = reserveBackgroundSession(input.threadId, input.backgroundLimits)
  let shellRuntime = shellRunner.runtime
  let child: ChildProcessWithoutNullStreams | undefined
  let sessionId = ''
  let outputWriter: BackgroundShellOutputWriter | undefined
  try {
    sessionId = nextSessionId()
    outputWriter = new BackgroundShellOutputWriter(input.dataDir, input.threadId, sessionId)
    await outputWriter.open()
    // Open the bounded log before spawning so a storage failure cannot leave
    // an untracked detached child behind. The runner waits only for the spawn
    // handshake so it can retry pre-spawn failures safely.
    const started = await shellRunner.spawn(input.command, {
      cwd: input.cwd,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    shellRuntime = started.runtime
    child = started.child as ChildProcessWithoutNullStreams
  } catch (error) {
    releaseReservation()
    if (child) terminateSpawnTree(child)
    if (outputWriter) await outputWriter.close().catch(() => undefined)
    throw error
  }
  releaseReservation()
  if (!child || !outputWriter) throw new Error('background shell process failed to start')
  const session: BashSession = {
    id: sessionId,
    threadId: input.threadId,
    turnId: input.turnId,
    command: input.command,
    cwd: input.cwd,
    shell: shellRuntime.name,
    child,
    // BackgroundShellOutputWriter is the sole durable output path here and
    // caps storage at 10 MiB. Do not also let OutputAccumulator create an
    // unbounded /tmp full-output file after the preview truncates.
    output: createOutputAccumulator(input.outputLimits, { persistFullOutput: false }),
    outputMaxBytes: input.outputLimits.maxBytes,
    outputWriter,
    startedAt: new Date().toISOString(),
    exitCode: null,
    status: 'running',
    stopRequested: false,
    finalized: false,
    detached: input.detached,
    exitWaiters: new Set()
  }
  bashSessions.set(session.id, session)
  // A fast child may exit while start-hook I/O is still in progress. Every
  // later lifecycle notification waits for this promise so a terminal record
  // cannot be observed before its corresponding start record.
  const startedNotification = (async () => {
    if (!hooks) return
    await hooks.onSessionStarted?.(await recordFromBackgroundSession(session, input.detached))
  })()
  const startedNotificationSettled = startedNotification.catch(() => undefined)

  let updateNotificationDirty = false
  let updateNotificationInFlight: Promise<void> | undefined
  const flushUpdatedNotification = (): void => {
    if (!hooks?.onSessionUpdated || updateNotificationInFlight) return
    const flush = (async () => {
      await startedNotificationSettled
      while (updateNotificationDirty) {
        updateNotificationDirty = false
        await hooks.onSessionUpdated?.(await recordFromBackgroundSession(session, input.detached))
      }
    })()
    updateNotificationInFlight = flush
    void flush
      .catch(() => undefined)
      .finally(() => {
        if (updateNotificationInFlight === flush) updateNotificationInFlight = undefined
        if (updateNotificationDirty) flushUpdatedNotification()
      })
  }
  const notifyUpdated = (): void => {
    if (!hooks?.onSessionUpdated) return
    updateNotificationDirty = true
    flushUpdatedNotification()
  }
  const notifySettled = async () => {
    await startedNotificationSettled
    if (!hooks) return
    await hooks.onSessionSettled?.(await recordFromBackgroundSession(session, input.detached))
  }

  let updateDirty = false
  let updateTimer: NodeJS.Timeout | undefined
  let lastUpdateAt = 0
  let liveUpdates = true
  let updateInFlight: Promise<void> | undefined
  const flushUpdate = async () => {
    if (!liveUpdates || !onUpdate || !updateDirty) return
    updateDirty = false
    lastUpdateAt = Date.now()
    const payload = await sessionPayload(session)
    await onUpdate({ output: payload })
    // Do not enqueue a stale "running" update after the process has reached
    // a terminal state and its completion notification is being published.
    if (liveUpdates) notifyUpdated()
  }
  const emitUpdate = (): void => {
    if (updateInFlight) return
    const flush = flushUpdate()
    updateInFlight = flush
    void flush
      .catch(() => undefined)
      .finally(() => {
        if (updateInFlight === flush) updateInFlight = undefined
        if (updateDirty && liveUpdates) scheduleUpdate()
      })
  }
  const scheduleUpdate = () => {
    if (!liveUpdates || !onUpdate) return
    updateDirty = true
    const delay = 100 - (Date.now() - lastUpdateAt)
    if (delay <= 0) {
      emitUpdate()
      return
    }
    if (updateTimer) return
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      emitUpdate()
    }, delay)
  }
  const handleData = (chunk: Buffer | string) => {
    if (session.finalized) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    session.output.append(buffer)
    session.outputWriter?.append(buffer)
    scheduleUpdate()
  }
  child.stdout.on('data', handleData)
  child.stderr.on('data', handleData)
  const settleAndNotify = (
    status: Exclude<BashSessionStatus, 'running'>,
    exitCode: number | null,
    error?: string
  ): Promise<void> => {
    if (!settleSession(session, status, exitCode, error)) {
      return session.settlement ?? Promise.resolve()
    }
    const settlement = (async () => {
      liveUpdates = false
      if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = undefined
      }
      try {
        await finalizeSessionOutput(session)
      } catch {
        // The session status is still terminal and must be published even if its
        // optional output file cannot be closed cleanly.
      }
      await notifySettled()
    })()
    session.settlement = settlement
    return settlement
  }
  child.once('error', (error) => {
    void settleAndNotify('failed', null, error.message).catch(() => undefined)
  })
  child.once('exit', (code) => {
    void settleAndNotify(session.stopRequested ? 'stopped' : 'completed', code).catch(() => undefined)
  })
  // A trivial command can exit between the runner's spawn handshake and the
  // lifecycle listeners above. ChildProcess retains its terminal state even
  // when the one-shot event was emitted before these listeners were attached.
  if (child.exitCode !== null || child.signalCode !== null) {
    void settleAndNotify(
      session.stopRequested ? 'stopped' : 'completed',
      child.exitCode
    ).catch(() => undefined)
  }

  const initialPayload = await sessionPayload(session)
  await startedNotification

  if (input.detached) {
    const timeoutMs = input.timeoutSeconds * 1000
    const timeoutTimer = setTimeout(() => {
      if (session.status !== 'running') return
      stopSession(session)
    }, timeoutMs)
    timeoutTimer.unref?.()
    child.once('exit', () => clearTimeout(timeoutTimer))
    child.once('error', () => clearTimeout(timeoutTimer))
    return { payload: initialPayload }
  }

  throw new Error('startBackgroundBashSession requires detached=true')
}

function appendTruncationNotice(
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

export function createBashLocalTool(options: BashLocalToolOptions = {}): LocalTool {
  const bashOps = options.operations
  const shellHooks = options.backgroundShell
  const backgroundShellDataDir = options.backgroundShellDataDir
  const backgroundLimits: BackgroundSessionLimits = {
    maxRunningSessions: Math.max(
      1,
      normalizePositiveInteger(
        options.maxBackgroundSessions,
        DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS
      )
    ),
    maxRunningSessionsPerThread: Math.max(
      1,
      normalizePositiveInteger(
        options.maxBackgroundSessionsPerThread,
        DEFAULT_MAX_RUNNING_BACKGROUND_BASH_SESSIONS_PER_THREAD
      )
    ),
    maxTimeoutSeconds: Math.max(
      1,
      normalizePositiveInteger(
        options.maxBackgroundTimeoutSeconds,
        DEFAULT_MAX_BACKGROUND_BASH_TIMEOUT_SECONDS
      )
    )
  }
  const outputLimits = {
    maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES
  }
  const shellRunner = createShellCommandRunner()
  const shellRuntime = shellRunner.runtime
  return LocalToolHost.defineTool({
    name: 'bash',
    description: `Execute a shell command in the workspace using the host platform shell. Current shell: ${shellRuntime.name}. Use ${shellRuntime.syntax} syntax. Return combined stdout and stderr. Runs synchronously by default (background defaults to false). Set background=true to start a detached session that keeps running after the turn ends; the tool assigns an 8-character session_id in the response. Use the background_shell tool to list, read, poll, write, or stop background sessions.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
        background: { type: 'boolean', default: false }
      },
      required: [],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'command_execution',
    execute: async (args, context, onUpdate) => withToolBoundary(async () => {
      const command = typeof args.command === 'string' ? args.command : ''
      if (!command.trim()) return { output: { error: 'command is required' }, isError: true }
      const timeout = normalizePositiveInteger(
        args.timeout,
        options.defaultTimeoutSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS
      )
      const background = args.background === true
      const cwd = workspaceRoot(context.workspace)
      try {
        if (background) {
          if (timeout > backgroundLimits.maxTimeoutSeconds) {
            return {
              output: {
                error: `background shell timeout exceeds ${backgroundLimits.maxTimeoutSeconds} seconds`,
                timeout
              },
              isError: true
            }
          }
          if (bashOps?.exec) {
            return {
              output: { error: 'background sessions are not supported with custom bash exec operations' },
              isError: true
            }
          }
          const result = await startBackgroundBashSession(
            {
              command,
              cwd,
              threadId: context.threadId,
              turnId: context.turnId,
              signal: context.abortSignal,
              timeoutSeconds: timeout,
              detached: true,
              dataDir: backgroundShellDataDir,
              outputLimits,
              backgroundLimits
            },
            shellHooks,
            onUpdate,
            shellRunner
          )
          return {
            output: result.payload,
            isError: result.isError
          }
        }
        const result = await bashExecute(
          command,
          cwd,
          context.abortSignal,
          timeout,
          outputLimits,
          onUpdate,
          bashOps?.exec,
          shellRunner
        )
        const payload = resultPayload({
          command,
          cwd,
          shell: result.shell,
          exitCode: result.exitCode ?? 0,
          output: result.output,
          truncated: result.truncated,
          maxBytes: outputLimits.maxBytes,
          fullOutputPath: result.fullOutputPath
        })
        if (result.exitCode && result.exitCode !== 0) {
          return {
            output: payload,
            isError: true
          }
        }
        return {
          output: payload
        }
      } catch (error) {
        const spawnError = error instanceof ShellSpawnError ? error.toJSON() : undefined
        return {
          output: {
            command,
            cwd,
            error: error instanceof Error ? error.message : String(error),
            ...(spawnError ? { spawn_error: spawnError } : {})
          },
          isError: true
        }
      }
    })
  })
}

export const createBashTool = createBashLocalTool
export const createBashToolDefinition = createBashLocalTool
