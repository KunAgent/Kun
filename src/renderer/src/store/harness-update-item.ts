import type { HarnessUpdateJob } from '../../../../kun/src/contracts/harness-update'

/** One Agent's background update as every surface shows it (see `harness-update-runner.ts`). */
export type AgentUpdatePhase = 'starting' | 'waiting' | 'running' | 'verifying' | 'switching' | 'completed' | 'failed'
export type AgentUpdateItem = {
  harnessId: string
  action: HarnessUpdateJob['action']
  phase: AgentUpdatePhase
  /** Epoch ms the work started; the job's own start time once known. */
  startedAt: number
  finishedAt?: number
  jobId?: string
  /** Target version while running, the installed one once completed. */
  version?: string
  previousVersion?: string
  /** An `agentUpdate.*` key or a raw message. */
  error?: string
  /** The step that was running when the work failed. */
  failedAt?: AgentUpdatePhase
  output?: string
  canRollback?: boolean
  /** The user closed the floating card; the page banner stays. */
  toastHidden?: boolean
}

export const AGENT_UPDATE_RUNNING: ReadonlySet<AgentUpdatePhase> = new Set(['starting', 'waiting', 'running', 'verifying', 'switching'])
