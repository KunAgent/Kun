import { useEffect } from 'react'
import type { HarnessInstallAction } from '../../../../../kun/src/contracts/harness-install'
import { harnessInstallRequest } from '../../agent/kun-harness-install-client'
import { loadHarnesses } from '../../store/harness-store'
import { setAgentInstall, useAgentActivityStore } from './agent-center-activity-store'

const POLL_MS = 2_000

/**
 * Keeps the list honest about installs that are running: while a job is
 * running the Agent Center asks the runtime how it is going, so the list and
 * the detail agree even when the detail for that Agent is not on screen.
 */
export function useAgentInstallWatch(): void {
  const install = useAgentActivityStore((state) => state.install)
  const running = Object.entries(install)
    .filter(([, observation]) => observation.status === 'running' || observation.status === 'verifying')
    .map(([id, observation]) => `${id}:${observation.action ?? 'install'}`)
  const key = running.join(',')
  useEffect(() => {
    if (!key) return
    const timer = setInterval(() => {
      for (const entry of key.split(',')) {
        const [id = '', action = 'install'] = entry.split(':')
        void harnessInstallRequest(id, action as HarnessInstallAction).then((state) => {
          const job = state?.job
          setAgentInstall(id, job ? { status: job.status, action: action as HarnessInstallAction } : undefined)
          if (job && job.status !== 'running' && job.status !== 'verifying') void loadHarnesses(true, { waitMs: 3_000 })
        }).catch(() => undefined)
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [key])
}
