import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { useActivityStore } from '../../store/activity-store'
import { ChangeInspector } from '../ChangeInspector'
import { ReviewPanel } from './ReviewPanel'
import { ChangeSourcePicker, type ChangeSourceGroup } from './commit/ChangeSourcePicker'
import { CommitBox } from './commit/CommitBox'
import { GitBranchStatus } from './commit/GitBranchStatus'
import { GitBranchView } from './commit/GitBranchView'
import { GitChangesView } from './commit/GitChangesView'
import { conversationFileCount, isConversationSource, isGitSource, lastTurnBlocks } from './commit/change-source'
import { useGitWorkingState } from './commit/use-git-working-state'

const DRAFT_CHOICE = ':new-task'

type Props = {
  changes: ComponentProps<typeof ChangeInspector>
  className?: string
  active?: boolean
}

/**
 * One changes entry: the conversation's patches, the repository's unstaged /
 * staged / branch changes with a commit box, and explicitly selected task
 * workspaces.
 */
export function CodeChangesPanel({ changes, className, active = true }: Props): ReactElement {
  const { t } = useTranslation('common')
  const threadId = useChatStore((s) => s.activeThreadId)
  const sharedWorkspaceRoot = useChatStore((s) => s.workspaceRoot)
  const workspaceRoot = changes.workspaceRoot ?? sharedWorkspaceRoot
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
  const blocks = useMemo(() => changes.blocks ?? [], [changes.blocks])
  const conversationCount = useMemo(() => conversationFileCount(blocks), [blocks])
  const turnBlocks = useMemo(() => lastTurnBlocks(blocks), [blocks])
  const turnCount = useMemo(() => conversationFileCount(turnBlocks), [turnBlocks])
  const git = useGitWorkingState(workspaceRoot || null, active, `${activityStamp}#${conversationCount}`)
  const gitState = git.state?.ok ? git.state : null

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
  // A new task has no thread yet; its choice is kept under a draft key.
  const choiceKey = threadId ?? DRAFT_CHOICE
  const selectedId = choices[choiceKey] ??
    (threadId && loadedThreadId === threadId ? boundId : null) ?? 'conversation'
  const selected = currentRecords.find((record) => record.workspaceId === selectedId)
  const onWorkingTree = !selected && (isConversationSource(selectedId) || isGitSource(selectedId))
  const { refresh: refreshGit } = git
  useEffect(() => {
    if (isGitSource(selectedId)) refreshGit()
  }, [selectedId, refreshGit])
  const files = (count: number): string => t('changesFileCount', { count })

  const groups: ChangeSourceGroup[] = [
    {
      id: 'conversation',
      label: t('changesSourceGroupConversation'),
      options: [
        { id: 'conversation', label: t('changesSourceConversation'), hint: t('changesSourceConversationHint'), detail: files(conversationCount) },
        { id: 'last-turn', label: t('changesSourceLastTurn'), hint: t('changesSourceLastTurnHint'), detail: files(turnCount) }
      ]
    },
    ...(gitState ? [{
      id: 'git',
      label: gitState.branch ? `Git · ${gitState.branch}` : 'Git',
      options: [
        { id: 'git-unstaged', label: t('changesSourceUnstaged'), hint: t('changesSourceUnstagedHint'), detail: files(gitState.unstaged.length) },
        { id: 'git-staged', label: t('changesSourceStaged'), hint: t('changesSourceStagedHint'), detail: files(gitState.staged.length) },
        { id: 'git-branch', label: t('changesSourceBranch'), hint: t('changesSourceBranchHint') }
      ]
    }] : []),
    ...(currentRecords.length || (!onWorkingTree && !selected) ? [{
      id: 'workspaces',
      label: t('changesSourceGroupWorkspaces'),
      options: [
        ...currentRecords.map((record) => ({
          id: record.workspaceId,
          label: record.label || record.branch || record.workspaceId,
          ...(record.branch && record.label ? { hint: record.branch, mono: true } : {}),
          detail: t(`reviewWorkspaceState.${record.state}`)
        })),
        ...(!onWorkingTree && !selected ? [{ id: selectedId, label: t('codeChangesUnavailable') }] : [])
      ]
    }] : [])
  ]

  const content = (): ReactElement | null => {
    if (!active) return null
    if (selected) {
      return <ReviewPanel key={selected.workspaceId} workspace={selected} threadId={selected.unitId ?? selected.ownerThreadId} className="h-full" />
    }
    if (selectedId === 'conversation') return <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
    if (selectedId === 'last-turn') {
      return <ChangeInspector {...changes} blocks={turnBlocks} isolated className="h-full max-h-full w-full flex-col" />
    }
    if (isGitSource(selectedId)) {
      if (!workspaceRoot || (git.state && !git.state.ok)) {
        return <p className="px-4 py-6 text-[12px] text-ds-muted">{git.state && !git.state.ok && git.state.reason !== 'not_git_repo' ? git.state.message : t('changesNotGit')}</p>
      }
      if (!gitState) return null
      return selectedId === 'git-branch'
        ? <GitBranchView workspaceRoot={workspaceRoot} state={gitState} revision={git.revision} />
        : <GitChangesView workspaceRoot={workspaceRoot} side={selectedId === 'git-staged' ? 'staged' : 'unstaged'} state={gitState} revision={git.revision} onChanged={git.refresh} />
    }
    return <p className="px-4 py-6 text-[12px] text-ds-muted">{t('codeChangesUnavailable')}</p>
  }

  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ''}`} data-code-changes-panel>
      <div className="flex shrink-0 flex-col gap-2 border-b border-ds-border-muted bg-ds-sidebar px-3 py-2">
        <div className="flex items-center gap-1">
          <ChangeSourcePicker
            label={t('changesSourceLabel')}
            groups={groups}
            value={selectedId}
            onChange={(value) => setChoices((current) => ({ ...current, [choiceKey]: value }))}
          />
          {gitState && onWorkingTree ? (
            <button
              type="button"
              onClick={git.refresh}
              aria-label={t('changesRefresh')}
              title={t('changesRefresh')}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        {gitState && onWorkingTree ? <GitBranchStatus state={gitState} /> : null}
      </div>
      {error ? <p role="status" className="shrink-0 px-3 py-2 text-[12px] text-ds-muted">{error}</p> : null}
      <div className="min-h-0 flex-1">{content()}</div>
      {active && gitState && onWorkingTree && workspaceRoot ? (
        <CommitBox workspaceRoot={workspaceRoot} state={gitState} onChanged={git.refresh} />
      ) : null}
    </div>
  )
}
