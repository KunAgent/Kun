import { resolve } from 'node:path'
import { z } from 'zod'
import { RuntimeEvent, type RuntimeEvent as RuntimeEventValue } from '../contracts/events.js'
import { RuntimeInfoResponse, type RuntimeInfoResponse as RuntimeInfoValue } from '../contracts/runtime-info.js'
import { TurnReasoningEffortSchema } from '../contracts/turns.js'
import type { UsageSnapshot } from '../contracts/usage.js'

const ReplayExpectationSchema = z.object({
  minAssistantChars: z.number().int().nonnegative().default(1),
  requiredTools: z.array(z.string().min(1)).default([]),
  requiredAnyTools: z.array(z.string().min(1)).default([]),
  maxErrorEvents: z.number().int().nonnegative().default(0),
  maxTotalMs: z.number().int().positive().optional()
}).strict()

const ReplayTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  prompt: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  workspace: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  expect: ReplayExpectationSchema.default(() => ReplayExpectationSchema.parse({}))
}).strict()

export const ReplaySuiteSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  defaults: z.object({
    model: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    reasoningEffort: TurnReasoningEffortSchema.optional(),
    timeoutMs: z.number().int().positive().default(300_000)
  }).strict().default(() => ({ timeoutMs: 300_000 })),
  tasks: z.array(ReplayTaskSchema).min(1).max(100)
}).strict().superRefine((suite, context) => {
  const ids = new Set<string>()
  suite.tasks.forEach((task, index) => {
    if (ids.has(task.id)) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', index, 'id'],
        message: `duplicate replay task id: ${task.id}`
      })
    }
    ids.add(task.id)
  })
})

export type ReplaySuite = z.infer<typeof ReplaySuiteSchema>
export type ReplayTask = z.infer<typeof ReplayTaskSchema>

export type ObservedReplayEvent = {
  event: RuntimeEventValue
  receivedAtMs: number
  elapsedMs: number
}

export type ReplayRunMetrics = {
  ttftMs: number | null
  totalMs: number
  assistantChars: number
  eventCount: number
  errorEvents: number
  toolCalls: number
  toolDurationMs: number
  toolDurationP95Ms: number | null
  sseDelayP50Ms: number | null
  sseDelayP95Ms: number | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number | null
  cacheMissTokens: number | null
  cacheHitRate: number | null
  cacheableTokenHitRate: number | null
  totalInputTokenHitRate: number | null
  costUsd: number
  peakRssBytes: number | null
}

export type ReplayRunResult = {
  id: string
  taskId: string
  iteration: number
  tags: string[]
  threadId?: string
  turnId?: string
  status: 'passed' | 'failed' | 'timeout' | 'error'
  failureReasons: string[]
  metrics: ReplayRunMetrics
  error?: string
}

export type ReplayReportSummary = {
  runCount: number
  passed: number
  failed: number
  timedOut: number
  errors: number
  successRate: number
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  totalP50Ms: number | null
  totalP95Ms: number | null
  toolDurationP95Ms: number | null
  sseDelayP95Ms: number | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitRate: number | null
  cacheableTokenHitRate: number | null
  totalInputTokenHitRate: number | null
  costUsd: number
  peakRssBytes: number | null
}

export type ReplayComparison = {
  baselineGeneratedAt: string
  successRateDelta: number
  ttftP95MsDelta: number | null
  totalP95MsDelta: number | null
  promptTokensDelta: number
  cacheHitRateDelta: number | null
  costUsdDelta: number
  peakRssBytesDelta: number | null
  regressions: string[]
}

export type ReplayReport = {
  version: 1
  generatedAt: string
  suite: { name: string; taskCount: number; repeat: number; tag?: string }
  runtime: {
    baseUrl: string
    model?: string
    startedAt: string
    pid?: number
  }
  summary: ReplayReportSummary
  runs: ReplayRunResult[]
  comparison?: ReplayComparison
}

export type RunReplaySuiteOptions = {
  baseUrl: string
  token?: string
  workspace: string
  repeat?: number
  concurrency?: number
  tag?: string
  keepThreads?: boolean
  fetchImpl?: typeof fetch
  onProgress?: (completed: number, total: number, run: ReplayRunResult) => void
}

type ReplayHttpClient = {
  getRuntimeInfo(): Promise<RuntimeInfoValue>
  createThread(body: Record<string, unknown>): Promise<{ id: string }>
  startTurn(threadId: string, body: Record<string, unknown>): Promise<{ turnId: string }>
  openEvents(threadId: string, signal: AbortSignal): Promise<Response>
  interruptTurn(threadId: string, turnId: string): Promise<void>
  deleteThread(threadId: string): Promise<void>
}

export async function runReplaySuite(
  suiteInput: unknown,
  options: RunReplaySuiteOptions
): Promise<ReplayReport> {
  const suite = ReplaySuiteSchema.parse(suiteInput)
  const repeat = clampInteger(options.repeat ?? 1, 1, 20)
  const concurrency = clampInteger(options.concurrency ?? 1, 1, 8)
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const client = createReplayHttpClient(baseUrl, options.token, options.fetchImpl ?? fetch)
  const runtime = await client.getRuntimeInfo()
  const selectedTasks = options.tag
    ? suite.tasks.filter((task) => task.tags.includes(options.tag!))
    : suite.tasks
  if (selectedTasks.length === 0) {
    throw new Error(`replay suite has no tasks tagged "${options.tag}"`)
  }
  const jobs = selectedTasks.flatMap((task) =>
    Array.from({ length: repeat }, (_, index) => ({ task, iteration: index + 1 }))
  )
  const runs = new Array<ReplayRunResult>(jobs.length)
  let cursor = 0
  let completed = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const jobIndex = cursor
      cursor += 1
      const job = jobs[jobIndex]
      if (!job) return
      const run = await runReplayTask({
        suite,
        task: job.task,
        iteration: job.iteration,
        runtime,
        client,
        workspace: options.workspace,
        keepThread: options.keepThreads === true
      })
      runs[jobIndex] = run
      completed += 1
      options.onProgress?.(completed, jobs.length, run)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()))
  const report: ReplayReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    suite: {
      name: suite.name,
      taskCount: selectedTasks.length,
      repeat,
      ...(options.tag ? { tag: options.tag } : {})
    },
    runtime: {
      baseUrl,
      ...(runtime.model ? { model: runtime.model } : {}),
      startedAt: runtime.startedAt,
      ...(runtime.pid ? { pid: runtime.pid } : {})
    },
    summary: summarizeReplayRuns(runs),
    runs
  }
  return report
}

async function runReplayTask(input: {
  suite: ReplaySuite
  task: ReplayTask
  iteration: number
  runtime: RuntimeInfoValue
  client: ReplayHttpClient
  workspace: string
  keepThread: boolean
}): Promise<ReplayRunResult> {
  const { suite, task, iteration, runtime, client } = input
  const runId = `${task.id}#${iteration}`
  const model = task.model ?? suite.defaults.model ?? runtime.model
  if (!model) return errorReplayRun(runId, task, iteration, 'runtime did not report a default model')
  const workspace = resolve(input.workspace, task.workspace ?? '.')
  let threadId: string | undefined
  let turnId: string | undefined
  let shouldInterrupt = false
  try {
    const thread = await client.createThread({
      title: `[replay] ${runId}`,
      titleAuto: false,
      workspace,
      model,
      ...(task.providerId ?? suite.defaults.providerId
        ? { providerId: task.providerId ?? suite.defaults.providerId }
        : {}),
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'read-only'
    })
    threadId = thread.id
    const startedAt = performance.now()
    const turn = await client.startTurn(threadId, {
      prompt: task.prompt,
      reasoningEffort: task.reasoningEffort ?? suite.defaults.reasoningEffort ?? 'off',
      approvalPolicy: 'auto',
      sandboxMode: 'read-only',
      disableUserInput: true
    })
    turnId = turn.turnId
    const timeoutMs = task.timeoutMs ?? suite.defaults.timeoutMs
    const collected = await collectReplayEvents({
      client,
      threadId,
      turnId,
      startedAt,
      timeoutMs
    })
    shouldInterrupt = collected.timedOut || !hasTerminalTurnEvent(collected.events, turnId)
    const after = await client.getRuntimeInfo().catch(() => runtime)
    const metrics = summarizeReplayEvents(
      collected.events,
      collected.elapsedMs,
      after.memoryUsage?.peakRssBytes
    )
    const failureReasons = replayExpectationFailures(task, collected.timedOut, metrics, collected.events)
    return {
      id: runId,
      taskId: task.id,
      iteration,
      tags: task.tags,
      threadId,
      turnId,
      status: collected.timedOut ? 'timeout' : failureReasons.length > 0 ? 'failed' : 'passed',
      failureReasons,
      metrics
    }
  } catch (error) {
    shouldInterrupt = turnId !== undefined
    return {
      ...errorReplayRun(runId, task, iteration, errorMessage(error)),
      ...(threadId ? { threadId } : {}),
      ...(turnId ? { turnId } : {})
    }
  } finally {
    if (threadId && turnId && shouldInterrupt) {
      await client.interruptTurn(threadId, turnId).catch(() => undefined)
    }
    if (threadId && !input.keepThread) {
      await client.deleteThread(threadId).catch(() => undefined)
    }
  }
}

async function collectReplayEvents(input: {
  client: ReplayHttpClient
  threadId: string
  turnId: string
  startedAt: number
  timeoutMs: number
}): Promise<{ events: ObservedReplayEvent[]; elapsedMs: number; timedOut: boolean }> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs)
  timer.unref?.()
  const observed: ObservedReplayEvent[] = []
  try {
    const response = await input.client.openEvents(input.threadId, controller.signal)
    if (!response.body) throw new Error('runtime SSE response has no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const sse = new SseMessageDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      for (const message of sse.push(decoder.decode(chunk.value, { stream: true }))) {
        const parsed = parseRuntimeSseMessage(message)
        if (!parsed) continue
        const receivedAtMs = Date.now()
        observed.push({
          event: parsed,
          receivedAtMs,
          elapsedMs: Math.max(0, performance.now() - input.startedAt)
        })
        if (parsed.turnId === input.turnId && isTerminalTurnEvent(parsed.kind)) {
          controller.abort()
          return {
            events: observed,
            elapsedMs: Math.max(0, performance.now() - input.startedAt),
            timedOut: false
          }
        }
      }
    }
    return {
      events: observed,
      elapsedMs: Math.max(0, performance.now() - input.startedAt),
      timedOut
    }
  } catch (error) {
    if (!timedOut && !controller.signal.aborted) throw error
    return {
      events: observed,
      elapsedMs: Math.max(0, performance.now() - input.startedAt),
      timedOut
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export function summarizeReplayEvents(
  observed: ObservedReplayEvent[],
  elapsedMs: number,
  peakRssBytes?: number
): ReplayRunMetrics {
  const firstText = observed.find(({ event }) =>
    event.kind === 'assistant_text_delta' && event.item.kind === 'assistant_text' && event.item.text.length > 0
  ) ?? observed.find(({ event }) =>
    (event.kind === 'item_created' || event.kind === 'item_completed') &&
    event.item.kind === 'assistant_text' &&
    event.item.text.length > 0
  )
  const assistantTextByItem = new Map<string, string>()
  const toolStarted = new Map<string, number>()
  const toolDurations: number[] = []
  const toolCallIds = new Set<string>()
  const sseDelays: number[] = []
  let errorEvents = 0
  let usage: UsageSnapshot | undefined
  for (const record of observed) {
    const eventTime = Date.parse(record.event.timestamp)
    if (Number.isFinite(eventTime)) sseDelays.push(Math.max(0, record.receivedAtMs - eventTime))
    if (record.event.kind === 'error' || record.event.kind === 'turn_failed') errorEvents += 1
    if (record.event.kind === 'usage') usage = record.event.usage
    if ('item' in record.event && record.event.item.kind === 'assistant_text') {
      const itemId = record.event.item.id
      if (record.event.kind === 'assistant_text_delta') {
        assistantTextByItem.set(itemId, `${assistantTextByItem.get(itemId) ?? ''}${record.event.item.text}`)
      } else {
        assistantTextByItem.set(itemId, record.event.item.text)
      }
    }
    if (record.event.kind === 'tool_call_started' && 'item' in record.event && 'callId' in record.event.item) {
      toolStarted.set(record.event.item.callId, record.elapsedMs)
      toolCallIds.add(record.event.item.callId)
    }
    if (record.event.kind === 'tool_call_finished' && 'item' in record.event && 'callId' in record.event.item) {
      const started = toolStarted.get(record.event.item.callId)
      if (started !== undefined) toolDurations.push(Math.max(0, record.elapsedMs - started))
      toolCallIds.add(record.event.item.callId)
    }
  }
  const assistantChars = [...assistantTextByItem.values()].reduce((total, text) => total + text.length, 0)
  const hit = usage?.cacheHitTokens
  const miss = usage?.cacheMissTokens
  const cacheTotal = (hit ?? 0) + (miss ?? 0)
  return {
    ttftMs: firstText ? roundMetric(firstText.elapsedMs) : null,
    totalMs: roundMetric(elapsedMs),
    assistantChars,
    eventCount: observed.length,
    errorEvents,
    toolCalls: toolCallIds.size,
    toolDurationMs: roundMetric(toolDurations.reduce((total, value) => total + value, 0)),
    toolDurationP95Ms: percentile(toolDurations, 0.95),
    sseDelayP50Ms: percentile(sseDelays, 0.5),
    sseDelayP95Ms: percentile(sseDelays, 0.95),
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheHitTokens: hit ?? null,
    cacheMissTokens: miss ?? null,
    cacheHitRate: usage?.cacheHitRate ?? (cacheTotal > 0 ? (hit ?? 0) / cacheTotal : null),
    cacheableTokenHitRate: usage?.cacheableTokenHitRate ?? null,
    totalInputTokenHitRate: usage?.totalInputTokenHitRate ?? null,
    costUsd: usage?.costUsd ?? 0,
    peakRssBytes: peakRssBytes ?? null
  }
}

export function summarizeReplayRuns(runs: ReplayRunResult[]): ReplayReportSummary {
  const ttft = compactNumbers(runs.map((run) => run.metrics.ttftMs))
  const total = runs.map((run) => run.metrics.totalMs)
  const toolP95 = compactNumbers(runs.map((run) => run.metrics.toolDurationP95Ms))
  const sseP95 = compactNumbers(runs.map((run) => run.metrics.sseDelayP95Ms))
  const hitTokens = compactNumbers(runs.map((run) => run.metrics.cacheHitTokens)).reduce(sum, 0)
  const missTokens = compactNumbers(runs.map((run) => run.metrics.cacheMissTokens)).reduce(sum, 0)
  const cacheableRates = compactNumbers(runs.map((run) => run.metrics.cacheableTokenHitRate))
  const totalInputRates = compactNumbers(runs.map((run) => run.metrics.totalInputTokenHitRate))
  const passed = runs.filter((run) => run.status === 'passed').length
  return {
    runCount: runs.length,
    passed,
    failed: runs.filter((run) => run.status === 'failed').length,
    timedOut: runs.filter((run) => run.status === 'timeout').length,
    errors: runs.filter((run) => run.status === 'error').length,
    successRate: runs.length > 0 ? passed / runs.length : 0,
    ttftP50Ms: percentile(ttft, 0.5),
    ttftP95Ms: percentile(ttft, 0.95),
    totalP50Ms: percentile(total, 0.5),
    totalP95Ms: percentile(total, 0.95),
    toolDurationP95Ms: percentile(toolP95, 0.95),
    sseDelayP95Ms: percentile(sseP95, 0.95),
    promptTokens: runs.reduce((totalValue, run) => totalValue + run.metrics.promptTokens, 0),
    completionTokens: runs.reduce((totalValue, run) => totalValue + run.metrics.completionTokens, 0),
    totalTokens: runs.reduce((totalValue, run) => totalValue + run.metrics.totalTokens, 0),
    cacheHitRate: hitTokens + missTokens > 0 ? hitTokens / (hitTokens + missTokens) : null,
    cacheableTokenHitRate: average(cacheableRates),
    totalInputTokenHitRate: average(totalInputRates),
    costUsd: runs.reduce((totalValue, run) => totalValue + run.metrics.costUsd, 0),
    peakRssBytes: maxNullable(compactNumbers(runs.map((run) => run.metrics.peakRssBytes)))
  }
}

export function compareReplayReports(current: ReplayReport, baseline: ReplayReport): ReplayComparison {
  const successRateDelta = current.summary.successRate - baseline.summary.successRate
  const ttftP95MsDelta = nullableDelta(current.summary.ttftP95Ms, baseline.summary.ttftP95Ms)
  const totalP95MsDelta = nullableDelta(current.summary.totalP95Ms, baseline.summary.totalP95Ms)
  const cacheHitRateDelta = nullableDelta(current.summary.cacheHitRate, baseline.summary.cacheHitRate)
  const peakRssBytesDelta = nullableDelta(current.summary.peakRssBytes, baseline.summary.peakRssBytes)
  const regressions: string[] = []
  if (successRateDelta < 0) regressions.push(`success rate dropped by ${formatPercent(-successRateDelta)}`)
  if (isRelativeRegression(current.summary.ttftP95Ms, baseline.summary.ttftP95Ms, 0.2, 300)) {
    regressions.push(`TTFT p95 increased by ${ttftP95MsDelta}ms`)
  }
  if (isRelativeRegression(current.summary.totalP95Ms, baseline.summary.totalP95Ms, 0.2, 500)) {
    regressions.push(`total latency p95 increased by ${totalP95MsDelta}ms`)
  }
  if (cacheHitRateDelta !== null && cacheHitRateDelta < -0.05) {
    regressions.push(`cache hit rate dropped by ${formatPercent(-cacheHitRateDelta)}`)
  }
  if (baseline.summary.costUsd > 0 && current.summary.costUsd > baseline.summary.costUsd * 1.1) {
    regressions.push(`cost increased by $${(current.summary.costUsd - baseline.summary.costUsd).toFixed(6)}`)
  }
  return {
    baselineGeneratedAt: baseline.generatedAt,
    successRateDelta,
    ttftP95MsDelta,
    totalP95MsDelta,
    promptTokensDelta: current.summary.promptTokens - baseline.summary.promptTokens,
    cacheHitRateDelta,
    costUsdDelta: current.summary.costUsd - baseline.summary.costUsd,
    peakRssBytesDelta,
    regressions
  }
}

export type SseMessage = { event?: string; id?: string; data: string }

export class SseMessageDecoder {
  private buffer = ''

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n/g, '\n')
    const messages: SseMessage[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const message = parseSseBlock(block)
      if (message) messages.push(message)
      boundary = this.buffer.indexOf('\n\n')
    }
    return messages
  }
}

function createReplayHttpClient(
  baseUrl: string,
  token: string | undefined,
  fetchImpl: typeof fetch
): ReplayHttpClient {
  const headers = (): Headers => {
    const value = new Headers({ accept: 'application/json' })
    if (token) value.set('authorization', `Bearer ${token}`)
    return value
  }
  const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const requestHeaders = headers()
    if (init.body) requestHeaders.set('content-type', 'application/json')
    new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value))
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: requestHeaders
    })
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 1_000)
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`)
    }
    return await response.json() as T
  }
  return {
    async getRuntimeInfo() {
      return RuntimeInfoResponse.parse(await requestJson('/v1/runtime/info'))
    },
    createThread: (body) => requestJson('/v1/threads', { method: 'POST', body: JSON.stringify(body) }),
    startTurn: (threadId, body) => requestJson(`/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    async openEvents(threadId, signal) {
      const requestHeaders = headers()
      requestHeaders.set('accept', 'text/event-stream')
      const response = await fetchImpl(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}/events?since_seq=0`, {
        headers: requestHeaders,
        signal
      })
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 1_000)
        throw new Error(`GET events failed (${response.status}): ${body}`)
      }
      return response
    },
    async interruptTurn(threadId, turnId) {
      await requestJson(`/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`, {
        method: 'POST'
      })
    },
    async deleteThread(threadId) {
      await requestJson(`/v1/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    }
  }
}

function parseSseBlock(block: string): SseMessage | null {
  if (!block.trim()) return null
  let event: string | undefined
  let id: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator >= 0 ? line.slice(0, separator) : line
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : ''
    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  return { ...(event ? { event } : {}), ...(id ? { id } : {}), data: data.join('\n') }
}

function parseRuntimeSseMessage(message: SseMessage): RuntimeEventValue | null {
  let value: unknown
  try {
    value = JSON.parse(message.data)
  } catch {
    return null
  }
  const parsed = RuntimeEvent.safeParse(value)
  if (parsed.success) return parsed.data
  if (message.event === 'error') {
    const detail = value && typeof value === 'object' && 'message' in value
      ? String((value as { message?: unknown }).message ?? 'unknown SSE error')
      : 'unknown SSE error'
    throw new Error(`runtime SSE error: ${detail}`)
  }
  return null
}

function replayExpectationFailures(
  task: ReplayTask,
  timedOut: boolean,
  metrics: ReplayRunMetrics,
  events: ObservedReplayEvent[]
): string[] {
  const failures: string[] = []
  if (timedOut) failures.push('turn timed out')
  const terminal = events.find(({ event }) => event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted')
  if (!terminal) failures.push('no terminal turn event')
  else if (terminal.event.kind !== 'turn_completed') failures.push(`turn ended with ${terminal.event.kind}`)
  if (metrics.assistantChars < task.expect.minAssistantChars) {
    failures.push(`assistant output ${metrics.assistantChars} chars is below ${task.expect.minAssistantChars}`)
  }
  if (metrics.errorEvents > task.expect.maxErrorEvents) {
    failures.push(`error event count ${metrics.errorEvents} exceeds ${task.expect.maxErrorEvents}`)
  }
  if (task.expect.maxTotalMs && metrics.totalMs > task.expect.maxTotalMs) {
    failures.push(`total latency ${metrics.totalMs}ms exceeds ${task.expect.maxTotalMs}ms`)
  }
  const usedTools = new Set(events.flatMap(({ event }) => {
    if (!('item' in event) || !('toolName' in event.item)) return []
    return [event.item.toolName]
  }))
  for (const tool of task.expect.requiredTools) {
    if (!usedTools.has(tool)) failures.push(`required tool was not used: ${tool}`)
  }
  if (task.expect.requiredAnyTools.length > 0 && !task.expect.requiredAnyTools.some((tool) => usedTools.has(tool))) {
    failures.push(`none of the required tools were used: ${task.expect.requiredAnyTools.join(', ')}`)
  }
  return failures
}

function errorReplayRun(id: string, task: ReplayTask, iteration: number, error: string): ReplayRunResult {
  return {
    id,
    taskId: task.id,
    iteration,
    tags: task.tags,
    status: 'error',
    failureReasons: [error],
    metrics: emptyReplayMetrics(),
    error
  }
}

function emptyReplayMetrics(): ReplayRunMetrics {
  return {
    ttftMs: null,
    totalMs: 0,
    assistantChars: 0,
    eventCount: 0,
    errorEvents: 0,
    toolCalls: 0,
    toolDurationMs: 0,
    toolDurationP95Ms: null,
    sseDelayP50Ms: null,
    sseDelayP95Ms: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: null,
    cacheMissTokens: null,
    cacheHitRate: null,
    cacheableTokenHitRate: null,
    totalInputTokenHitRate: null,
    costUsd: 0,
    peakRssBytes: null
  }
}

function isTerminalTurnEvent(kind: RuntimeEventValue['kind']): boolean {
  return kind === 'turn_completed' || kind === 'turn_failed' || kind === 'turn_aborted'
}

function hasTerminalTurnEvent(events: ObservedReplayEvent[], turnId: string): boolean {
  return events.some(({ event }) => event.turnId === turnId && isTerminalTurnEvent(event.kind))
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1))
  return roundMetric(sorted[index] ?? 0)
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce(sum, 0) / values.length : null
}

function maxNullable(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null
}

function compactNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function nullableDelta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : current - baseline
}

function isRelativeRegression(
  current: number | null,
  baseline: number | null,
  ratio: number,
  minimumDelta: number
): boolean {
  if (current === null || baseline === null || baseline <= 0) return false
  return current - baseline >= minimumDelta && current > baseline * (1 + ratio)
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function sum(left: number, right: number): number {
  return left + right
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
