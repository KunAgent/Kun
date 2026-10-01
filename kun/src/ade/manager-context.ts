/**
 * ADE manager per-turn context (docs/ade/impl p3-review-followup P3-14):
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

export type AdeManagerContextDeps = {
  teams: { byManager(managerThreadId: string): Promise<TeamRecord | null> }
  dispatches: { list(teamId: string): Promise<DispatchRecord[]> }
  questions: { listOpen(teamId: string): Promise<QuestionRecord[]> }
  /** Same ready-harness routing menu the Graph planner sees (P1-25). */
  harnessSummary: () => Promise<string | undefined>
  /** New dispatch admission; existing-team guidance remains when disabled. */
  canStartNewWork?: () => boolean
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

function dispatchLines(dispatches: readonly DispatchRecord[]): string[] {
  const open = dispatches.filter((d) => OPEN_DISPATCH_STATES.has(d.state))
  const reviewable = dispatches.filter(
    (d) => !OPEN_DISPATCH_STATES.has(d.state) && d.workerReport
  )
  const lines: string[] = []
  for (const d of [...open, ...reviewable].slice(0, MAX_DISPATCH_LINES)) {
    const state = OPEN_DISPATCH_STATES.has(d.state) ? d.state : `${d.state}, report awaiting review`
    lines.push(`- ${d.dispatchId} [${state}] ${d.title} → ${d.workerId}`)
  }
  const rest = open.length + reviewable.length - lines.length
  if (rest > 0) lines.push(`- …and ${rest} more dispatch(es)`)
  return lines
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
    const [team, harnessSummary] = await Promise.all([
      deps.teams.byManager(threadId).catch(() => null),
      deps.harnessSummary().catch(() => undefined)
    ])
    const canStartNewWork = newWorkAllowed !== false && deps.canStartNewWork?.() !== false
    const sections: string[] = [canStartNewWork ? ROLE_GUIDANCE : EXISTING_TEAM_GUIDANCE]
    if (team && team.status === 'active') {
      const [dispatches, openQuestions] = await Promise.all([
        deps.dispatches.list(team.teamId).catch(() => [] as DispatchRecord[]),
        deps.questions.listOpen(team.teamId).catch(() => [] as QuestionRecord[])
      ])
      const worker = workerLines(team)
      const dispatch = dispatchLines(dispatches)
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
    if (harnessSummary) sections.push(harnessSummary)
    const block = sections.join('\n')
    return block.length <= MAX_BLOCK_CHARS
      ? block
      : `${block.slice(0, MAX_BLOCK_CHARS - 1)}…`
  }
}
