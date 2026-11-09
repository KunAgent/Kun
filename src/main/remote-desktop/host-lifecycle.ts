import type { EventEmitter } from 'node:events'

/** Privacy transitions end the logical session; becoming active never resumes it. */
export function bindDesktopPrivacyStops(events: Pick<EventEmitter, 'on'>, stop: (reason: string) => Promise<unknown>) {
  for (const event of ['lock-screen', 'suspend', 'user-did-resign-active']) {
    events.on(event, () => { void stop('host_inactive').catch(() => {}) })
  }
}
