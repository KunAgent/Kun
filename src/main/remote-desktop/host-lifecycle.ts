import type { EventEmitter } from 'node:events'

type DisplayChange = { event: 'display_removed' | 'display_metrics_changed'; metrics: string[]; stopRequested: boolean }
/** Only geometry changes invalidate the approved display's pointer mapping. */
export function bindDesktopDisplayStops(events: Pick<EventEmitter, 'on'>, stop: (reason: string) => Promise<unknown>, observe?: (change: DisplayChange) => void) {
  const end = () => { void stop('display_changed').catch(() => {}) }
  const record = (value: DisplayChange) => { try { observe?.(value) } catch { /* Logging must not prevent a privacy stop. */ } }
  events.on('display-removed', () => { record({ event: 'display_removed', metrics: [], stopRequested: true }); end() })
  events.on('display-metrics-changed', (_event, _display, changed: string[]) => {
    const metrics = [...new Set(changed.filter(metric => ['bounds', 'scaleFactor', 'rotation', 'workArea'].includes(metric)))]
    const stopRequested = metrics.some(metric => metric !== 'workArea')
    record({ event: 'display_metrics_changed', metrics, stopRequested })
    if (stopRequested) end()
  })
}

/** Privacy transitions end the logical session; becoming active never resumes it. */
export function bindDesktopPrivacyStops(events: Pick<EventEmitter, 'on'>, stop: (reason: string) => Promise<unknown>) {
  for (const event of ['lock-screen', 'suspend', 'user-did-resign-active']) {
    events.on(event, () => { void stop('host_inactive').catch(() => {}) })
  }
}
