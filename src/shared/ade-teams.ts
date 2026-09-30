/**
 * Renderer-facing mirror of the /v1/teams surface (docs/ade/09 §9).
 * The wire shape is owned by kun/src/contracts/ade.ts; keep names aligned.
 */
import type { ReviewRevision } from './review-revision'
export type AdeHarnessRoute = {
  harnessId: string
  providerId?: string
  model: string
  credentialMode: string
}

export type AdeTeamWorker = {
  workerId: string
  label: string
  role?: string
  route?: AdeHarnessRoute
  permissionMode?: string
  lifecycle?: 'persistent' | 'ephemeral'
  taskWorkspaceId?: string
  /** Ephemeral cross-reviewer inspecting this dispatch (10 §5). */
  reviewOf?: string
  control: 'manager' | 'user'
  state: 'active' | 'released' | 'detached'
}

export type AdeTeamRecord = {
  teamId: string
  managerThreadId: string
  status: 'active' | 'ended'
  workers: AdeTeamWorker[]
  /** Token budget written at team creation (P3-15). */
  budget?: { softTokens?: number; hardTokens?: number }
  createdAt: string
  updatedAt: string
}

/** Summed worker-thread usage + budget verdicts (P3-15). */
export type AdeTeamUsage = {
  totalTokens: number
  perWorker: Array<{ workerId: string; label: string; totalTokens: number }>
  softTokens?: number
  hardTokens?: number
  softExceeded: boolean
  hardExceeded: boolean
}

export type AdeDispatchCapture = {
  changedFiles: number
  insertions: number
  deletions: number
  patchArtifactId?: string
}

export type AdeQualityCheck = {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  source: 'worker' | 'host' | 'reviewer'
  detail?: string
  revision?: ReviewRevision
}

export type AdeQualityVerdict = {
  status: 'pending' | 'passed' | 'needs_changes' | 'rejected' | 'waived'
  decidedBy?: 'manager' | 'user' | 'reviewer'
  checks?: AdeQualityCheck[]
  notes?: string
  decidedAt?: string
  revision?: ReviewRevision
}

/** POST /v1/teams/workers/:workerId/run-checks (docs/ade/10 §4.2). */
export type AdeRunWorkerChecksResult = {
  ok: boolean
  refusal?:
    | 'worker_not_found'
    | 'checks_unavailable'
    | 'no_workspace'
    | 'workspace_not_ready'
    | 'no_approved_checks'
    | 'no_dispatch'
  checks?: AdeQualityCheck[]
  dispatchId?: string
  logArtifactId?: string
  userReport: string
}

export type AdeDispatchRecord = {
  dispatchId: string
  teamId: string
  workerId: string
  title: string
  state: 'pending' | 'delivering' | 'uncertain' | 'accepted' | 'completed' | 'failed' | 'cancelled'
  capture?: AdeDispatchCapture
  verdict?: AdeQualityVerdict
  revision?: ReviewRevision
  createdAt: string
  updatedAt: string
}

export type AdeQuestionRecord = {
  questionId: string
  dispatchId: string
  workerId: string
  question: string
  options?: string[]
  state: 'open' | 'answered' | 'escalated' | 'timeout' | 'cancelled'
  answer?: string
  answeredBy?: 'manager' | 'user'
  createdAt: string
  updatedAt: string
}

/** Same-task race record (docs/ade/10 §6). */
export type AdeRaceContender = {
  dispatchId?: string
  workerId?: string
  harnessId: string
  model?: string
  label: string
  createError?: string
}

export type AdeRaceRecord = {
  raceId: string
  teamId: string
  label: string
  startSha?: string
  contenders: AdeRaceContender[]
  state: 'running' | 'ready' | 'decided'
  winnerDispatchId?: string
  notes?: string
  deadlineAt: string
  createdAt: string
  updatedAt: string
}

/** One column in the compare view (docs/ade/11 §5). */
export type AdeRaceCompareContender = AdeRaceContender & {
  dispatchState?: AdeDispatchRecord['state']
  timedOut: boolean
  verdict?: AdeQualityVerdict
  capture?: AdeDispatchCapture
  workerReport?: { summary: string; outcome: 'succeeded' | 'partial' | 'failed' }
  resultExcerpt?: string
  durationMs?: number
  taskWorkspaceId?: string
  checks?: Array<{ name: string; status: string; detail?: string }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd?: number
    costCny?: number
    valueEstimateUsd?: number
  }
}

/** GET /v1/teams/races/:raceId */
export type AdeRaceComparison = {
  race: AdeRaceRecord
  contenders: AdeRaceCompareContender[]
}

/** GET /v1/teams/by-manager/:threadId */
export type AdeTeamOverview = {
  team: AdeTeamRecord
  dispatches: AdeDispatchRecord[]
  questions: AdeQuestionRecord[]
  races?: AdeRaceRecord[]
  /** Team usage rollup (P3-15); absent when usage tracking is unwired. */
  usage?: AdeTeamUsage
}
