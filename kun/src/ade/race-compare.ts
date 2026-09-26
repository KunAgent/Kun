import type {
  DispatchRecord,
  QualityCheck,
  QualityVerdict,
  RaceRecord,
  TurnRunOutcome,
  WorkerReport
} from '../contracts/ade.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import type { UsageService } from '../services/usage-service-core.js'

/**
 * Race compare payload for `GET /v1/teams/races/:raceId` (10 §6.3, 11 §5):
 * per-contender execution state, verdict, diff stats, checks, the worker's
 * own report, wall-clock duration, and usage/cost rolled up per worker
 * thread.
 */
export type RaceCompareContender = {
  dispatchId?: string
  workerId?: string
  harnessId: string
  model?: string
  label: string
  /** Worker creation refusal — the contender never ran. */
  createError?: string
  dispatchState?: DispatchRecord['state']
  /** Non-terminal dispatch once the race deadline passed. */
  timedOut: boolean
  outcome?: TurnRunOutcome
  verdict?: QualityVerdict
  capture?: DispatchRecord['capture']
  workerReport?: WorkerReport
  resultExcerpt?: string
  durationMs?: number
  taskWorkspaceId?: string
  checks?: QualityCheck[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    turns: number
    costUsd?: number
    costCny?: number
    valueEstimateUsd?: number
    costByCurrency?: Record<string, number>
  }
}

export type RaceComparison = {
  race: RaceRecord
  contenders: RaceCompareContender[]
}

export type RaceCompareDeps = {
  dispatches: Pick<FileDispatchStore, 'get'>
  teams: Pick<FileTeamStore, 'get'>
  usage?: Pick<UsageService, 'forThread'>
  nowMs?: () => number
}

export async function buildRaceComparison(
  deps: RaceCompareDeps,
  race: RaceRecord
): Promise<RaceComparison> {
  const nowMs = deps.nowMs ?? Date.now
  const deadlineMs = Date.parse(race.deadlineAt)
  const expired = deadlineMs <= nowMs()
  const team = await deps.teams.get(race.teamId).catch(() => null)
  const contenders = await Promise.all(
    race.contenders.map(async (contender): Promise<RaceCompareContender> => {
      const base: RaceCompareContender = {
        dispatchId: contender.dispatchId,
        workerId: contender.workerId,
        harnessId: contender.harnessId,
        model: contender.model,
        label: contender.label,
        createError: contender.createError,
        timedOut: false
      }
      const worker = contender.workerId
        ? team?.workers.find((entry) => entry.workerId === contender.workerId)
        : undefined
      if (worker?.taskWorkspaceId) base.taskWorkspaceId = worker.taskWorkspaceId
      const dispatch = contender.dispatchId
        ? await deps.dispatches.get(race.teamId, contender.dispatchId).catch(() => null)
        : null
      if (dispatch) {
        const terminal = dispatch.state === 'completed'
          || dispatch.state === 'failed'
          || dispatch.state === 'cancelled'
        base.dispatchState = dispatch.state
        base.timedOut = expired && !terminal
        base.outcome = dispatch.outcome
        base.verdict = dispatch.verdict
        base.capture = dispatch.capture
        base.workerReport = dispatch.workerReport
        base.resultExcerpt = dispatch.resultExcerpt
        base.checks = dispatch.verdict?.checks ?? []
        const created = Date.parse(dispatch.createdAt)
        const finished = Date.parse(dispatch.updatedAt)
        if (Number.isFinite(created) && Number.isFinite(finished)) {
          base.durationMs = Math.max(0, finished - created)
        }
      } else if (!contender.createError) {
        base.timedOut = expired
      }
      if (contender.workerId && deps.usage) {
        const snapshot = deps.usage.forThread(contender.workerId)
        if (snapshot && snapshot.totalTokens > 0) {
          base.usage = {
            promptTokens: snapshot.promptTokens,
            completionTokens: snapshot.completionTokens,
            totalTokens: snapshot.totalTokens,
            turns: snapshot.turns,
            ...(snapshot.costUsd !== undefined ? { costUsd: snapshot.costUsd } : {}),
            ...(snapshot.costCny !== undefined ? { costCny: snapshot.costCny } : {}),
            ...(snapshot.valueEstimateUsd !== undefined
              ? { valueEstimateUsd: snapshot.valueEstimateUsd }
              : {}),
            ...(snapshot.costByCurrency ? { costByCurrency: snapshot.costByCurrency } : {})
          }
        }
      }
      return base
    })
  )
  return { race, contenders }
}
