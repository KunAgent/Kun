import { powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { requestManagerJson } from '../../kun/src/manager/manager-client.js'
import { mainState } from './main-app-context'
import { runtimeSupervisor } from './main-runtime-health'
import { logWarn } from './logger'

const HOST_RESUME_GRACE_MS = 20_000

export function installHostPowerRecovery(): () => void {
  const sourceId = `electron-main:${process.pid}:${randomUUID()}`
  let sequence = 0
  let disposed = false
  const report = (phase: 'suspend' | 'resume'): void => {
    sequence += 1
    const reportSequence = sequence
    const observedAt = new Date().toISOString()
    void reportWithRetry(phase, reportSequence, observedAt)
  }
  const reportWithRetry = async (
    phase: 'suspend' | 'resume',
    reportSequence: number,
    observedAt: string
  ): Promise<void> => {
    const delays = [0, 500, 1_500]
    let lastError: unknown
    for (const delay of delays) {
      if (disposed) return
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
      if (disposed) return
      const manager = mainState.activeServiceManager
      if (!manager) continue
      try {
        await requestManagerJson(manager, '/v1/manager/host-power', {
          method: 'POST',
          body: { phase, sourceId, sequence: reportSequence, observedAt },
          timeoutMs: 2_000
        })
        return
      } catch (error) {
        lastError = error
      }
    }
    if (lastError !== undefined) {
      logWarn('host-power', `Manager ${phase} report failed.`, {
        message: lastError instanceof Error ? lastError.message : String(lastError)
      })
    }
  }
  const onSuspend = (): void => {
    runtimeSupervisor.noteHostSuspended()
    report('suspend')
  }
  const onResume = (): void => {
    runtimeSupervisor.noteHostResumed(HOST_RESUME_GRACE_MS)
    report('resume')
  }
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  return () => {
    disposed = true
    powerMonitor.removeListener('suspend', onSuspend)
    powerMonitor.removeListener('resume', onResume)
  }
}
