#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const RESPONSE_LIMIT = 6
const ROLES = ['coordinator', 'developer', 'reviewer']
const TERMINAL = new Set(['completed', 'cancelled'])
const TOKEN_KEYS = ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'cache_write_tokens', 'cache_miss_tokens', 'total_tokens', 'turns']
const FIRST_PROMPT = 'Discuss this synthetic queue-capacity question as a three-member group. ' +
  'Assume 120 jobs per minute and a mean service time of 2 seconds per job. I think two workers are sufficient. ' +
  'Coordinator: ask the developer to calculate capacity and the reviewer to challenge the assumptions. ' +
  'Members: contribute at most 120 words, avoid repeated conclusions, and stop when nothing new remains. ' +
  'This is discussion only. Do not browse, run commands, inspect files, or create or assign execution tasks.'
const CORRECTION = 'Correction to the same question: the measured arrival rate is 30 jobs per minute, ' +
  'with short bursts of 60 jobs per minute. Keep the service time at 2 seconds and target at most 70% worker utilization. ' +
  'Recompute the minimum steady-state and burst worker counts; explicitly identify which previous conclusion changes. ' +
  'Discuss only, at most 120 words per member. Do not create tasks or use external tools.'

export function evalOptions(args = process.argv.slice(2)) {
  const values = new Map()
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--run' || key === '--check') { values.set(key, true); continue }
    if (!['--url', '--evidence', '--timeout-ms', '--token-env'].includes(key) || !args[index + 1]) throw new Error('invalid_arguments')
    values.set(key, args[++index])
  }
  if (values.has('--run') && values.has('--check')) throw new Error('choose_run_or_check')
  const url = new URL(values.get('--url') ?? 'http://127.0.0.1:18899')
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('runtime_url_must_be_local_origin')
  const timeoutMs = Number(values.get('--timeout-ms') ?? 180000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('timeout_ms_out_of_range')
  const tokenEnv = values.get('--token-env') ?? 'KUN_RUNTIME_TOKEN'
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error('invalid_token_environment_name')
  return { run: values.has('--run'), url: url.origin, timeoutMs, tokenEnv,
    evidence: resolve(values.get('--evidence') ?? join('dist', 'rooms-peer-eval-' + Date.now())) }
}

class EvalHttpError extends Error {
  constructor(status, method) { super(`runtime_http_${status}_${method.toLowerCase()}`); this.status = status }
}
export function runtimeApi(options) {
  // Only the caller-selected local Runtime token is read. Provider credentials and configuration files are never opened.
  const token = process.env[options.tokenEnv]
  return async (path, method = 'GET', body) => {
    let response
    try {
      response = await fetch(options.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch { throw new Error('runtime_unreachable_or_request_timed_out') }
    if (!response.ok) throw new EvalHttpError(response.status, method)
    try { return await response.json() } catch { throw new Error('runtime_returned_invalid_json') }
  }
}
const id = () => 'eval-' + randomUUID()
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const encoded = encodeURIComponent
const roomPath = (roomId) => `/v1/rooms/${encoded(roomId)}`
const safeFailure = (error) => error instanceof EvalHttpError ? error.message :
  /^[a-z][a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'evaluation_failed'

export async function checkRuntime(api) {
  const health = await api('/health')
  if (health.service !== 'kun' || health.status !== 'ok') throw new Error('not_a_healthy_kun_runtime')
  const [info, catalog] = await Promise.all([api('/v1/runtime/info'), api('/v1/rooms/presets')])
  const missingPresets = ROLES.filter((role) => !catalog.presets?.some((preset) => preset.id === role && preset.available !== false))
  const model = catalog.defaultModel?.model ?? info.model
  const providerId = catalog.defaultModel?.providerId
  const unsupported = Boolean(providerId && catalog.unsupportedProviderIds?.includes(providerId))
  return { ready: Boolean(model) && !missingPresets.length && !unsupported,
    metadata: { serviceVersion: info.serviceVersion, model, endpointFormat: info.endpointFormat,
      missingPresets, nativeProvider: !unsupported },
    binding: providerId && model ? { providerId, model } : undefined }
}

function members(runId, mode, binding) {
  return ROLES.map((role) => ({ id: role, displayName: `${runId}-${mode}-${role}`, presetId: role, role,
    roleNotes: 'Use only the supplied synthetic question. Keep replies under 120 words. Discussion only; no external tools or execution.',
    enabled: true, allowedRepositoryIds: [], revision: 0, ...(binding ? { modelRef: binding } : {}),
    capabilityOverrides: { allowedTools: [], blockedTools: [], blockedMcpServers: [], blockedSkills: [], skillsEnabled: false } }))
}
async function requestStates(api, state) {
  const page = await api(roomPath(state.roomId) + '/requests?limit=200')
  const ids = [...new Set([...state.requestIds, ...page.requests.map((request) => request.id)])]
  return Promise.all(ids.map(async (requestId) =>
    (await api(`${roomPath(state.roomId)}/requests/${encoded(requestId)}`)).request))
}
async function topicStates(api, state) {
  if (state.mode !== 'peer') return []
  return (await api(roomPath(state.roomId) + '/topics?limit=50')).topics
}
function finalMessages(messages, requests, mode) {
  const completedReplies = new Map()
  for (const request of requests) for (const entry of [...(request.discussions ?? []), ...(request.previousDiscussions ?? [])]) {
    if (entry.response !== undefined) completedReplies.set('reply-' + entry.threadId, request.id)
  }
  const finishedRequests = requests.filter((request) => TERMINAL.has(request.status))
  return messages.filter((message) => message.authorKind === 'member' && (message.status === 'final' ||
    mode !== 'peer' && (completedReplies.has(message.id) || finishedRequests.some((request) => message.id === 'result-' + request.id))))
    .map((message) => ({ ...message, sourceRequestId: message.sourceRequestId ?? completedReplies.get(message.id) ??
      finishedRequests.find((request) => message.id === 'result-' + request.id)?.id }))
}
async function stopOwnedDiscussion(api, state) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const topics = await topicStates(api, state)
    const requests = await requestStates(api, state)
    let conflicted = false
    for (const topic of topics.filter((value) => !['stopped', 'stopping'].includes(value.status))) {
      try { await api(`${roomPath(state.roomId)}/topics/${encoded(topic.rootRequestId)}/stop`, 'POST', {
        clientRequestId: id(), expectedRevision: topic.revision }) }
      catch (error) { if (error.status === 409) conflicted = true; else throw error }
    }
    if (state.mode !== 'peer') for (const request of requests.filter((value) => !TERMINAL.has(value.status) && value.status !== 'stopping')) {
      try { await api(`${roomPath(state.roomId)}/requests/${encoded(request.id)}/cancel`, 'POST', {
        clientRequestId: id(), expectedRevision: request.revision }) }
      catch (error) { if (error.status === 409) conflicted = true; else throw error }
    }
    if (!conflicted) return
  }
  throw new Error('stop_revision_conflicts_exhausted')
}
async function waitStopped(api, state) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const topics = await topicStates(api, state), requests = await requestStates(api, state)
    if (state.mode === 'peer' ? topics.every((topic) => topic.status === 'stopped') : requests.every((request) => TERMINAL.has(request.status))) return true
    await delay(250)
  }
  return false
}
async function collectUsage(api, state) {
  const totals = Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]))
  let cursor, count = 0, complete = true
  const models = new Set(), threads = new Set()
  // Unique member titles locate this evaluation's side threads; full metadata proves ownership before a usage read.
  do {
    const page = await api(`/v1/threads?include=side&include_archived=true&limit=200&search=${encoded(state.memberPrefix)}${cursor ? '&cursor=' + encoded(cursor) : ''}`)
    for (const summary of page.threads) {
      if (threads.has(summary.id)) continue
      const thread = await api(`/v1/threads/${encoded(summary.id)}`)
      if (thread.roomContext?.roomId !== state.roomId) continue
      threads.add(summary.id)
      if (typeof thread.model === 'string') models.add(thread.model)
      const usage = await api(`/v1/usage?group_by=thread&thread_id=${encoded(thread.id)}`)
      const bucket = usage.buckets?.find((entry) => entry.thread_id === thread.id)
      if (!bucket) { complete = false; continue }
      count++
      for (const key of TOKEN_KEYS) if (Number.isFinite(bucket[key])) totals[key] += bucket[key]
    }
    cursor = page.nextCursor
    if (threads.size > 100) throw new Error('unexpected_evaluation_thread_count')
  } while (cursor)
  return { coverage: 'response_and_coordination_threads',
    completeForLocatedThreads: complete && count > 0, threadCount: count, models: [...models], totals: count ? totals : null }
}
async function collectPeerMetrics(api, state) {
  if (state.mode !== 'peer' || !state.rootRequestId) return null
  const metrics = new Map(), totals = Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]))
  let cursor, knownUsage = 0, triageMetrics = 0
  do {
    const page = await api(`${roomPath(state.roomId)}/topics/${encoded(state.rootRequestId)}/metrics?limit=200${cursor ? '&cursor=' + encoded(cursor) : ''}`)
    for (const metric of page.metrics) if (metric.rootRequestId === state.rootRequestId) metrics.set(metric.id, metric)
    cursor = page.nextCursor
    if (metrics.size > 1000) throw new Error('unexpected_evaluation_metric_count')
  } while (cursor)
  const numericUsage = (usage) => {
    if (!usage || !Number.isFinite(usage.totalTokens)) return null
    return { input_tokens: usage.promptTokens, output_tokens: usage.completionTokens, reasoning_tokens: usage.reasoningTokens,
      cached_tokens: usage.cacheHitTokens ?? usage.cachedTokens, cache_write_tokens: usage.cacheWriteTokens,
      cache_miss_tokens: usage.cacheMissTokens, total_tokens: usage.totalTokens, turns: usage.turns }
  }
  for (const metric of metrics.values()) {
    if (metric.phase !== 'triage') continue
    triageMetrics++
    const usage = numericUsage(metric.usage)
    if (!usage) continue
    knownUsage++
    for (const key of TOKEN_KEYS) if (Number.isFinite(usage[key])) totals[key] += usage[key]
  }
  const responses = [...metrics.values()].filter((metric) => metric.phase === 'response')
  return { recordedMetrics: metrics.size, triageMetrics, triageUsage: knownUsage ? totals : null,
    triageUsageKnownCalls: knownUsage, triageUsageMissingCalls: triageMetrics - knownUsage,
    // Each hold is a stale draft intercepted mid-turn; holds on runs that did not end stale avoided a rerun.
    holds: responses.reduce((total, metric) => total + (Number.isFinite(metric.holds) ? metric.holds : 0), 0),
    avoidedReruns: responses.reduce((total, metric) => total +
      (metric.outcome !== 'stale' && Number.isFinite(metric.holds) ? metric.holds : 0), 0),
    responseOutcomes: responses.reduce((counts, metric) => {
      const outcome = ['published', 'duplicate', 'stale', 'stopped', 'budget_exhausted'].includes(metric.outcome) ? metric.outcome : 'other'
      counts[outcome] = (counts[outcome] ?? 0) + 1
      return counts
    }, {}) }
}

function messageEvidence(message, receivedAt) {
  const normalized = message.body.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return { id: message.id, authorMemberId: message.authorMemberId, bodyRevision: message.bodyRevision,
    bodySha256: createHash('sha256').update(normalized).digest('hex'), characters: message.body.length,
    observedAt: receivedAt, rootRequestId: message.rootRequestId, sourceRequestId: message.sourceRequestId,
    mentions: message.mentionMemberIds, correctionSignals: { mentions30: /\b30\b/.test(message.body),
      mentions60: /\b60\b/.test(message.body), mentions70Percent: /70\s*%|0\.7\b/.test(message.body) } }
}

export async function runCase(api, options, runId, mode, binding, signal) {
  const startedAt = Date.now(), state = { mode, roomId: '', requestIds: [], memberPrefix: `${runId}-${mode}`, rootRequestId: '' }
  const report = { mode, status: 'running', finalLimit: RESPONSE_LIMIT, correctionSent: false, messages: [], stopConfirmed: false }
  const observed = new Map(), seenGenerations = new Map()
  let correctionTime, failure, stopReason = 'natural_idle'
  try {
    const result = await api('/v1/rooms', 'POST', { clientRequestId: id(), name: `${runId}-${mode}`,
      description: 'Isolated synthetic, read-only peer/coordinator evaluation. No repositories authorized.',
      collaborationMode: mode, repositories: [], defaultMemberId: 'coordinator', members: members(runId, mode, binding) })
    state.roomId = result.room.id
    report.roomId = state.roomId
    if (result.room.repositories.length || result.room.collaborationMode !== mode) throw new Error('room_isolation_contract_mismatch')
    const send = async (body) => {
      const sent = await api(roomPath(state.roomId) + '/messages', 'POST', { clientRequestId: id(), body,
        executionIntent: 'discussion', ...(state.rootRequestId ? { rootRequestId: state.rootRequestId } : {}) })
      state.requestIds.push(sent.requestId)
      state.rootRequestId ||= sent.message.rootRequestId ?? sent.requestId
    }
    await send(FIRST_PROMPT)
    while (Date.now() - startedAt < options.timeoutMs) {
      if (signal?.aborted) { stopReason = 'interrupted'; throw new Error('evaluation_interrupted') }
      const [page, requests, topics, taskPage] = await Promise.all([
        api(roomPath(state.roomId) + '/messages?limit=200'), requestStates(api, state), topicStates(api, state), api(roomPath(state.roomId) + '/tasks?limit=200')
      ])
      if (taskPage.tasks.length || taskPage.nextCursor) throw new Error('discussion_created_execution_tasks')
      const now = Date.now()
      for (const message of finalMessages(page.messages, requests, mode)) if (!observed.has(message.id)) observed.set(message.id, messageEvidence(message, now))
      for (const topic of topics) seenGenerations.set(topic.rootRequestId + ':' + topic.generation, {
        generation: topic.generation, responseCount: topic.responseCount, triageCount: topic.triageCount,
        publicationRevision: topic.publicationRevision, status: topic.status })
      report.messages = [...observed.values()]
      if (observed.size >= RESPONSE_LIMIT) { stopReason = 'six_final_responses'; break }
      if (requests.some((request) => ['failed', 'needs_input', 'recovery_required'].includes(request.status)) ||
        topics.some((topic) => topic.status === 'paused' || topic.members.some((member) => member.state === 'recovery_required'))) throw new Error('discussion_requires_attention')
      const idle = mode === 'peer' ? topics.length > 0 && topics.every((topic) => topic.status === 'idle' && !topic.pendingCount) : requests.every((request) => request.status === 'completed')
      if (!report.correctionSent && (observed.size >= 2 || idle && observed.size > 0)) {
        await send(CORRECTION)
        report.correctionSent = true
        correctionTime = Date.now()
      } else if (report.correctionSent && idle) break
      await delay(150)
    }
    if (Date.now() - startedAt >= options.timeoutMs) { stopReason = 'timeout'; throw new Error('evaluation_timed_out') }
  } catch (error) { failure = safeFailure(error) }
  finally {
    if (state.roomId) {
      try {
        await stopOwnedDiscussion(api, state)
        report.stopConfirmed = await waitStopped(api, state)
        const [page, requests, tasks] = await Promise.all([
          api(roomPath(state.roomId) + '/messages?limit=200'), requestStates(api, state), api(roomPath(state.roomId) + '/tasks?limit=200')
        ])
        for (const message of finalMessages(page.messages, requests, mode)) if (!observed.has(message.id)) observed.set(message.id, messageEvidence(message, Date.now()))
        report.messages = [...observed.values()]
        report.taskCount = tasks.tasks.length
        report.taskCountComplete = !tasks.nextCursor
        try { report.usage = await collectUsage(api, state) } catch (error) { report.usage = null; report.usageError = safeFailure(error) }
        try { report.peerMetrics = await collectPeerMetrics(api, state) } catch (error) { report.peerMetrics = null; report.metricsError = safeFailure(error) }
        if (report.stopConfirmed && report.taskCount === 0) {
          const current = (await api(roomPath(state.roomId))).room
          await api(roomPath(state.roomId), 'PATCH', { clientRequestId: id(), expectedRevision: current.revision, archived: true })
          report.archived = true
        }
      } catch (error) { report.cleanupError = safeFailure(error) }
    }
  }
  const hashes = new Set(report.messages.map((message) => message.bodySha256))
  report.finalCount = report.messages.length
  report.limitOvershoot = Math.max(0, report.finalCount - RESPONSE_LIMIT)
  report.exactDuplicates = report.finalCount - hashes.size
  report.firstFinalLatencyMs = report.messages[0] ? report.messages[0].observedAt - startedAt : null
  report.postCorrectionFinalCount = correctionTime ? report.messages.filter((message) => message.sourceRequestId === state.requestIds.at(-1) && message.observedAt >= correctionTime).length : 0
  report.elapsedMs = Date.now() - startedAt
  report.stopReason = stopReason
  report.topicGenerations = [...seenGenerations.values()]
  report.error = failure
  report.status = !failure && !report.cleanupError && report.stopConfirmed && report.taskCount === 0 && report.taskCountComplete &&
    report.finalCount > 0 && !report.limitOvershoot && report.correctionSent && report.postCorrectionFinalCount > 0 ? 'passed' : 'failed'
  return report
}

export async function main(args = process.argv.slice(2)) {
  const options = evalOptions(args), api = runtimeApi(options)
  let check
  try { check = await checkRuntime(api) }
  catch (error) { console.log(JSON.stringify({ ready: false, modelCalls: 0, error: safeFailure(error) })); return 2 }
  if (!options.run || !check.ready) {
    console.log(JSON.stringify({ ready: check.ready, modelCalls: 0, runtime: check.metadata,
      next: check.ready ? 'Use --run to create two isolated evaluation rooms with the existing model configuration.' : 'Start an authenticated Kun Runtime with configured native API models and the three built-in presets.' }))
    return check.ready ? 0 : 2
  }
  const controller = new AbortController(), abort = () => controller.abort()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  const runId = 'peer-eval-' + Date.now(), cases = []
  try {
    await mkdir(options.evidence, { recursive: true })
    for (const mode of ['autonomous', 'peer']) {
      if (controller.signal.aborted) break
      console.log(JSON.stringify({ phase: 'running', mode, finalLimit: RESPONSE_LIMIT }))
      const result = await runCase(api, options, runId, mode, check.binding, controller.signal)
      cases.push(result)
      await writeFile(join(options.evidence, 'report.json'), JSON.stringify({ schemaVersion: 1, runtime: check.metadata,
        synthetic: true, modelSource: 'existing_runtime_configuration', productionBudgetsUnmodified: { responses: 32, memberResponses: 8, triages: 128 },
        caveats: ['The external stop observer can race concurrent publication; any count above six fails the case.',
          'Raw prompts, model replies, provider credentials and Runtime tokens are not saved.',
          'Response/coordination thread usage and direct participation metrics are reported separately; missing usage is null.',
          'This single sample runs coordinator first; cache warmth and other runtime activity can affect latency and cost.',
          'Exact repetition and numeric correction signals are diagnostics, not semantic quality scores.'], cases }, null, 2) + '\n')
      console.log(JSON.stringify({ phase: 'finished', mode, status: result.status, finalCount: result.finalCount, stopConfirmed: result.stopConfirmed }))
      if (!result.stopConfirmed) break
    }
    console.log(JSON.stringify({ ok: cases.length === 2 && cases.every((value) => value.status === 'passed'), evidence: join(options.evidence, 'report.json') }))
    return cases.length === 2 && cases.every((value) => value.status === 'passed') ? 0 : 1
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }, (error) => { console.error(JSON.stringify({ error: safeFailure(error) })); process.exitCode = 1 })
}
