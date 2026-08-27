import type { ReactElement } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, CircleHelp, FileText, Folder, GitBranch, GitFork } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import { hasLivePendingUserInput } from '../store/chat-store-runtime-helpers'
import { formatRelativeTime } from '../lib/format-relative-time'
import { GIT_BRANCH_STATUS_CHANGED_EVENT } from '../lib/git-branch-status-event'
import { middleEllipsize } from '../lib/middle-ellipsize'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { SessionExportMenu } from './SessionExportMenu'
import {
  formatCompactNumber,
  formatCacheMissReason,
  formatCost,
  formatPercent,
  primaryCacheHitRate,
  useThreadUsage
} from '../hooks/use-thread-usage'

type Props = {
  compact?: boolean
  className?: string
  onOpenRequirementDraft?: () => void
}

const COMPACT_BRANCH_LABEL_MAX_LENGTH = 30

function CompactGitBranch({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const root = workspaceRoot.trim()
  const [branch, setBranch] = useState<string | null>(null)
  const [isRepository, setIsRepository] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (
      !root ||
      typeof window === 'undefined' ||
      typeof window.kunGui?.getGitBranches !== 'function'
    ) {
      setBranch(null)
      setIsRepository(false)
      return
    }
    try {
      const result = await window.kunGui.getGitBranches(root)
      if (!result.ok) {
        setBranch(null)
        setIsRepository(false)
        return
      }
      setBranch(result.currentBranch)
      setIsRepository(true)
    } catch {
      setBranch(null)
      setIsRepository(false)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const refreshForWorkspace = (event: Event): void => {
      const changedRoot = (event as CustomEvent<string>).detail?.trim()
      if (!changedRoot || changedRoot === root) void load()
    }
    const refreshOnFocus = (): void => {
      void load()
    }
    window.addEventListener(GIT_BRANCH_STATUS_CHANGED_EVENT, refreshForWorkspace)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.removeEventListener(GIT_BRANCH_STATUS_CHANGED_EVENT, refreshForWorkspace)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [load, root])

  if (!isRepository) return null

  const label = branch || t('gitDetached')
  const accessibleLabel = `${t('gitBranch')}: ${label}`

  return (
    <span
      className="session-header-compact-branch inline-flex min-w-0 max-w-[180px] shrink items-center gap-1 rounded-[var(--ds-radius-pill)] border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11px] font-medium leading-4 text-ds-muted"
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      <GitBranch className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 truncate">
        {middleEllipsize(label, COMPACT_BRANCH_LABEL_MAX_LENGTH)}
      </span>
    </span>
  )
}

export function SessionHeader({
  compact = false,
  className = '',
  onOpenRequirementDraft
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const busy = useChatStore((s) => s.busy)
  const blocks = useChatStore((s) => s.blocks)
  const currentTurnId = useChatStore((s) => s.currentTurnId)
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const workspaceLabel = useChatStore((s) => s.workspaceLabel)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const renameActiveThread = useChatStore((s) => s.renameActiveThread)

  const active = threads.find((th) => th.id === activeThreadId)
  const activeWorkspaceRoot = active?.workspace?.trim() || workspaceRoot.trim()
  const activeWorkspaceLabel = active?.workspace
    ? workspaceLabelFromPath(active.workspace)
    : workspaceLabel
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  // Usage stats are no longer shown in compact mode (the composer footer
  // already shows them in the chat route), so skip fetching there.
  const threadUsage = useThreadUsage(
    activeThreadId,
    runtimeConnection === 'ready' && !compact,
    `${active?.updatedAt ?? ''}:${busy ? 'busy' : 'idle'}`
  )
  const latestCacheHitRate = threadUsage ? primaryCacheHitRate(threadUsage) : null
  const forkedFromTitle = active?.forkedFromTitle?.trim() ?? ''
  const forkLabel =
    active?.forkedFromThreadId
      ? forkedFromTitle
        ? t('sessionForkedFrom', { title: forkedFromTitle })
        : t('sessionForked')
      : ''

  useEffect(() => {
    if (active) {
      setDraftTitle(active.title)
    } else {
      setDraftTitle('')
    }
    setEditing(false)
  }, [active])

  const commitTitle = (): void => {
    if (!active) {
      setEditing(false)
      return
    }
    const next = draftTitle.trim()
    if (!next || next === active.title) {
      setDraftTitle(active.title)
      setEditing(false)
      return
    }
    void renameActiveThread(next).finally(() => setEditing(false))
  }

  if (compact) {
    return (
      <div
        className={`session-header-compact flex min-h-0 min-w-0 flex-1 items-center gap-2 text-left ${className}`}
      >
        {active ? (
          <>
            <div className="session-header-compact-identity flex min-w-0 flex-1 items-center gap-2">
              <span
                className="session-header-compact-workspace inline-flex min-w-0 max-w-[min(36%,220px)] shrink items-center gap-1.5 text-[12px] font-medium leading-5 text-ds-faint"
                title={activeWorkspaceLabel}
              >
                <Folder className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{activeWorkspaceLabel}</span>
              </span>
              <CompactGitBranch key={activeWorkspaceRoot} workspaceRoot={activeWorkspaceRoot} />
              <ChevronRight
                className="session-header-compact-chevron h-3.5 w-3.5 shrink-0 text-ds-faint/70"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div
                className="session-header-compact-title min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-ds-ink"
                title={active.forkedFromThreadId ? `${active.title} · ${forkLabel}` : active.title}
              >
                {active.title}
              </div>
              {onOpenRequirementDraft ? (
                <button
                  type="button"
                  className="session-header-compact-requirement ds-no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--ds-radius-control)] border border-ds-border-muted bg-ds-card px-2 text-[11.5px] font-medium text-ds-muted transition hover:border-ds-border-strong hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                  onClick={onOpenRequirementDraft}
                  title={t('sddDraftTitle')}
                  aria-label={t('sddDraftTitle')}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} />
                  <span className="max-w-24 truncate">{t('sddDraftTitle')}</span>
                </button>
              ) : null}
              {active.forkedFromThreadId ? (
                <GitFork
                  className="session-header-compact-fork h-3.5 w-3.5 shrink-0 text-ds-faint"
                  strokeWidth={1.8}
                  aria-label={forkLabel}
                />
              ) : null}
            </div>
            <SessionExportMenu
              title={active.title}
              blocks={blocks}
              busy={busy}
              currentTurnId={currentTurnId}
              currentTurnUserId={currentTurnUserId}
            />
          </>
        ) : (
          <div className="session-header-compact-empty flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ds-faint">
            <Folder className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate">{workspaceLabel}</span>
            <CompactGitBranch key={workspaceRoot} workspaceRoot={workspaceRoot} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`flex min-h-[74px] min-w-0 flex-1 items-center gap-4 px-5 py-4 sm:px-6 ${className}`}>
      {active ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-ds-faint">
              <span>{activeWorkspaceLabel}</span>
              <span>·</span>
              <span className="capitalize">{active.mode}</span>
              <span>·</span>
              <span>{formatRelativeTime(active.updatedAt, i18n.language)}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2.5">
              {editing ? (
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-ds-border bg-ds-elevated px-3.5 py-2 text-[21px] font-semibold tracking-[-0.02em] text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => commitTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTitle()
                    }
                    if (e.key === 'Escape') {
                      setDraftTitle(active.title)
                      setEditing(false)
                    }
                  }}
                  aria-label={t('renameThreadHint')}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-[22px] font-semibold tracking-[-0.03em] text-ds-ink transition hover:text-accent"
                  title={t('renameThreadHint')}
                  onClick={() => setEditing(true)}
                >
                  {active.title}
                </button>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-ds-faint">
              <span className="inline-flex items-center rounded-full border border-ds-border bg-ds-subtle px-2.5 py-1 font-medium capitalize text-ds-muted">
                {active.mode}
              </span>
              {active.workspace ? (
                <span className="truncate rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1">
                  {active.workspace.split(/[/\\]/).pop()}
                </span>
              ) : null}
              {active.forkedFromThreadId ? (
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-accent/18 bg-accent/8 px-2.5 py-1 font-medium text-accent"
                  title={forkLabel}
                >
                  <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{forkLabel}</span>
                </span>
              ) : null}
              {threadUsage ? (
                <>
                  <span
                    className="inline-flex items-center rounded-full border border-ds-border bg-ds-subtle px-2.5 py-1 font-medium text-ds-muted"
                    title={t('sessionUsageTitle', { turns: threadUsage.turns })}
                  >
                    {t('sessionUsageTokens', {
                      tokens: formatCompactNumber(threadUsage.totalTokens)
                    })}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1 font-medium text-ds-muted">
                    {t('sessionUsageCost', {
                      cost: formatCost(threadUsage.costUsd, i18n.language, threadUsage.costCny)
                    })}
                  </span>
                  {latestCacheHitRate != null ? (
                    <span
                      className="inline-flex items-center rounded-full border border-ds-border bg-ds-card/70 px-2.5 py-1 font-medium text-ds-muted"
                      title={t('sessionUsageCacheTitleWithLatest', {
                        cache: formatPercent(threadUsage.cacheHitRate),
                        latestCache: formatPercent(latestCacheHitRate),
                        cacheableCache: formatPercent(threadUsage.lastTurnCacheableHitRate ?? null),
                        totalInputCache: formatPercent(threadUsage.lastTurnTotalInputHitRate ?? null),
                        cached: formatCompactNumber(threadUsage.cachedTokens),
                        miss: formatCompactNumber(threadUsage.cacheMissTokens),
                        reasons: threadUsage.cacheMissReasons?.map(formatCacheMissReason).join(', ') || '-',
                        suggestions: threadUsage.cacheSuggestions?.join(' ') || '-'
                      })}
                    >
                      {t('sessionUsageCache', { cache: formatPercent(latestCacheHitRate) })}
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-ds-faint">
            {workspaceLabel}
          </div>
          <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ds-ink">
            {t('noSessionSelected')}
          </div>
          <div className="mt-1 text-[13.5px] text-ds-faint">{t('sessionHeaderHint')}</div>
        </div>
      )}
      {busy ? (
        hasLivePendingUserInput(blocks) ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-500/25 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 motion-safe:animate-pulse dark:text-amber-100">
            <CircleHelp className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            {t('awaitingYourInput')}
          </span>
        ) : (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/18 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 dark:text-amber-100">
            {t('running')}
          </span>
        )
      ) : null}
    </div>
  )
}
