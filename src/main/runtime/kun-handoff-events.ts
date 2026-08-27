import type { KunHandoffEvent } from './kun-installed-build-handoff'
import { logKunHandoffEvent } from './kun-handoff-logging'

export type HandoffEventListener = (event: KunHandoffEvent) => void

export function createHandoffEventReporter(
  listener?: HandoffEventListener
): (event: KunHandoffEvent) => void {
  return (event) => {
    logKunHandoffEvent(event)
    listener?.(event)
  }
}
