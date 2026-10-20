import { useEffect, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitChangeEntry, GitChangeSide, GitFileDiffResult } from '@shared/git-commit'
import { DiffView } from '../../DiffView'
import { gitCommitApi } from './use-git-working-state'

/** Diff of the selected file, refetched whenever the working state reloads. */
export function GitDiffPreview({
  workspaceRoot,
  side,
  entry,
  mergeBase,
  revision
}: {
  workspaceRoot: string
  side: GitChangeSide
  entry: GitChangeEntry
  mergeBase?: string
  revision: number
}): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<{ key: string; value: GitFileDiffResult } | null>(null)
  // A reload keeps showing the last diff of the same file until the new one arrives.
  const key = [workspaceRoot, side, entry.path, entry.previousPath ?? '', entry.status, mergeBase ?? ''].join('\n')

  useEffect(() => {
    const api = gitCommitApi()
    if (!api) return
    let cancelled = false
    void api.getGitFileDiff({
      workspaceRoot,
      side,
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      ...(mergeBase ? { mergeBase } : {}),
      ...(entry.status === 'untracked' ? { untracked: true } : {})
    }).then((value) => {
      if (!cancelled) setResult({ key, value })
    }).catch((error: unknown) => {
      if (!cancelled) setResult({ key, value: { ok: false, message: error instanceof Error ? error.message : String(error) } })
    })
    return () => {
      cancelled = true
    }
    // `key` folds every input that changes the request.
  }, [key, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = result?.key === key ? result.value : null
  const note = (text: string): ReactElement => (
    <div className="flex h-full items-center justify-center rounded-[10px] border border-ds-border-muted bg-ds-card px-4 text-center text-[12px] text-ds-muted">
      {text}
    </div>
  )
  if (!current) {
    return (
      <div className="flex h-full items-center justify-center gap-2 rounded-[10px] border border-ds-border-muted bg-ds-card text-[12px] text-ds-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    )
  }
  if (!current.ok) return note(t('changesDiffLoadFailed', { message: current.message }))
  if (current.binary) return note(t('changesDiffBinary'))
  if (!current.diff.trim()) return note(t('changesDiffEmpty'))
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <DiffView patch={current.diff} filePath={entry.path} maxHeight={9999} className="min-h-0 flex-1 !rounded-[10px]" />
      {current.truncated ? <p className="shrink-0 px-1 text-[11px] text-ds-muted">{t('changesDiffTruncated')}</p> : null}
    </div>
  )
}
