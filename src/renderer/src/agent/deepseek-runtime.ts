import type {
  AgentProvider,
  AgentProviderId,
  ChatBlock,
  NormalizedThread,
  ThreadDeltaEvent,
  ThreadEventSink,
  ToolBlock,
  ToolItemKind,
  UserMessageEventPayload,
  UserInputAnswer,
  UserInputQuestion
} from './types'
import type { AppSettingsV1 } from '@shared/app-settings'
import { unwrapClawRuntimePromptForDisplay, unwrapClawUserPromptForDisplay } from '@shared/app-settings'
import { extractDiffFilePath } from '../lib/diff-stats'

type ThreadRecordJson = {
  id: string
  created_at: string
  updated_at: string
  model: string
  workspace: string
  mode: string
  status?: string
  archived?: boolean
  title?: string | null
}

type TurnItemJson = {
  id: string
  turn_id?: string
  kind: string
  summary: string
  detail?: string | null
  status?: string
  metadata?: Record<string, unknown> | null
  artifact_refs?: string[]
  started_at?: string | null
  ended_at?: string | null
}

type TurnRecordJson = {
  id: string
  thread_id?: string
  status?: string
  item_ids?: string[]
  created_at?: string | null
  started_at?: string | null
  ended_at?: string | null
}

type ThreadDetailJson = {
  thread: ThreadRecordJson
  turns?: TurnRecordJson[]
  items: TurnItemJson[]
  latest_seq: number
}

type StartTurnResponseJson = {
  thread: ThreadRecordJson
  turn: { id: string; item_ids?: string[] }
}

type RuntimeErrorJson = {
  error?: string | { message?: string; status?: number }
  message?: string
}

type RuntimeExecutionFlags = {
  auto_approve: boolean
  trust_mode: boolean
}

const TOOL_ITEM_KINDS = new Set(['tool_call', 'command_execution', 'file_change'])
const REQUEST_USER_INPUT_TOOL = 'request_user_input'

function titleFromThread(t: ThreadRecordJson): string {
  const raw = t.title?.trim()
  if (raw) return raw
  return t.id.slice(0, 8)
}

function toToolKind(kind: string): ToolItemKind | undefined {
  if (kind === 'tool_call' || kind === 'command_execution' || kind === 'file_change') {
    return kind
  }
  return undefined
}

function statusFromString(s: string | undefined): 'running' | 'success' | 'error' {
  if (s === 'failed' || s === 'canceled' || s === 'interrupted' || s === 'error') return 'error'
  if (s === 'in_progress' || s === 'queued' || s === 'started') return 'running'
  return 'success'
}

function displayModelFromUserMessageMeta(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata) return undefined
  const requested = typeof metadata.requested_model === 'string' ? metadata.requested_model.trim() : ''
  const effective = typeof metadata.effective_model === 'string' ? metadata.effective_model.trim() : ''
  const autoModel = metadata.auto_model === true
  if (!requested && !effective) return undefined
  const reqLower = requested.toLowerCase()
  if (autoModel && reqLower === 'auto') {
    if (effective && effective.toLowerCase() !== 'auto') {
      return `auto → ${effective}`
    }
    return 'auto'
  }
  if (requested && effective && requested !== effective) {
    return `${requested} → ${effective}`
  }
  return effective || requested || undefined
}

function deriveFilePath(item: TurnItemJson): string | undefined {
  const meta = (item.metadata ?? undefined) as Record<string, unknown> | undefined
  if (meta) {
    for (const k of ['path', 'file_path', 'filename', 'target']) {
      const v = meta[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  if (Array.isArray(item.artifact_refs) && item.artifact_refs.length > 0) {
    const first = item.artifact_refs[0]
    if (typeof first === 'string' && first.trim()) return first.trim()
  }
  return extractDiffFilePath(item.detail ?? item.summary)
}

function deriveTurnId(item: TurnItemJson): string | undefined {
  if (typeof item.turn_id === 'string' && item.turn_id.trim()) return item.turn_id.trim()
  const meta = (item.metadata ?? undefined) as Record<string, unknown> | undefined
  const raw = meta?.turn_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function readPayloadItem(payload: Record<string, unknown>): TurnItemJson | null {
  const it = payload.item as Record<string, unknown> | undefined
  if (!it || typeof it.id !== 'string') return null
  return {
    id: it.id,
    turn_id: typeof it.turn_id === 'string' ? it.turn_id : undefined,
    kind: String(it.kind ?? ''),
    summary: typeof it.summary === 'string' ? it.summary : '',
    detail: typeof it.detail === 'string' ? it.detail : null,
    status: typeof it.status === 'string' ? it.status : undefined,
    metadata: (it.metadata ?? null) as Record<string, unknown> | null,
    artifact_refs: Array.isArray(it.artifact_refs)
      ? (it.artifact_refs.filter((s) => typeof s === 'string') as string[])
      : [],
    started_at: typeof it.started_at === 'string' ? it.started_at : null,
    ended_at: typeof it.ended_at === 'string' ? it.ended_at : null
  }
}

function readPayloadTool(payload: Record<string, unknown>): {
  id?: string
  name?: string
  input?: unknown
} | null {
  const tool = payload.tool as Record<string, unknown> | undefined
  if (!tool || typeof tool !== 'object') return null
  return {
    id: typeof tool.id === 'string' && tool.id.trim() ? tool.id.trim() : undefined,
    name: typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim() : undefined,
    input: tool.input
  }
}

function readUserInputQuestions(value: unknown): UserInputQuestion[] | null {
  if (!value || typeof value !== 'object') return null
  const rawQuestions = (value as Record<string, unknown>).questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null
  const questions: UserInputQuestion[] = []
  for (const rawQuestion of rawQuestions) {
    if (!rawQuestion || typeof rawQuestion !== 'object') return null
    const q = rawQuestion as Record<string, unknown>
    const rawOptions = q.options
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null
    const options = rawOptions
      .map((rawOption): { label: string; description: string } | null => {
        if (!rawOption || typeof rawOption !== 'object') return null
        const opt = rawOption as Record<string, unknown>
        const label = typeof opt.label === 'string' ? opt.label.trim() : ''
        const description = typeof opt.description === 'string' ? opt.description.trim() : ''
        if (!label || !description) return null
        return { label, description }
      })
      .filter((opt): opt is { label: string; description: string } => opt != null)
    const header = typeof q.header === 'string' ? q.header.trim() : ''
    const id = typeof q.id === 'string' ? q.id.trim() : ''
    const question = typeof q.question === 'string' ? q.question.trim() : ''
    if (!header || !id || !question || options.length === 0) return null
    questions.push({ header, id, question, options })
  }
  return questions
}

function readUserInputAnswersFromItem(item: TurnItemJson): UserInputAnswer[] | undefined {
  const detail = typeof item.detail === 'string' ? item.detail.trim() : ''
  if (!detail) return undefined
  try {
    const parsed = JSON.parse(detail) as unknown
    const rawAnswers =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).answers
        : undefined
    if (!Array.isArray(rawAnswers)) return undefined
    const answers = rawAnswers
      .map((rawAnswer): UserInputAnswer | null => {
        if (!rawAnswer || typeof rawAnswer !== 'object') return null
        const answer = rawAnswer as Record<string, unknown>
        const id = typeof answer.id === 'string' ? answer.id.trim() : ''
        const label = typeof answer.label === 'string' ? answer.label.trim() : ''
        const value = typeof answer.value === 'string' ? answer.value.trim() : ''
        if (!id || !label) return null
        return { id, label, value }
      })
      .filter((answer): answer is UserInputAnswer => answer != null)
    return answers.length ? answers : undefined
  } catch {
    return undefined
  }
}

function readUserInputQuestionsFromItem(item: TurnItemJson): UserInputQuestion[] | null {
  const detail = typeof item.detail === 'string' ? item.detail.trim() : ''
  if (!detail) return null
  try {
    return readUserInputQuestions(JSON.parse(detail))
  } catch {
    return null
  }
}

function looksLikeUserInputToolItem(item: TurnItemJson): boolean {
  const summary = item.summary.toLowerCase()
  if (summary.includes(REQUEST_USER_INPUT_TOOL)) return true
  return readUserInputAnswersFromItem(item) != null
}

function toolSummaryFromStartedPayload(payload: Record<string, unknown>, fallback: string): string {
  const tool = readPayloadTool(payload)
  if (tool?.name) {
    return tool.name
  }
  const it = readPayloadItem(payload)
  if (it?.summary) return it.summary
  return fallback
}

function readRuntimeError(body: string, fallback: string): RuntimeErrorJson & { message: string } {
  if (!body) return { message: fallback }
  try {
    const parsed = JSON.parse(body) as RuntimeErrorJson
    const nestedError =
      parsed.error && typeof parsed.error === 'object' ? parsed.error.message?.trim() ?? '' : ''
    const topLevelError =
      typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : ''
    const message =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : topLevelError
          ? topLevelError
          : nestedError
            ? nestedError
            : fallback
    return {
      ...(topLevelError ? { error: topLevelError } : {}),
      message
    }
  } catch {
    /* use raw body */
  }
  return { message: body.trim() || fallback }
}

function toRuntimeError(info: RuntimeErrorJson & { message: string }): Error {
  return new Error(
    info.error
      ? JSON.stringify({ error: info.error, message: info.message })
      : info.message
  )
}

function runtimeExecutionFlags(settings: AppSettingsV1): RuntimeExecutionFlags {
  return {
    auto_approve: settings.deepseek.approvalPolicy === 'auto',
    trust_mode: settings.deepseek.sandboxMode === 'danger-full-access'
  }
}

function shouldAutoDenyApprovals(settings: AppSettingsV1): boolean {
  return settings.deepseek.approvalPolicy === 'never'
}

function toolBlockFromItem(item: TurnItemJson): ToolBlock {
  const status = statusFromString(item.status)
  const detail = typeof item.detail === 'string' && item.detail.trim() ? item.detail : undefined
  const meta = (item.metadata ?? undefined) as Record<string, unknown> | undefined
  return {
    kind: 'tool',
    id: item.id,
    createdAt: item.started_at ?? item.ended_at ?? undefined,
    summary: item.summary || item.kind,
    status,
    toolKind: toToolKind(item.kind),
    detail,
    filePath: deriveFilePath(item),
    meta
  }
}

function itemCreatedAt(item: TurnItemJson): string | undefined {
  return item.started_at ?? item.ended_at ?? undefined
}

function userMessageEventFromItem(item: TurnItemJson): UserMessageEventPayload | null {
  if (item.kind !== 'user_message') return null
  const meta =
    item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : undefined
  const modelLabel = displayModelFromUserMessageMeta(meta)
  const rawText = item.detail ?? item.summary
  const text = unwrapClawUserPromptForDisplay(rawText)
  return {
    itemId: item.id,
    turnId: deriveTurnId(item),
    createdAt: itemCreatedAt(item),
    text,
    ...(modelLabel ? { modelLabel } : {})
  }
}

function createSseStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export class DeepseekRuntimeProvider implements AgentProvider {
  readonly id: AgentProviderId = 'deepseek-runtime'
  readonly displayName = 'DeepSeek TUI'

  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
  } {
    return { interrupt: true, stream: true, approvals: true, attachFiles: false }
  }

  async connect(): Promise<void> {
    const r = await window.dsGui.runtimeRequest('/health', 'GET')
    if (!r.ok) {
      throw toRuntimeError(readRuntimeError(r.body, `runtime unhealthy (${r.status || 'offline'})`))
    }

    const authProbe = await window.dsGui.runtimeRequest('/v1/threads?limit=1', 'GET')
    if (!authProbe.ok) {
      const info = readRuntimeError(authProbe.body, `failed to list threads (${authProbe.status || 0})`)
      if (authProbe.status === 401 && /bearer token required/i.test(info.message)) {
        throw toRuntimeError({
          error: 'runtime_auth_required',
          message: 'The local runtime requires a bearer token for thread APIs.'
        })
      }
      throw toRuntimeError(info)
    }
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny',
    remember = false
  ): Promise<void> {
    const r = await window.dsGui.runtimeRequest(
      `/v1/approvals/${encodeURIComponent(approvalId)}`,
      'POST',
      JSON.stringify({ decision, remember })
    )
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, `approval decision failed: ${r.status}`))
  }

  async listThreads(): Promise<NormalizedThread[]> {
    const r = await window.dsGui.runtimeRequest('/v1/threads?limit=50', 'GET')
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to list threads'))
    const rows = JSON.parse(r.body) as ThreadRecordJson[]
    return rows
      .filter((t) => t.archived !== true)
      .map((t) => ({
        id: t.id,
        title: titleFromThread(t),
        updatedAt: t.updated_at,
        model: t.model,
        mode: t.mode,
        workspace: t.workspace,
        status: t.status
      }))
  }

  async createThread(input: {
    workspace?: string
    title?: string
    mode?: string
  }): Promise<NormalizedThread> {
    const settings = await window.dsGui.getSettings()
    const flags = runtimeExecutionFlags(settings)
    const body = JSON.stringify({
      workspace: input.workspace,
      mode: input.mode ?? 'agent',
      ...flags
    })
    const r = await window.dsGui.runtimeRequest('/v1/threads', 'POST', body)
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to create thread'))
    const t = JSON.parse(r.body) as ThreadRecordJson
    if (input.title) {
      await window.dsGui.runtimeRequest(
        `/v1/threads/${encodeURIComponent(t.id)}`,
        'PATCH',
        JSON.stringify({ title: input.title })
      )
    }
    return {
      id: t.id,
      title: input.title || titleFromThread(t),
      updatedAt: t.updated_at,
      model: t.model,
      mode: t.mode,
      workspace: t.workspace,
      status: t.status
    }
  }

  async getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
  }> {
    const r = await window.dsGui.runtimeRequest(`/v1/threads/${encodeURIComponent(threadId)}`, 'GET')
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to load thread'))
    const detail = JSON.parse(r.body) as ThreadDetailJson
    const blocks: ChatBlock[] = []
    const latestTurn = Array.isArray(detail.turns) ? detail.turns.at(-1) : undefined
    let latestTurnId: string | undefined = latestTurn?.id
    const latestTurnStatus = latestTurn?.status
    let latestUserMessageId: string | undefined
    for (const it of detail.items) {
      latestTurnId = deriveTurnId(it) ?? latestTurnId
      if (it.kind === 'user_message') {
        latestUserMessageId = it.id
        const meta =
          it.metadata && typeof it.metadata === 'object'
            ? (it.metadata as Record<string, unknown>)
            : undefined
        const modelLabel = displayModelFromUserMessageMeta(meta)
        const rawText = it.detail ?? it.summary
        blocks.push({
          kind: 'user',
          id: it.id,
          createdAt: itemCreatedAt(it),
          text: unwrapClawUserPromptForDisplay(rawText),
          ...(modelLabel ? { modelLabel } : {})
        })
      } else if (it.kind === 'agent_message') {
        const text = it.detail ?? it.summary
        if (text.trim()) blocks.push({ kind: 'assistant', id: it.id, createdAt: itemCreatedAt(it), text })
      } else if (it.kind === 'agent_reasoning') {
        const text = it.detail ?? it.summary
        if (text.trim()) blocks.push({ kind: 'reasoning', id: it.id, createdAt: itemCreatedAt(it), text })
      } else if (it.kind === 'tool_call' && looksLikeUserInputToolItem(it)) {
        const questions = readUserInputQuestionsFromItem(it)
        if (questions) {
          const status =
            statusFromString(it.status) === 'error'
              ? 'error'
              : statusFromString(it.status) === 'running'
                ? 'pending'
                : 'submitted'
          blocks.push({
            kind: 'user_input',
            id: it.id,
            createdAt: itemCreatedAt(it),
            requestId: it.id,
            questions,
            status,
            answers: readUserInputAnswersFromItem(it),
            ...(status === 'error' ? { errorMessage: it.detail ?? it.summary } : {})
          })
        } else {
          blocks.push(toolBlockFromItem(it))
        }
      } else if (TOOL_ITEM_KINDS.has(it.kind)) {
        blocks.push(toolBlockFromItem(it))
      } else if (it.kind === 'error') {
        blocks.push({ kind: 'system', id: it.id, createdAt: itemCreatedAt(it), text: `⚠ ${it.detail ?? it.summary}` })
      } else if (it.kind === 'status' || it.kind === 'context_compaction') {
        const text = it.summary || it.kind
        blocks.push({ kind: 'system', id: it.id, createdAt: itemCreatedAt(it), text })
      }
    }
    return {
      blocks,
      latestSeq: detail.latest_seq ?? 0,
      threadStatus: detail.thread.status ?? latestTurnStatus,
      latestTurnId,
      latestUserMessageId
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options?: { mode?: string; model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const settings = await window.dsGui.getSettings()
    const flags = runtimeExecutionFlags(settings)
    const r = await window.dsGui.runtimeRequest(
      `/v1/threads/${encodeURIComponent(threadId)}/turns`,
      'POST',
      JSON.stringify({
        prompt: text,
        mode: options?.mode,
        model: options?.model,
        ...flags
      })
    )
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to start turn'))
    const body = JSON.parse(r.body) as StartTurnResponseJson
    // The runtime returns the newly-allocated turn's `item_ids`; the first
    // element is the user_message item we just created. Caller can persist
    // per-turn metadata (e.g. composer model selection) against this stable id.
    const userItemId =
      Array.isArray(body.turn.item_ids) && typeof body.turn.item_ids[0] === 'string'
        ? body.turn.item_ids[0]
        : undefined
    return { turnId: body.turn.id, threadId: body.thread.id, userMessageItemId: userItemId }
  }

  async steerUserMessage(threadId: string, turnId: string, text: string): Promise<void> {
    const r = await window.dsGui.runtimeRequest(
      `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/steer`,
      'POST',
      JSON.stringify({ prompt: text })
    )
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to queue message'))
  }

  async submitUserInputResponse(requestId: string, answers: UserInputAnswer[]): Promise<void> {
    const body = JSON.stringify({ answers })
    const paths = [
      `/v1/user-inputs/${encodeURIComponent(requestId)}`,
      `/v1/user-input/${encodeURIComponent(requestId)}`
    ]
    let last: RuntimeErrorJson & { message: string } | null = null
    for (const path of paths) {
      const r = await window.dsGui.runtimeRequest(path, 'POST', body)
      if (r.ok) return
      last = readRuntimeError(r.body, `request_user_input response failed: ${r.status}`)
      if (r.status !== 404 && r.status !== 405) break
    }
    throw toRuntimeError(
      last ?? {
        error: 'runtime_request_user_input_unsupported',
        message: 'The runtime does not expose request_user_input responses over HTTP yet.'
      }
    )
  }

  async cancelUserInput(requestId: string): Promise<void> {
    const paths = [
      `/v1/user-inputs/${encodeURIComponent(requestId)}`,
      `/v1/user-input/${encodeURIComponent(requestId)}`
    ]
    let last: RuntimeErrorJson & { message: string } | null = null
    for (const path of paths) {
      const r = await window.dsGui.runtimeRequest(path, 'POST', JSON.stringify({ cancelled: true }))
      if (r.ok) return
      last = readRuntimeError(r.body, `request_user_input cancel failed: ${r.status}`)
      if (r.status !== 404 && r.status !== 405) break
    }
    throw toRuntimeError(
      last ?? {
        error: 'runtime_request_user_input_unsupported',
        message: 'The runtime does not expose request_user_input cancellation over HTTP yet.'
      }
    )
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    const r = await window.dsGui.runtimeRequest(
      `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      'POST'
    )
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'failed to interrupt turn'))
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const r = await window.dsGui.runtimeRequest(
      `/v1/threads/${encodeURIComponent(threadId)}`,
      'PATCH',
      JSON.stringify({ title })
    )
    if (!r.ok) throw toRuntimeError(readRuntimeError(r.body, 'rename thread failed'))
  }

  async deleteThread(threadId: string): Promise<void> {
    const encoded = encodeURIComponent(threadId)
    const attempts: Array<{ path: string; method: string; body?: string; stopOnFailure?: boolean }> = [
      // Newer runtimes expose archive semantics via PATCH instead of DELETE.
      { path: `/v1/threads/${encoded}`, method: 'PATCH', body: JSON.stringify({ archived: true }) },
      { path: `/v1/threads/${encoded}`, method: 'DELETE' },
      { path: `/v1/threads/${encoded}/delete`, method: 'POST' },
      { path: `/v1/threads/${encoded}`, method: 'POST', body: JSON.stringify({ deleted: true }) },
      // Last fallback for some compatibility layers.
      { path: `/v1/threads/${encoded}`, method: 'PATCH', body: JSON.stringify({ deleted: true }) }
    ]
    let last: RuntimeErrorJson & { message: string } | null = null

    for (const attempt of attempts) {
      const r = await window.dsGui.runtimeRequest(attempt.path, attempt.method, attempt.body)
      if (r.ok) return
      last = readRuntimeError(r.body, `delete thread failed: ${r.status}`)
      // Retry alternate compatibility paths only for "not found"/"method not allowed".
      if (r.status !== 404 && r.status !== 405) break
    }

    throw toRuntimeError(last ?? { message: 'delete thread failed' })
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        if (signal.aborted) {
          resolve()
          return
        }
        const timer = window.setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = (): void => {
          window.clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })

    const isFatalSseStatus = (status: number | undefined): boolean =>
      typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429

    let nextSinceSeq = sinceSeq
    let reconnectDelayMs = 750

    while (!signal.aborted) {
      const streamId = createSseStreamId()
      try {
        const outcome = await new Promise<{ type: 'end' } | { type: 'error'; error: Error; status?: number }>(
          async (resolve) => {
            let settled = false
            let deltaFlushFrame = 0
            let pendingDeltas: ThreadDeltaEvent[] = []

            const flushPendingDeltas = (): void => {
              if (deltaFlushFrame) {
                window.cancelAnimationFrame(deltaFlushFrame)
                deltaFlushFrame = 0
              }
              if (pendingDeltas.length === 0) return
              const batch = pendingDeltas
              pendingDeltas = []
              sink.onDeltas(batch)
            }

            const scheduleDeltaFlush = (): void => {
              if (deltaFlushFrame) return
              deltaFlushFrame = window.requestAnimationFrame(() => {
                deltaFlushFrame = 0
                flushPendingDeltas()
              })
            }

            const cleanup = (): void => {
              offData()
              offEnd()
              offErr()
              if (deltaFlushFrame) {
                window.cancelAnimationFrame(deltaFlushFrame)
                deltaFlushFrame = 0
              }
              pendingDeltas = []
              signal.removeEventListener('abort', onAbort)
            }

            const finish = (result: { type: 'end' } | { type: 'error'; error: Error; status?: number }): void => {
              if (settled) return
              settled = true
              flushPendingDeltas()
              cleanup()
              resolve(result)
            }

            const offData = window.dsGui.onSseEvent(({ streamId: sid, data }) => {
              if (sid !== streamId) return
              reconnectDelayMs = 750
              const row = data as {
                seq?: number
                event?: string
                payload?: Record<string, unknown>
              }
              const eventSeq = typeof row.seq === 'number' ? row.seq : undefined
              if (eventSeq !== undefined) {
                nextSinceSeq = Math.max(nextSinceSeq, eventSeq)
              }
              if (typeof row.seq === 'number') {
                if (row.event !== 'item.delta') {
                  sink.onSeq(row.seq)
                }
              }
              const ev = row.event
              const payload = row.payload ?? {}

              if (ev === 'item.delta') {
                const delta = (payload.delta as string) || ''
                const kind = payload.kind as string | undefined
                if ((kind === 'agent_message' || kind === 'agent_reasoning') && delta) {
                  pendingDeltas.push({ text: delta, kind, seq: eventSeq })
                  scheduleDeltaFlush()
                }
                return
              }

              flushPendingDeltas()

              if (ev === 'item.started') {
                const it = readPayloadItem(payload)
                if (it?.kind === 'user_message') {
                  const userMessage = userMessageEventFromItem(it)
                  if (userMessage) sink.onUserMessage(userMessage)
                  return
                }
                if (it && TOOL_ITEM_KINDS.has(it.kind)) {
                  const tool = readPayloadTool(payload)
                  if (tool?.name === REQUEST_USER_INPUT_TOOL) {
                    const questions = readUserInputQuestions(tool.input)
                    if (questions) {
                      sink.onUserInput({
                        itemId: it.id,
                        requestId: tool.id ?? it.id,
                        questions
                      })
                      return
                    }
                  }
                  const label = toolSummaryFromStartedPayload(payload, it.summary || it.kind)
                  sink.onTool({
                    itemId: it.id,
                    summary: label,
                    status: 'running',
                    toolKind: toToolKind(it.kind),
                    filePath: deriveFilePath(it),
                    meta: (it.metadata ?? undefined) as Record<string, unknown> | undefined
                  })
                }
                return
              }

              if (ev === 'item.completed' || ev === 'item.failed') {
                const it = readPayloadItem(payload)
                if (it?.kind === 'user_message') {
                  const userMessage = userMessageEventFromItem(it)
                  if (userMessage) sink.onUserMessage(userMessage)
                  return
                }
                if (it && TOOL_ITEM_KINDS.has(it.kind)) {
                  if (it.kind === 'tool_call' && looksLikeUserInputToolItem(it)) {
                    sink.onUserInputStatus({
                      itemId: it.id,
                      status:
                        ev === 'item.failed' || statusFromString(it.status) === 'error'
                          ? 'error'
                          : 'submitted',
                      answers: readUserInputAnswersFromItem(it),
                      errorMessage:
                        ev === 'item.failed' || statusFromString(it.status) === 'error'
                          ? it.detail ?? it.summary
                          : undefined
                    })
                    return
                  }
                  const status =
                    ev === 'item.failed' || statusFromString(it.status) === 'error'
                      ? 'error'
                      : 'success'
                  sink.onTool({
                    itemId: it.id,
                    summary: it.summary || (status === 'error' ? 'tool failed' : 'tool'),
                    status,
                    toolKind: toToolKind(it.kind),
                    detail:
                      typeof it.detail === 'string' && it.detail.trim() ? it.detail : undefined,
                    filePath: deriveFilePath(it),
                    meta: (it.metadata ?? undefined) as Record<string, unknown> | undefined
                  })
                }
                return
              }

              if (ev === 'turn.completed') {
                sink.onTurnComplete()
                return
              }

              if (ev === 'approval.required') {
                const approvalId = String(payload.approval_id ?? payload.id ?? '')
                if (!approvalId) return
                void window.dsGui
                  .getSettings()
                  .then(async (settings) => {
                    if (runtimeExecutionFlags(settings).auto_approve) {
                      await this.submitApprovalDecision(approvalId, 'allow').catch(() => {
                        /* Runtime may already have auto-approved this request. */
                      })
                      return
                    }
                    if (shouldAutoDenyApprovals(settings)) {
                      await this.submitApprovalDecision(approvalId, 'deny').catch(() => {
                        /* Ignore stale approval ids. */
                      })
                      return
                    }
                    sink.onApproval({
                      approvalId,
                      summary: String(payload.description ?? payload.summary ?? 'Approval required'),
                      toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined
                    })
                  })
                  .catch(() => {
                    sink.onApproval({
                      approvalId,
                      summary: String(payload.description ?? payload.summary ?? 'Approval required'),
                      toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined
                    })
                  })
              }
            })

            const offErr = window.dsGui.onSseError(({ streamId: sid, message, status }) => {
              if (sid !== streamId) return
              finish({
                type: 'error',
                error: new Error(message ?? `sse error ${status ?? ''}`),
                status
              })
            })

            const offEnd = window.dsGui.onSseEnd(({ streamId: sid }) => {
              if (sid !== streamId) return
              finish({ type: 'end' })
            })

            const onAbort = (): void => {
              cleanup()
              void window.dsGui.stopSse(streamId)
              resolve({ type: 'end' })
            }

            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })
            try {
              await window.dsGui.startSse(threadId, nextSinceSeq, streamId)
            } catch (e) {
              finish({
                type: 'error',
                error: e instanceof Error ? e : new Error(String(e))
              })
            }
          }
        )

        if (signal.aborted) return
        if (outcome.type === 'error' && isFatalSseStatus(outcome.status)) {
          sink.onError(outcome.error)
          return
        }
      } catch (e) {
        if (signal.aborted) return
        if (e instanceof Error && /aborted/i.test(e.message)) return
      } finally {
        void window.dsGui.stopSse(streamId)
      }

      await wait(reconnectDelayMs)
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000)
    }
  }
}
