import type { ThreadSummary } from '../../contracts/threads.js'
import { nextOpenTabs, sessionTabStatus, type SessionTabStatus } from '../session-view-model.js'

export type SessionTabView = {
  id: string
  slot: number
  title: string
  workspace: string
  updatedAt?: string
  current: boolean
  status: SessionTabStatus
}

/**
 * Sessions opened in this TUI, in opening order, plus when the reader last
 * looked at each one so replies that arrive afterwards read as unread.
 */
export class SessionNavigation {
  private tabs: string[] = []
  private currentId?: string
  private readonly lastSeen = new Map<string, string>()
  private readonly titles = new Map<string, { title: string; workspace: string }>()

  /** Record the open session; returns true when the tab list changed. */
  observe(current: { id: string; title?: string; workspace: string } | undefined, nowIso = new Date().toISOString()): boolean {
    const id = current?.id
    if (current) {
      this.lastSeen.set(current.id, nowIso)
      this.titles.set(current.id, { title: current.title || 'Untitled', workspace: current.workspace })
    }
    const before = this.tabs.join('\n')
    this.currentId = id
    this.tabs = nextOpenTabs(this.tabs, id)
    return before !== this.tabs.join('\n')
  }

  get openTabs(): readonly string[] {
    return this.tabs
  }

  tabAt(slot: number): string | undefined {
    return this.tabs[slot - 1]
  }

  lastSeenAt(id: string): string | undefined {
    return this.lastSeen.get(id)
  }

  /** Tab views; non-current tabs take title and status from the thread list. */
  views(threads: readonly ThreadSummary[], live: { running: boolean; waiting: boolean }): SessionTabView[] {
    const byId = new Map(threads.map((thread) => [thread.id, thread] as const))
    return this.tabs.map((id, index) => {
      const summary = byId.get(id)
      const known = this.titles.get(id)
      const current = id === this.currentId
      return {
        id,
        slot: index + 1,
        title: summary?.title || known?.title || 'Untitled',
        workspace: summary?.workspace ?? known?.workspace ?? '',
        ...(summary?.updatedAt ? { updatedAt: summary.updatedAt } : {}),
        current,
        status: sessionTabStatus({
          current,
          running: current ? live.running : summary?.status === 'running',
          waiting: current && live.waiting,
          ...(summary?.updatedAt ? { updatedAt: summary.updatedAt } : {}),
          ...(this.lastSeen.get(id) ? { lastSeenAt: this.lastSeen.get(id)! } : {})
        })
      }
    })
  }

  /** Status for any thread in the list (the rail shows more than the tabs). */
  statusOf(thread: ThreadSummary, live: { running: boolean; waiting: boolean }): SessionTabStatus {
    const current = thread.id === this.currentId
    return sessionTabStatus({
      current,
      running: current ? live.running : thread.status === 'running',
      waiting: current && live.waiting,
      updatedAt: thread.updatedAt,
      ...(this.lastSeen.get(thread.id) ? { lastSeenAt: this.lastSeen.get(thread.id)! } : {})
    })
  }
}
