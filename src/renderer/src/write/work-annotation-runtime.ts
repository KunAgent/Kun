import i18n from '../i18n'
import type { WorkAnnotation, WorkAnnotationMessage, WorkAnnotationSuggestion } from '@shared/work-annotations'
import { PAPER_CONTEXT_MAX_CHARS } from '@shared/paper/paper-turn-context'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import { rendererRuntimeClient as runtime } from '../agent/runtime-client'
import { sharedDefaultModelSelection } from '../agent/kun-runtime-shared-default'

type Route = NonNullable<NonNullable<WorkAnnotationMessage['request']>['route']>
type Turn = { id: string; status: string; error?: string; clientRequestId?: string; items?: { kind: string; text?: string }[] }
export class AnnotationTurnFailed extends Error {}

async function readJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await runtime.runtimeRequest(path, body === undefined ? 'GET' : 'POST', body === undefined ? undefined : JSON.stringify(body))
  if (!response.ok) {
    let message: unknown
    try { message = JSON.parse(response.body).message } catch { /* Non-JSON transport error. */ }
    throw new Error(typeof message === 'string' ? message : `Kun request failed (HTTP ${response.status}).`)
  }
  return JSON.parse(response.body) as T
}

export async function annotationRoute(): Promise<Route> {
  const { providerId, model, accountId } = await sharedDefaultModelSelection()
  if (!providerId || !model) throw new Error(i18n.t('common:writeAnnotationNeedModel'))
  return { providerId, model, ...(accountId ? { accountId } : {}) }
}

export async function createAnnotationThread(record: WorkAnnotation, route: Route): Promise<string> {
  const thread = await readJson<{ id: string }>('/v1/threads', {
    workspace: record.workspaceRoot, title: record.anchor.quote.slice(0, 90), titleAuto: false,
    purpose: 'work-annotation', agentSurface: 'write', harnessId: 'kun', sandboxMode: 'read-only', ...route
  })
  if (!thread.id) throw new Error('Kun did not return a discussion ID.')
  return thread.id
}

const threadPath = (id: string): string => '/v1/threads/' + encodeURIComponent(id)

export function freezeAnnotationSource(record: WorkAnnotation, message: WorkAnnotationMessage): string {
  const anchor = message.request!.anchor
  const position = record.messages.findIndex((item) => item.id === message.id)
  const history = record.messages.slice(0, position - 1).filter((item) => !item.status).slice(-12)
    .map((item) => ({ role: item.role, text: item.text.slice(0, 1600),
      ...(item.suggestion ? { suggestion: item.suggestion.text.slice(0, 1000) } : {}) }))
  const source = { kind: anchor.kind, quote: anchor.quote, before: anchor.before, after: anchor.after,
    ...(anchor.kind === 'markdown' && anchor.source !== anchor.quote ? { markdown: anchor.source } : {}), history }
  let text = JSON.stringify(source)
  while (text.length > PAPER_CONTEXT_MAX_CHARS && history.length) {
    history.shift()
    text = JSON.stringify(source)
  }
  if (text.length > PAPER_CONTEXT_MAX_CHARS) throw new Error(i18n.t('common:writeAnnotationTooLong'))
  return text
}

export function annotationTurnBody(record: WorkAnnotation, message: WorkAnnotationMessage, route: Route) {
  const request = message.request!
  const position = record.messages.findIndex((item) => item.id === message.id)
  const question = record.messages[position - 1]
  if (!question || question.role !== 'user') throw new Error('The annotation question is missing.')
  return {
    prompt: question.text, clientRequestId: request.id, clientSurface: 'gui', agentSurface: 'write',
    mode: 'agent', orchestration: 'direct', harnessId: 'kun', sandboxMode: 'read-only', ...route,
    paperContext: {
      version: 1, scope: 'work-annotation', privacy: 'model-provider',
      purpose: 'Discuss the selected passage with its author', model: route.model, providerId: route.providerId, maxModelRequests: 1,
      sources: [{ paperId: record.id, title: 'Document selection', text: request.source ?? freezeAnnotationSource(record, message) }]
    }
  }
}

export async function startAnnotationTurn(record: WorkAnnotation, message: WorkAnnotationMessage, route: Route): Promise<string> {
  const response = await readJson<{ turnId: string }>(threadPath(record.threadId!) + '/turns', annotationTurnBody(record, message, route))
  if (!response.turnId) throw new Error('Kun did not return a turn ID.')
  return response.turnId
}

export async function findAnnotationTurn(threadId: string, requestId: string): Promise<string | undefined> {
  const snapshot = await readJson<{ turns: Turn[] }>(threadPath(threadId))
  return snapshot.turns.find((turn) => turn.clientRequestId === requestId)?.id
}

function answerIn(turn: Turn): string {
  return turn.items?.filter((item) => item.kind === 'assistant_text').map((item) => item.text ?? '').join('\n').trim() ?? ''
}

/** A terminal SSE event wakes the durable turn read. A bounded fallback covers reconnects and missed frames. */
export async function readAnnotationAnswer(threadId: string, turnId: string): Promise<string> {
  const path = threadPath(threadId)
  const streamId = crypto.randomUUID()
  let wake: (() => void) | undefined
  let terminalSeen = false
  const off = runtime.onSseEvent((batch) => {
    if (batch.streamId !== streamId) return
    if (batch.events.some((entry) => {
      const event = entry as { threadId?: string; turnId?: string; kind?: string }
      return event.threadId === threadId && event.turnId === turnId &&
        ['turn_completed', 'turn_failed', 'turn_aborted'].includes(event.kind ?? '')
    })) { terminalSeen = true; wake?.() }
  })
  let start: Promise<unknown> | undefined
  try {
    const state = await readJson<{ latestSeq: number }>(path + '/state')
    start = runtime.startSse(threadId, state.latestSeq, streamId).catch(() => undefined)
    const deadline = Date.now() + 10 * 60_000
    for (;;) {
      const turn = await readJson<Turn>(path + '/turns/' + encodeURIComponent(turnId))
      if (turn.id !== turnId) throw new Error('Kun returned another turn.')
      if (turn.status === 'failed' || turn.status === 'aborted') throw new AnnotationTurnFailed(turn.error || i18n.t('common:writeAnnotationTurnStopped'))
      if (turn.status === 'completed') {
        const result = answerIn(turn)
        if (result) return result
        const snapshot = await readJson<{ turns: Turn[] }>(path + '/timeline?turnId=' + encodeURIComponent(turnId) + '&limit=16')
        const recovered = snapshot.turns.find((item) => item.id === turnId)
        if (recovered && answerIn(recovered)) return answerIn(recovered)
        throw new AnnotationTurnFailed(i18n.t('common:writeAnnotationEmptyReply'))
      }
      if (Date.now() >= deadline) throw new Error(i18n.t('common:writeAnnotationSlow'))
      if (terminalSeen) { terminalSeen = false; continue }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8000)
        wake = () => { clearTimeout(timer); resolve() }
      })
      wake = undefined
    }
  } finally {
    off()
    if (start) void start.then(() => runtime.stopSse(streamId)).catch(() => undefined)
  }
}

export function parseAnnotationAnswer(raw: string, anchor: WorkAnnotationAnchor): { text: string; suggestion?: WorkAnnotationSuggestion } {
  const trimmed = raw.trim()
  const json = trimmed.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')
  try {
    const value = JSON.parse(json)
    if (typeof value?.text === 'string' && value.text.trim()) {
      const suggestion = value.suggestion
      if ((suggestion?.kind === 'replace' || suggestion?.kind === 'insertAfter') &&
          typeof suggestion.text === 'string' && suggestion.text.trim() && suggestion.text.length <= 32_000) {
        return { text: value.text.trim(), suggestion: { kind: suggestion.kind, text: suggestion.text, anchor } }
      }
      return { text: value.text.trim() }
    }
  } catch { /* Providers may return ordinary prose. Keep it readable. */ }
  return { text: trimmed }
}
