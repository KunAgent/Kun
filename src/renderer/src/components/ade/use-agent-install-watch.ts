import type { HarnessInstallAction, HarnessInstallJob } from '../../../../../kun/src/contracts/harness-install'
import { harnessInstallRequest } from '../../agent/kun-harness-install-client'
import { loadHarnesses } from '../../store/harness-store'
import { agentUpdateLastLine } from './AgentUpdateProgress'
import { setAgentInstall, useAgentActivityStore } from './agent-center-activity-store'
import type { AgentInstallObservation } from './agent-center-presentation'

const POLL_MS = 2_000
let timer: ReturnType<typeof setInterval> | null = null

/** What the list, the detail and the floating card need to know about an install job. */
export function installObservation(job: HarnessInstallJob, action: HarnessInstallAction): AgentInstallObservation {
  const startedAt = Date.parse(job.startedAt)
  const lastLine = agentUpdateLastLine(job.output)
  return { status: job.status, action, ...(Number.isFinite(startedAt) ? { startedAt } : {}), ...(lastLine ? { lastLine } : {}) }
}

function runningInstalls(): Array<[string, HarnessInstallAction]> {
  return Object.entries(useAgentActivityStore.getState().install)
    .filter(([, observation]) => observation.status === 'running' || observation.status === 'verifying')
    .map(([id, observation]) => [id, observation.action ?? 'install'])
}

function poll(): void {
  for (const [id, action] of runningInstalls()) {
    void harnessInstallRequest(id, action).then((state) => {
      const job = state?.job
      setAgentInstall(id, job ? installObservation(job, action) : undefined)
      if (job && job.status !== 'running' && job.status !== 'verifying') void loadHarnesses(true, { waitMs: 3_000 })
    }).catch(() => undefined)
  }
}

function sync(): void {
  const busy = runningInstalls().length > 0
  if (busy && !timer) timer = setInterval(poll, POLL_MS)
  if (!busy && timer) { clearInterval(timer); timer = null }
}

/**
 * Keeps install jobs honest app-wide: while an install observed in this
 * window runs, the runtime is asked how it is going, so the list, the detail
 * and the floating card agree even when no Agent page is on screen.
 */
useAgentActivityStore.subscribe((state, previous) => { if (state.install !== previous.install) sync() })

/** Kept for callers that mount the Agent Center; the watch itself runs at module level. */
export function useAgentInstallWatch(): void { sync() }
