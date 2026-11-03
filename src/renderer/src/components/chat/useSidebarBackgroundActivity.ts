import { useMemo } from 'react'
import { useActivityStore } from '../../store/activity-store'
import {
  selectBackgroundActivityByThread,
  type BackgroundThreadActivity
} from '../../store/session-execution-summary'

/**
 * Background workers keep their sidebar row marked active after the turn's
 * reply has ended. Derived once per activity update rather than per row.
 */
export function useSidebarBackgroundActivity(): Record<string, BackgroundThreadActivity> {
  const rows = useActivityStore((state) => state.rows)
  return useMemo(() => selectBackgroundActivityByThread(rows), [rows])
}
