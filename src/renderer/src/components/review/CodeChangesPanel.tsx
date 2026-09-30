import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { useActivityStore } from '../../store/activity-store'
import { ChangeInspector } from '../ChangeInspector'
import { ReviewPanel } from './ReviewPanel'

type Props = {
  changes: ComponentProps<typeof ChangeInspector>
  className?: string
  active?: boolean
}

/** One changes entry: conversation patches and explicitly selected task workspaces. */
export function CodeChangesPanel({ changes, className, active = true }: Props): ReactElement {
  const { t } = useTranslation('common')
  const threadId = useChatStore((s) => s.activeThreadId)
  const [records, setRecords] = useState<TaskWorkspaceRecord[]>([])
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null)
  const [boundId, setBoundId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const activityStamp = useActivityStore((s) => Object.values(s.rows)
    .filter((row) => row.threadId === threadId || row.parentThreadId === threadId)
    .map((row) => `${row.unitId}:${row.state}:${row.stateSince}`)
    .sort().join('|'))

  useEffect(() => {
    generation.current += 1
    setRecords([])
    setLoadedThreadId(null)
    setBoundId(null)
    setError(null)
  }, [threadId])

  useEffect(() => {
    if (!active || !threadId) return
    const list = getProvider().listTaskWorkspaces
    if (!list) return
    const request = ++generation.current
    const timer = setTimeout(() => {
      void Promise.all([
        list({ ownerThreadId: threadId }),
        list({ boundThreadId: threadId })
      ]).then(([owned, bound]) => {
        if (request !== generation.current) return
        const byId = new Map<string, TaskWorkspaceRecord>()
        for (const record of [...owned.records, ...bound.records]) {
          if (['removed', 'orphaned'].includes(record.state)) continue
          byId.set(record.workspaceId, record)
        }
        setRecords([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setLoadedThreadId(threadId)
        const ownBindings = bound.records.filter((record) => byId.has(record.workspaceId) &&
          (record.unitId === threadId || (!record.unitId && record.ownerThreadId === threadId)))
        setBoundId(ownBindings.sort((a, b) =>
          Number(b.unitId === threadId) - Number(a.unitId === threadId) ||
          b.updatedAt.localeCompare(a.updatedAt))[0]?.workspaceId ?? null)
        setError(null)
      }).catch((failure: unknown) => {
        if (request === generation.current) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })
    }, 150)
    return () => {
      clearTimeout(timer)
      generation.current += 1
    }
  }, [threadId, activityStamp, active])

  const currentRecords = loadedThreadId === threadId ? records : []
  const selectedId = threadId
    ? choices[threadId] ?? (loadedThreadId === threadId ? boundId : null) ?? 'conversation'
    : 'conversation'
  const selected = currentRecords.find((record) => record.workspaceId === selectedId)
  const hasWorkspaceChoice = currentRecords.length > 0 || selectedId !== 'conversation'

  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ''}`} data-code-changes-panel>
      {hasWorkspaceChoice ? (
        <label className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2 text-[12px] text-ds-muted">
          <span className="shrink-0">{t('codeChangesTarget')}</span>
          <select
            value={selectedId}
            aria-label={t('codeChangesTarget')}
            onChange={(event) => {
              const value = event.target.value
              if (threadId) setChoices((current) => ({ ...current, [threadId]: value }))
            }}
            className="min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-main px-2 py-1 text-ds-ink"
          >
            <option value="conversation">{t('codeChangesConversation')}</option>
            {currentRecords.map((record) => (
              <option key={record.workspaceId} value={record.workspaceId}>
                {record.label || record.branch || record.workspaceId}
              </option>
            ))}
            {selectedId !== 'conversation' && !selected ? (
              <option value={selectedId}>{t('codeChangesUnavailable')}</option>
            ) : null}
          </select>
        </label>
      ) : null}
      {error ? <p role="status" className="shrink-0 px-3 py-2 text-[12px] text-ds-muted">{error}</p> : null}
      <div className="min-h-0 flex-1">
        {!active ? null : selected ? (
          <ReviewPanel key={selected.workspaceId} workspace={selected} threadId={selected.unitId ?? selected.ownerThreadId} className="h-full" />
        ) : selectedId === 'conversation' ? (
          <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
        ) : (
          <p className="px-4 py-6 text-[12px] text-ds-muted">{t('codeChangesUnavailable')}</p>
        )}
      </div>
    </div>
  )
}
