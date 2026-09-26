import type { DispatchRecord, QuestionRecord, TeamRecord } from '../contracts/ade.js'

/** Dispatches that still count as unfinished work (06 §7.2 condition 2). */
const OPEN_DISPATCH_STATES: ReadonlySet<DispatchRecord['state']> = new Set([
  'pending',
  'delivering',
  'uncertain',
  'accepted'
])

/** Questions with no answer yet; escalated still waits on the user. */
const OPEN_QUESTION_STATES: ReadonlySet<QuestionRecord['state']> = new Set([
  'open',
  'escalated'
])

export type WorkerOpenWorkStores = {
  teams: { list(): Promise<TeamRecord[]> }
  dispatches: {
    listByWorker(teamId: string, workerId: string): Promise<DispatchRecord[]>
  }
  questions: {
    listByWorker(teamId: string, workerId: string): Promise<QuestionRecord[]>
  }
}

/**
 * Dormancy gate (docs/ade/06 §7.2 conditions 2-3): does this worker still
 * have an unfinished dispatch or an unanswered question? Queried live from
 * the ADE stores instead of being mirrored into ActivityStore rows.
 */
export async function hasOpenWorkerWork(
  stores: WorkerOpenWorkStores,
  workerId: string
): Promise<boolean> {
  const teams = await stores.teams.list()
  const team = teams.find((t) => t.workers.some((w) => w.workerId === workerId))
  if (!team) return false
  const [dispatches, questions] = await Promise.all([
    stores.dispatches.listByWorker(team.teamId, workerId),
    stores.questions.listByWorker(team.teamId, workerId)
  ])
  return (
    dispatches.some((d) => OPEN_DISPATCH_STATES.has(d.state)) ||
    questions.some((q) => OPEN_QUESTION_STATES.has(q.state))
  )
}
