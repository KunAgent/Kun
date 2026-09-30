import { useEffect, useRef, useState } from 'react'
import type { ActivityRow } from '@shared/activity-row'
import type { PendingApprovalItem } from '@shared/ade-approvals'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'
import {
  buildAttentionItems,
  managerThreadOf,
  type MobileAttentionItem
} from './mobile-agents-attention'

/**
 * Hydrates the inline-resolvable data behind waiting activity rows (P3-19):
 * pending approvals per thread and the manager overview holding a worker's
 * open question. Fetches are deduplicated per row `updatedAt` — a resolved
 * wait disappears on the next feed change and re-fetches stay rare.
 */
export function useMobileAdeAttention(rows: Record<string, ActivityRow>): {
  items: MobileAttentionItem[]
  approvals: Record<string, PendingApprovalItem[]>
  overviews: Record<string, AdeTeamOverview | null>
  refresh: (key: string) => void
} {
  const [approvals, setApprovals] = useState<Record<string, PendingApprovalItem[]>>({})
  const [overviews, setOverviews] = useState<Record<string, AdeTeamOverview | null>>({})
  const inflight = useRef(new Set<string>())
  const seen = useRef(new Map<string, number>())

  useEffect(() => {
    const provider = getProvider()
    for (const row of Object.values(rows)) {
      if (row.visibility === 'archived' || !row.waitingReason) continue
      const stamp = Date.parse(row.updatedAt)
      if (row.waitingReason === 'approval' && provider.listPendingApprovals) {
        const key = `appr:${row.threadId}`
        if ((seen.current.get(key) ?? 0) >= stamp || inflight.current.has(key)) continue
        seen.current.set(key, stamp)
        inflight.current.add(key)
        void provider.listPendingApprovals(row.threadId)
          .then((list) => setApprovals((c) => ({ ...c, [row.threadId]: list })))
          .catch(() => undefined)
          .finally(() => inflight.current.delete(key))
      }
      if (row.waitingReason === 'question' && provider.getTeamOverview) {
        const manager = managerThreadOf(row)
        if (!manager) continue
        const key = `ov:${manager}`
        if ((seen.current.get(key) ?? 0) >= stamp || inflight.current.has(key)) continue
        seen.current.set(key, stamp)
        inflight.current.add(key)
        void provider.getTeamOverview(manager)
          .then((overview) => setOverviews((c) => ({ ...c, [manager]: overview })))
          .catch(() => undefined)
          .finally(() => inflight.current.delete(key))
      }
    }
  }, [rows])

  return {
    items: buildAttentionItems({ rows: Object.values(rows), approvals, overviews }),
    approvals,
    overviews,
    /** Drop the dedupe stamp so the next effect pass refetches that key. */
    refresh: (key) => { seen.current.delete(key) }
  }
}
