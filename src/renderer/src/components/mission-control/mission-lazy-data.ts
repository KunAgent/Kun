import { useEffect, useRef, useState } from 'react'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'

/**
 * Lazy card data for Mission Control (docs/ade/12 §5.3): task-workspace
 * file counts per bound thread plus team overviews per manager, fetched on
 * demand and shared across cards. Everything is best-effort — a missing
 * provider method or 404 resolves to null and the footer keeps its
 * reserved height instead of shifting layout.
 */
export type MissionLazyData = {
  /** unitId → changedFiles count (null = no bound workspace). */
  filesChanged: Record<string, number | null>
  /** managerThreadId → overview (null = not a manager / not found). */
  overviews: Record<string, AdeTeamOverview | null>
}

async function fetchFilesChanged(row: ActivityRow): Promise<number | null> {
  const provider = getProvider()
  if (!provider.listTaskWorkspaces) return null
  const response = await provider.listTaskWorkspaces({ boundThreadId: row.threadId })
  const record = [...response.records]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  return record ? record.changedFiles.length : null
}

async function fetchOverview(managerThreadId: string): Promise<AdeTeamOverview | null> {
  const provider = getProvider()
  if (!provider.getTeamOverview) return null
  return provider.getTeamOverview(managerThreadId)
}

export function useMissionLazyData(
  rows: ActivityRow[],
  expanded: ReadonlySet<string>
): MissionLazyData {
  const [data, setData] = useState<MissionLazyData>({ filesChanged: {}, overviews: {} })
  const inflightFiles = useRef(new Set<string>())
  const inflightOverviews = useRef(new Set<string>())

  useEffect(() => {
    const fileKeys = new Set<string>()
    const overviewKeys = new Set<string>()
    for (const row of rows) {
      fileKeys.add(row.unitId)
      if (row.parentThreadId || expanded.has(row.unitId)) {
        overviewKeys.add(row.parentThreadId ?? row.threadId)
      }
    }

    for (const row of rows) {
      if (!fileKeys.has(row.unitId)) continue
      if (inflightFiles.current.has(row.unitId)) continue
      if (data.filesChanged[row.unitId] !== undefined) continue
      inflightFiles.current.add(row.unitId)
      void fetchFilesChanged(row)
        .then((count) => {
          setData((current) =>
            current.filesChanged[row.unitId] !== undefined
              ? current
              : {
                  ...current,
                  filesChanged: { ...current.filesChanged, [row.unitId]: count }
                }
          )
        })
        .catch(() => undefined)
        .finally(() => inflightFiles.current.delete(row.unitId))
    }

    for (const managerThreadId of overviewKeys) {
      if (inflightOverviews.current.has(managerThreadId)) continue
      if (data.overviews[managerThreadId] !== undefined) continue
      inflightOverviews.current.add(managerThreadId)
      void fetchOverview(managerThreadId)
        .then((overview) => {
          setData((current) =>
            current.overviews[managerThreadId] !== undefined
              ? current
              : {
                  ...current,
                  overviews: { ...current.overviews, [managerThreadId]: overview }
                }
          )
        })
        .catch(() => undefined)
        .finally(() => inflightOverviews.current.delete(managerThreadId))
    }
  }, [rows, expanded, data])

  return data
}
