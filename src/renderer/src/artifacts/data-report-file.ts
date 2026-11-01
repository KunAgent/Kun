import { useEffect, useState } from 'react'
import { DataReportFileSchema, type DataReportFile } from '../../../../kun/src/contracts/data-report'

export function parseDataReportFile(raw: string): DataReportFile | null {
  try {
    const parsed = DataReportFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type DataReportFileState =
  | { status: 'loading' }
  | { status: 'ready'; report: DataReportFile }
  | { status: 'error' }

const cache = new Map<string, DataReportFile>()
const CACHE_LIMIT = 40

/**
 * Reads a saved `.kun-reports/<id>.json`. `version` (the artifact's mtime or
 * the tool result's updatedAt) keys the cache, so a newer revision is re-read.
 */
export function useDataReportFile(
  target: { workspaceRoot: string; path: string; version?: string | number } | null
): DataReportFileState {
  const key = target ? `${target.workspaceRoot}\0${target.path}\0${target.version ?? ''}` : ''
  const [state, setState] = useState<DataReportFileState>(() => {
    const cached = key ? cache.get(key) : undefined
    return cached ? { status: 'ready', report: cached } : { status: 'loading' }
  })
  useEffect(() => {
    if (!target || !key) return
    const cached = cache.get(key)
    if (cached) { setState({ status: 'ready', report: cached }); return }
    let cancelled = false
    setState({ status: 'loading' })
    const read = window.kunGui?.readWorkspaceFile
    if (!read) { setState({ status: 'error' }); return }
    void read({ workspaceRoot: target.workspaceRoot, path: target.path })
      .then((result) => {
        if (cancelled) return
        const report = result.ok && !result.truncated ? parseDataReportFile(result.content) : null
        if (!report) { setState({ status: 'error' }); return }
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
        cache.set(key, report)
        setState({ status: 'ready', report })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
    // The key captures every field of target that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}
