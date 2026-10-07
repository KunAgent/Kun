import type { AppSettingsV1 } from '../../shared/app-settings'
import { isAppLocale } from '../../shared/app-locales'
import type { ProviderQuotaListResult } from '../../shared/provider-quota'
import { nextQuotaReminderAt, quotaReminderText, quotaResetReminders } from '../../shared/provider-quota-reminders'

const FIRST_CHECK_MS = 5 * 60_000
const MIN_GAP_MS = 10 * 60_000
const MAX_GAP_MS = 12 * 3_600_000

type Deps = {
  /** The runtime's quota list; it answers from its own short cache when it can. */
  list: () => Promise<ProviderQuotaListResult>
  show: (payload: { title: string; body: string; dedupeKey: string }) => Promise<unknown>
  settings: () => Promise<Pick<AppSettingsV1, 'locale' | 'notifications'>>
  now?: () => number
  setTimer?: (run: () => void, ms: number) => { cancel(): void }
}

/**
 * Allowance reminders, owned by Main so they work while the window is closed.
 * Every quota list the app fetches anyway (the quota panel, the sidebar)
 * passes through `observe`. On its own the service asks only when a long
 * window is about to enter the reminder period, and at most every 12 hours
 * otherwise, so reminders add almost no provider traffic.
 */
export class ProviderQuotaReminderService {
  private timer?: { cancel(): void }
  private stopped = true

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(FIRST_CHECK_MS)
  }

  stop(): void {
    this.stopped = true
    this.timer?.cancel()
    this.timer = undefined
  }

  /** Sends due reminders from a quota list and plans the next own check from it. */
  async observe(result: ProviderQuotaListResult): Promise<number> {
    const now = this.now()
    let sent = 0
    let next: number | undefined
    const settings = await this.deps.settings()
    const enabled = settings.notifications.quotaReminders !== false
    for (const entry of result.entries) {
      if (entry.status !== 'available') continue
      const at = nextQuotaReminderAt(entry.metrics, now)
      if (at !== undefined && (next === undefined || at < next)) next = at
      if (!enabled) continue
      for (const reminder of quotaResetReminders(entry.metrics, now)) {
        const metric = entry.metrics.find((item) => item.id === reminder.metricId)
        const dedupeKey = `${entry.providerId}:${reminder.metricId}:${metric?.resetsAt ?? ''}`.replace(/[^\w:.@/+-]/g, '_').slice(0, 200)
        await this.deps.show({ ...quotaReminderText(isAppLocale(settings.locale) ? settings.locale : undefined, entry.providerName, reminder), dedupeKey })
        sent += 1
      }
    }
    if (!this.stopped) this.schedule(next === undefined ? MAX_GAP_MS : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, next - now)))
    return sent
  }

  private schedule(ms: number): void {
    this.timer?.cancel()
    this.timer = (this.deps.setTimer ?? defaultTimer)(() => void this.check(), ms)
  }

  private async check(): Promise<void> {
    if (this.stopped) return
    try {
      await this.observe(await this.deps.list())
    } catch {
      // The runtime may be restarting; try again later.
      if (!this.stopped) this.schedule(MIN_GAP_MS * 3)
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}

function defaultTimer(run: () => void, ms: number): { cancel(): void } {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

let active: ProviderQuotaReminderService | undefined

export function startProviderQuotaReminders(deps: Deps): ProviderQuotaReminderService {
  active?.stop()
  active = new ProviderQuotaReminderService(deps)
  active.start()
  return active
}

/** Lets a quota list fetched for any other reason drive reminders without another request. */
export function observeProviderQuotasForReminders(result: ProviderQuotaListResult): void {
  void active?.observe(result).catch(() => undefined)
}
