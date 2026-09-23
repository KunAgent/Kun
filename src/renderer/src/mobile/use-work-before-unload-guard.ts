import { useEffect } from 'react'
import type { WorkLeaveState } from './mobile-mode-policy'
import { workLeaveDecision } from './mobile-mode-policy'

export function useWorkBeforeUnloadGuard(active: boolean, state: WorkLeaveState): void {
  const decision = workLeaveDecision(state)
  useEffect(() => {
    if (!active || decision === 'allow') return
    const prevent = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [active, decision])
}
