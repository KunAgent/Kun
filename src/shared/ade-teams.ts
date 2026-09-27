/**
 * Renderer-facing mirror of the /v1/teams surface (docs/ade/09 §9).
 * The wire shape is owned by kun/src/contracts/ade.ts; keep names aligned.
 */
export type AdeTeamWorker = {
  workerId: string
  label: string
  role?: string
  taskWorkspaceId?: string
  control: 'manager' | 'user'
  state: 'active' | 'released' | 'detached'
}

export type AdeTeamRecord = {
  teamId: string
  managerThreadId: string
  status: 'active' | 'ended'
  workers: AdeTeamWorker[]
  createdAt: string
  updatedAt: string
}

export type AdeDispatchCapture = {
  changedFiles: number
  insertions: number
  deletions: number
  patchArtifactId?: string
}

export type AdeQualityVerdict = {
  status: 'pending' | 'passed' | 'needs_changes' | 'rejected' | 'waived'
  decidedBy?: 'manager' | 'user' | 'reviewer'
  decidedAt?: string
}

export type AdeDispatchRecord = {
  dispatchId: string
  teamId: string
  workerId: string
  title: string
  state: 'pending' | 'delivering' | 'uncertain' | 'accepted' | 'completed' | 'failed' | 'cancelled'
  capture?: AdeDispatchCapture
  verdict?: AdeQualityVerdict
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

/** GET /v1/teams/by-manager/:threadId */
export type AdeTeamOverview = {
  team: AdeTeamRecord
  dispatches: AdeDispatchRecord[]
  questions: AdeQuestionRecord[]
}
