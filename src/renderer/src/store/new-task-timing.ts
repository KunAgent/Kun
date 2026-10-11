/** Report a slow New task as one line with per-step durations, so the slow round trip is named. */
export const NEW_TASK_SLOW_LOG_MS = 500

export type NewTaskTiming = { step: (name: string) => void; finish: (outcome: string) => void }

export function startNewTaskTiming(
  label: string,
  log: (line: string) => void = (line) => console.info(line),
  now: () => number = () => performance.now()
): NewTaskTiming {
  const startedAt = now()
  let last = startedAt
  const steps: string[] = []
  return {
    step: (name) => {
      const current = now()
      steps.push(`${name} ${Math.round(current - last)}ms`)
      last = current
    },
    finish: (outcome) => {
      const total = now() - startedAt
      if (total < NEW_TASK_SLOW_LOG_MS) return
      log(`[kun-gui] ${label} ${outcome} after ${Math.round(total)}ms (${steps.join(', ') || 'no steps'})`)
    }
  }
}
