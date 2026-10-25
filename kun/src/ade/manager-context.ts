/**
 * ADE manager per-turn context:
 * a length-bounded dynamic-context block injected after the stable prefix
 * for authorized manager turns on the Kun harness. It carries
 * the delegation contract, live team state, and the harness routing menu —
 * per-turn facts that must never enter the immutable prefix.
 */
import type {
  DispatchRecord,
  QuestionRecord,
  TeamRecord
} from '../contracts/ade.js'
import type { AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import { replacedWorkerIds } from './worker-dispatch-ids.js'

export type AdeManagerContextDeps = {
  teams: { byManager(managerThreadId: string): Promise<TeamRecord | null> }
  dispatches: { list(teamId: string): Promise<DispatchRecord[]> }
  questions: { listOpen(teamId: string): Promise<QuestionRecord[]> }
  /** Same ready-harness routing menu the Graph planner sees. */
  harnessSummary: () => Promise<string | undefined>
  /** New dispatch admission; existing-team guidance remains when disabled. */
  canStartNewWork?: () => boolean
  /**
   * Dispatch cards owned by the manager thread. A card exists before any
   * worker or dispatch row does, so a countdown, a refusal, or a cancellation
   * is otherwise invisible to the manager on its next step.
   */
  dispatchIntents?: { list(threadId: string): Promise<AgentDispatchIntent[]> }
  nowMs?: () => number
}

const OPEN_DISPATCH_STATES: ReadonlySet<DispatchRecord['state']> = new Set([
  'pending',
  'delivering',
  'uncertain',
  'accepted'
])

/** The whole block stays small; it re-renders every model step. */
const MAX_BLOCK_CHARS = 2_400
const MAX_WORKER_LINES = 8
const MAX_DISPATCH_LINES = 6
const MAX_QUESTION_LINES = 5
const MAX_INTENT_LINES = 4
/** Settled failures stay visible long enough for the manager to react. */
const RECENT_SETTLED_MS = 2 * 60 * 60_000
const TERMINAL_INTENT_STATES: ReadonlySet<AgentDispatchIntent['state']> = new Set([
  'completed',
  'failed',
  'cancelled'
])

const ROLE_GUIDANCE = [
  'You are the manager of this ADE team workspace.',
  '- Answer simple questions and make small, well-understood edits yourself.',
  '- When the request splits into independent pieces (separate modules, files, or checks), create one worker per piece and dispatch them in parallel instead of doing them serially yourself.',
  '- Delegate self-contained tasks to workers with `worker_create` / `worker_dispatch`; every dispatch needs explicit acceptance criteria.',
  '- Treat worker reports as claims: cross-check results against the criteria before telling the user the work is done.',
  '- Completed or failed dispatches still need your review; unanswered worker questions block the worker until you or the user answers.'
].join('\n')

const EXISTING_TEAM_GUIDANCE = [
  'Persistent collaboration is disabled for new work in this session.',
  '- Review existing worker results and answer outstanding questions.',
  '- You may inspect, stop, release, or cancel existing worker work.',
  '- Do not create workers or dispatch new work until collaboration is enabled again.'
].join('\n')

function workerLines(team: TeamRecord): string[] {
  const lines = team.workers.slice(0, MAX_WORKER_LINES).map((worker) => {
    const route = [worker.route.harnessId, worker.route.model].filter(Boolean).join('/')
    const review = worker.reviewOf ? `, reviewing ${worker.reviewOf}` : ''
    return `- ${worker.workerId} [${worker.state}] ${worker.label} on ${route}${review}`
  })
  const rest = team.workers.length - lines.length
  if (rest > 0) lines.push(`- …and ${rest} more worker(s)`)
  return lines
}

function dispatchLines(
  dispatches: readonly DispatchRecord[], nowMs: number, rerouted: ReadonlySet<string>
): string[] {
  const open = dispatches.filter((d) => OPEN_DISPATCH_STATES.has(d.state))
  const reviewable = dispatches.filter(
    (d) => !OPEN_DISPATCH_STATES.has(d.state) && d.workerReport
  )
  // A dispatch that failed without a report (e.g. before its turn started)
  // must not silently drop out of the manager's view.
  const failed = dispatches.filter((d) =>
    (d.state === 'failed' || d.state === 'cancelled') && !d.workerReport &&
    recent(d.updatedAt, nowMs))
  const lines: string[] = []
  for (const d of [...open, ...reviewable, ...failed].slice(0, MAX_DISPATCH_LINES)) {
    const state = OPEN_DISPATCH_STATES.has(d.state)
      ? d.state
      : d.workerReport
        ? `${d.state}, report awaiting review`
        : d.state === 'failed' && rerouted.has(d.workerId)
          ? 'failed, rerouted automatically to another Agent; do not redo it'
          : `${d.state}${d.failureReason ? `: ${compact(d.failureReason, 140)}` : ''}`
    lines.push(`- ${d.dispatchId} [${state}] ${d.title} → ${d.workerId}`)
  }
  const rest = open.length + reviewable.length + failed.length - lines.length
  if (rest > 0) lines.push(`- …and ${rest} more dispatch(es)`)
  return lines
}

/** Cards that never reached a worker: proposals, refusals, cancellations. */
function intentLines(intents: readonly AgentDispatchIntent[], nowMs: number): string[] {
  const unstarted = intents.filter((intent) => !intent.target?.workerIds?.length)
  const open = unstarted.filter((intent) => !TERMINAL_INTENT_STATES.has(intent.state))
  const settled = unstarted
    .filter((intent) =>
      (intent.state === 'failed' || intent.state === 'cancelled') && recent(intent.updatedAt, nowMs))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const lines = [...open, ...settled].slice(0, MAX_INTENT_LINES).map((intent) =>
    `- ${intent.intentId} [${intentStatus(intent)}] ${compact(intent.recommendation.title, 80)}`)
  const rest = open.length + settled.length - lines.length
  if (rest > 0) lines.push(`- …and ${rest} more card(s)`)
  return lines
}

// No live seconds here: the block re-renders every model step and a ticking
// value would change the request on every step of a pending countdown.
function intentStatus(intent: AgentDispatchIntent): string {
  switch (intent.state) {
    case 'countdown':
      return 'countdown, starts automatically unless the user cancels'
    case 'pending_confirmation':
      return 'waiting for user confirmation'
    case 'reviewing':
      return 'automatic review'
    case 'paused':
      return 'paused by the user'
    case 'failed':
      return `failed, no worker started: ${compact(intent.error ?? intent.decision?.reason ?? 'unknown reason', 140)}`
    case 'cancelled':
      return Object.keys(intent.requestLedger ?? {}).some((key) => key.startsWith('source-abort:'))
        ? 'cancelled because its source turn was stopped; no worker started'
        : 'cancelled, no worker started'
    default:
      return intent.error ? `${intent.state}: ${compact(intent.error, 140)}` : intent.state
  }
}

function recent(timestamp: string, nowMs: number): boolean {
  const at = Date.parse(timestamp)
  return Number.isFinite(at) && nowMs - at <= RECENT_SETTLED_MS
}

function compact(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function questionLines(questions: readonly QuestionRecord[]): string[] {
  const lines = questions.slice(0, MAX_QUESTION_LINES).map((q) => {
    const snippet = q.question.replace(/\s+/g, ' ').slice(0, 120)
    return `- ${q.questionId} [${q.state}] from ${q.workerId}: ${snippet}`
  })
  const rest = questions.length - lines.length
  if (rest > 0) lines.push(`- …and ${rest} more question(s)`)
  return lines
}

export function createAdeManagerContext(
  deps: AdeManagerContextDeps
): (input: { threadId: string; newWorkAllowed?: boolean }) => Promise<string | undefined> {
  return async ({ threadId, newWorkAllowed }) => {
    const nowMs = deps.nowMs?.() ?? Date.now()
    const [team, harnessSummary, intents] = await Promise.all([
      deps.teams.byManager(threadId).catch(() => null),
      deps.harnessSummary().catch(() => undefined),
      deps.dispatchIntents?.list(threadId).catch(() => [] as AgentDispatchIntent[]) ?? []
    ])
    const canStartNewWork = newWorkAllowed !== false && deps.canStartNewWork?.() !== false
    const sections: string[] = [canStartNewWork ? ROLE_GUIDANCE : EXISTING_TEAM_GUIDANCE]
    if (team && team.status === 'active') {
      const [dispatches, openQuestions] = await Promise.all([
        deps.dispatches.list(team.teamId).catch(() => [] as DispatchRecord[]),
        deps.questions.listOpen(team.teamId).catch(() => [] as QuestionRecord[])
      ])
      const worker = workerLines(team)
      const dispatch = dispatchLines(dispatches, nowMs, new Set(intents.flatMap(replacedWorkerIds)))
      const question = questionLines(openQuestions)
      sections.push(
        `Team ${team.teamId} state:`,
        `Workers (${team.workers.length}):`,
        ...(worker.length ? worker : ['- none yet']),
        `Dispatches needing attention:`,
        ...(dispatch.length ? dispatch : ['- none']),
        `Open worker questions:`,
        ...(question.length ? question : ['- none'])
      )
    } else if (canStartNewWork) {
      sections.push('No team exists yet; `worker_create` creates one lazily on first use.')
    }
    const intent = intentLines(intents, nowMs)
    if (intent.length) {
      sections.push(
        'Dispatch cards without a started worker (check `dispatch_intent_status` before assuming they run):',
        ...intent
      )
    }
    if (harnessSummary) sections.push(harnessSummary)
    const block = sections.join('\n')
    return block.length <= MAX_BLOCK_CHARS
      ? block
      : `${block.slice(0, MAX_BLOCK_CHARS - 1)}…`
  }
}
