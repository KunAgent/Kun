import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  GitFork,
  Info,
  Loader2,
  Plus,
  Search,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  applyGitBranchPrefix,
  DEFAULT_GIT_BRANCH_PREFIX,
  normalizeGitBranchPrefix,
  type AppSettingsV1
} from '@shared/app-settings'
import type { GitBranchesResult, GitBranchRow } from '@shared/git-branches'
import { getProvider } from '../../agent/registry'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { notifyGitBranchStatusChanged } from '../../lib/git-branch-status-event'
import { middleEllipsize } from '../../lib/middle-ellipsize'
import {
  forgetThreadWorktree,
  markThreadWorktree,
  readThreadWorktreeRegistry,
  saveThreadWorktreeRegistry
} from '../../lib/thread-worktree-registry'
import { useChatStore } from '../../store/chat-store'
import { rememberCodeWorkspaceRoots } from '../../store/chat-store-helpers'
import { useGitBranchPickerPopover } from './use-git-branch-picker-popover'

const BRANCH_ROW_LABEL_MAX_LENGTH = 42
const BRANCH_TRIGGER_LABEL_MAX_LENGTH = 32
const BRANCH_FOOTER_LABEL_MAX_LENGTH = 34

type Props = {
  workspaceRoot: string
  useWorktreePool?: boolean
  worktreeBranch?: string
  onWorktreeBranchChange?: (branch: string) => void
  onToggleWorktreeMode?: () => void
}

type BranchTooltip = {
  text: string
  x: number
  y: number
}

function branchTooltipPosition(clientX: number, clientY: number): { x: number; y: number } {
  const width = Math.min(544, Math.max(0, window.innerWidth - 32))
  const x = Math.max(16, Math.min(clientX + 12, window.innerWidth - width - 16))
  const y = Math.max(16, Math.min(clientY + 14, window.innerHeight - 96))
  return { x, y }
}

export function GitBranchPicker({
  workspaceRoot,
  useWorktreePool = false,
  worktreeBranch = '',
  onWorktreeBranchChange,
  onToggleWorktreeMode
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const root = workspaceRoot.trim()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<GitBranchesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [actingBranch, setActingBranch] = useState<string | null>(null)
  const [actingKind, setActingKind] = useState<'switch' | 'worktree' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<BranchTooltip | null>(null)
  const [branchPrefix, setBranchPrefix] = useState(DEFAULT_GIT_BRANCH_PREFIX)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const closePanel = useCallback((): void => setOpen(false), [])
  const { panelRef, panelStyle, updatePanelPosition } = useGitBranchPickerPopover({
    open,
    anchorRef: wrapRef,
    onClose: closePanel
  })

  const load = useCallback(async (): Promise<void> => {
    if (!root || typeof window.kunGui?.getGitBranches !== 'function') return
    setLoading(true)
    setError(null)
    try {
      const next = await window.kunGui.getGitBranches(root)
      setResult(next)
      if (!next.ok) setError(next.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    setOpen(false)
    setQuery('')
    setResult(null)
    setError(null)
    setActingBranch(null)
    setActingKind(null)
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    const apply = (settings: Pick<AppSettingsV1, 'gitBranchPrefix'>): void => {
      if (!cancelled) setBranchPrefix(normalizeGitBranchPrefix(settings.gitBranchPrefix))
    }
    void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [load, open])

  useEffect(() => {
    if (!open) setTooltip(null)
  }, [open])

  const branches = useMemo(() => (result?.ok ? result.branches : []), [result])
  const filteredBranches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((branch) => branch.name.toLowerCase().includes(q))
  }, [branches, query])

  const trimmedQuery = query.trim()
  const createBranchName = applyGitBranchPrefix(trimmedQuery, branchPrefix)
  const switchTargetRow = branches.find((branch) => branch.name === trimmedQuery)
    ?? branches.find((branch) => branch.name === createBranchName)
    ?? null
  const canCreate = createBranchName.length > 0 && !switchTargetRow
  const canCreateWorktree = trimmedQuery.length > 0 && (canCreate || Boolean(switchTargetRow))
  const currentBranch = result?.ok ? result.currentBranch : null
  const selectedWorktreeBranch = worktreeBranch.trim() || currentBranch || ''
  const selectedBranch = useWorktreePool ? selectedWorktreeBranch : currentBranch || ''
  const label = selectedBranch || (result?.ok ? t('gitDetached') : t('gitBranchUnavailable'))
  const launchModeLabel = useWorktreePool
    ? t('composerLaunchIsolatedWorktreeShort')
    : t('composerLaunchCurrentDirectoryShort')
  const triggerBranchLabel = middleEllipsize(label, BRANCH_TRIGGER_LABEL_MAX_LENGTH)
  const launchSummary = useWorktreePool
    ? t('composerLaunchSummaryWorktree', { branch: label })
    : t('composerLaunchSummaryCurrentDirectory', { branch: label })
  const footerBranchLabel = middleEllipsize(createBranchName, BRANCH_FOOTER_LABEL_MAX_LENGTH)
  const footerCreateLabel = t('gitCreateNamedBranch', { branch: footerBranchLabel })
  const footerCreateTitle = t('gitCreateNamedBranch', { branch: createBranchName })
  const footerWorktreeBranch = canCreate ? createBranchName : switchTargetRow?.name ?? trimmedQuery
  const footerWorktreeTitle = t('gitNewBranchWorktree', { branch: footerWorktreeBranch })
  const showTooltip = useCallback((text: string, clientX: number, clientY: number): void => {
    if (!text.trim()) return
    setTooltip({ text, ...branchTooltipPosition(clientX, clientY) })
  }, [])
  const moveTooltip = useCallback((clientX: number, clientY: number): void => {
    setTooltip((current) => current ? { ...current, ...branchTooltipPosition(clientX, clientY) } : current)
  }, [])
  const hideTooltip = useCallback((): void => {
    setTooltip(null)
  }, [])

  useEffect(() => {
    if (!useWorktreePool || worktreeBranch.trim() || !currentBranch) return
    onWorktreeBranchChange?.(currentBranch)
  }, [currentBranch, onWorktreeBranchChange, useWorktreePool, worktreeBranch])

  const moveActiveThreadToWorktree = async (record: {
    projectPath: string
    worktreePath: string
    branch: string
  }): Promise<void> => {
    const activeThreadId = useChatStore.getState().activeThreadId
    if (!activeThreadId) return
    const provider = getProvider()
    if (typeof provider.updateThreadWorkspace === 'function') {
      await provider.updateThreadWorkspace(activeThreadId, record.worktreePath)
    }
    saveThreadWorktreeRegistry(
      markThreadWorktree(activeThreadId, {
        projectPath: record.projectPath,
        worktreePath: record.worktreePath,
        branch: record.branch,
        createdAt: new Date().toISOString()
      })
    )
    useChatStore.setState((state) => ({
      codeWorkspaceRoots: rememberCodeWorkspaceRoots(state.codeWorkspaceRoots, [record.projectPath]),
      threads: state.threads.map((thread) =>
        thread.id === activeThreadId ? { ...thread, workspace: record.worktreePath } : thread
      )
    }))
  }

  const switchBranch = async (branch: string): Promise<void> => {
    if (!root || !branch) return
    setActingBranch(branch)
    setActingKind('switch')
    setError(null)
    try {
      const next = await window.kunGui.switchGitBranch(root, branch)
      setResult(next)
      if (!next.ok) {
        setError(next.message)
        return
      }
      notifyGitBranchStatusChanged(root)
      setOpen(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActingBranch(null)
      setActingKind(null)
    }
  }

  // A branch already checked out in another worktree can't be switched to in
  // place (git forbids the same branch in two worktrees). Navigate the active
  // conversation to that checkout instead of running a doomed `git switch`.
  const navigateToWorktree = async (branch: GitBranchRow): Promise<void> => {
    const worktreePath = branch.worktreePath
    if (!worktreePath) return
    const activeThreadId = useChatStore.getState().activeThreadId
    if (!activeThreadId) return
    setActingBranch(branch.name)
    setActingKind('switch')
    setError(null)
    try {
      const provider = getProvider()
      if (typeof provider.updateThreadWorkspace === 'function') {
        await provider.updateThreadWorkspace(activeThreadId, worktreePath)
      }
      const projectPath = result?.ok ? result.primaryRepositoryRoot : worktreePath
      const registry = readThreadWorktreeRegistry()
      saveThreadWorktreeRegistry(
        branch.worktreePrimary
          ? forgetThreadWorktree(activeThreadId, registry)
          : markThreadWorktree(
              activeThreadId,
              { projectPath, worktreePath, branch: branch.name, createdAt: new Date().toISOString() },
              registry
            )
      )
      useChatStore.setState((state) => ({
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(state.codeWorkspaceRoots, [projectPath]),
        threads: state.threads.map((thread) =>
          thread.id === activeThreadId ? { ...thread, workspace: worktreePath } : thread
        )
      }))
      setOpen(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActingBranch(null)
      setActingKind(null)
    }
  }

  const selectBranch = (branch: GitBranchRow): void => {
    if (useWorktreePool) {
      onWorktreeBranchChange?.(branch.name)
      setQuery('')
      return
    }
    if (branch.worktreePath) {
      void navigateToWorktree(branch)
    } else {
      void switchBranch(branch.name)
    }
  }

  const toggleWorktreeMode = (): void => {
    if (!onToggleWorktreeMode) return
    if (!useWorktreePool && !worktreeBranch.trim() && currentBranch) {
      onWorktreeBranchChange?.(currentBranch)
    }
    onToggleWorktreeMode()
  }

  const createAndSwitchBranch = async (): Promise<void> => {
    const branch = createBranchName
    if (!root || !branch) return
    setActingBranch(branch)
    setActingKind('switch')
    setError(null)
    try {
      const next = await window.kunGui.createAndSwitchGitBranch(root, branch)
      setResult(next)
      if (!next.ok) {
        setError(next.message)
        return
      }
      notifyGitBranchStatusChanged(root)
      setOpen(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActingBranch(null)
      setActingKind(null)
    }
  }

  const checkoutBranchWorktree = async (branch: string): Promise<void> => {
    if (!root || !branch) return
    setActingBranch(branch)
    setActingKind('worktree')
    setError(null)
    try {
      const next = await window.kunGui.checkoutGitBranchWorktree(root, branch)
      setResult(next)
      if (!next.ok) {
        setError(next.message)
        return
      }
      await moveActiveThreadToWorktree({
        projectPath: next.sourceRepositoryRoot,
        worktreePath: next.worktreePath,
        branch: next.currentBranch ?? branch
      })
      notifyGitBranchStatusChanged(next.worktreePath)
      setOpen(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActingBranch(null)
      setActingKind(null)
    }
  }

  const createBranchWorktree = async (): Promise<void> => {
    const branch = createBranchName
    if (!root || !branch) return
    setActingBranch(branch)
    setActingKind('worktree')
    setError(null)
    try {
      const next = await window.kunGui.createGitBranchWorktree(root, branch)
      setResult(next)
      if (!next.ok) {
        setError(next.message)
        return
      }
      await moveActiveThreadToWorktree({
        projectPath: next.sourceRepositoryRoot,
        worktreePath: next.worktreePath,
        branch: next.currentBranch ?? branch
      })
      notifyGitBranchStatusChanged(next.worktreePath)
      setOpen(false)
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActingBranch(null)
      setActingKind(null)
    }
  }

  if (!root) return null

  return (
    <div ref={wrapRef} className="ds-git-branch-picker ds-no-drag relative flex min-w-0">
      <button
        type="button"
        data-composer-launch-settings-trigger
        data-composer-launch-mode={useWorktreePool ? 'worktree' : 'current-directory'}
        className="flex h-8 max-w-[360px] min-w-0 items-center gap-2 rounded-lg px-2 text-[14px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => {
          updatePanelPosition()
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('composerLaunchTriggerLabel', { branch: label, mode: launchModeLabel })}
      >
        <GitBranch className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        {/* The branch name gives way first so the launch mode stays readable. */}
        <span className="flex min-w-0">
          <span className="min-w-0 truncate">{triggerBranchLabel}</span>
          <span className="max-w-full shrink-0 truncate pl-1">· {launchModeLabel}</span>
        </span>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={panelRef}
          data-composer-launch-settings-panel
          role="dialog"
          aria-label={t('composerLaunchSettingsTitle')}
          style={panelStyle}
          className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-2xl border border-ds-border bg-ds-elevated shadow-[0_24px_70px_rgba(44,55,78,0.18)] backdrop-blur-xl dark:shadow-[0_30px_80px_rgba(0,0,0,0.42)]"
        >
          <div className="flex items-center justify-between gap-4 border-b border-ds-border-muted px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-ds-ink">
                {t('composerLaunchSettingsTitle')}
              </div>
              <div className="mt-0.5 text-[12px] leading-5 text-ds-faint">
                {t('composerLaunchSettingsDescription')}
              </div>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              title={t('close')}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="px-4 pb-2 pt-3">
            <div className="mb-2 text-[13px] font-semibold text-ds-ink">
              {t('composerLaunchStartingBranch')}
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 focus-within:border-accent/45 focus-within:ring-2 focus-within:ring-accent/10">
              <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                  if (e.key === 'Enter') {
                    if (useWorktreePool && switchTargetRow) {
                      e.preventDefault()
                      selectBranch(switchTargetRow)
                    } else if (!useWorktreePool && canCreate) {
                      e.preventDefault()
                      void createAndSwitchBranch()
                    } else if (switchTargetRow) {
                      e.preventDefault()
                      selectBranch(switchTargetRow)
                    }
                  }
                }}
                placeholder={t('gitSearchBranches')}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto px-3 pb-3">
            {loading && !result ? (
              <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-ds-muted">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                {t('gitBranchLoading')}
              </div>
            ) : null}

            {error ? (
              <div className="mb-2 flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-100">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            ) : null}

            {filteredBranches.map((branch) => {
              const isActing = actingBranch === branch.name
              const selected = useWorktreePool
                ? branch.name === selectedWorktreeBranch
                : branch.current
              const branchActionLabel = useWorktreePool
                ? t('composerLaunchSelectWorktreeBranch', { branch: branch.name })
                : branch.worktreePath
                  ? t('gitOpenExistingWorktree', { branch: branch.name })
                  : t('gitSwitchToNamedBranch', { branch: branch.name })
              return (
                <div
                  key={branch.name}
                  className="group/branch flex w-full items-start gap-1 rounded-lg pr-1 transition hover:bg-ds-hover"
                >
                  <button
                    type="button"
                    data-composer-launch-branch={branch.name}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-1 py-2.5 text-left text-ds-ink"
                    onClick={() => selectBranch(branch)}
                    disabled={actingBranch != null || selected}
                    aria-label={branchActionLabel}
                    onPointerEnter={(event) =>
                      showTooltip(branchActionLabel, event.clientX, event.clientY)
                    }
                    onPointerMove={(event) => moveTooltip(event.clientX, event.clientY)}
                    onPointerLeave={hideTooltip}
                    onPointerCancel={hideTooltip}
                  >
                    <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">
                        {middleEllipsize(branch.name, BRANCH_ROW_LABEL_MAX_LENGTH)}
                      </span>
                      {branch.current && result?.ok && result.dirtyCount > 0 ? (
                        <span className="mt-0.5 block text-[12px] text-ds-faint">
                          {t('gitDirtyFiles', { count: result.dirtyCount })}
                        </span>
                      ) : branch.worktreePath ? (
                        <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                          {t('gitCheckedOutInWorktree')}
                        </span>
                      ) : null}
                    </span>
                    {isActing && actingKind === 'switch' ? (
                      <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
                    ) : selected ? (
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" strokeWidth={2} />
                    ) : null}
                  </button>
                  {!useWorktreePool ? (
                    <button
                      type="button"
                      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink focus-visible:opacity-100 group-hover/branch:opacity-100 disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={() => void checkoutBranchWorktree(branch.name)}
                      disabled={actingBranch != null}
                      aria-label={t('gitOpenBranchWorktree', { branch: branch.name })}
                      onPointerEnter={(event) =>
                        showTooltip(t('gitOpenBranchWorktree', { branch: branch.name }), event.clientX, event.clientY)
                      }
                      onPointerMove={(event) => moveTooltip(event.clientX, event.clientY)}
                      onPointerLeave={hideTooltip}
                      onPointerCancel={hideTooltip}
                    >
                      {isActing && actingKind === 'worktree' ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                      ) : (
                        <GitFork className="h-4 w-4" strokeWidth={1.8} />
                      )}
                    </button>
                  ) : null}
                </div>
              )
            })}

            {!loading && result?.ok && filteredBranches.length === 0 ? (
              <div className="px-1 py-3 text-[13px] text-ds-faint">{t('gitNoBranches')}</div>
            ) : null}
          </div>

          {!useWorktreePool && canCreateWorktree ? (
            <div className="flex items-center gap-1 border-t border-ds-border-muted px-3 py-3">
              {canCreate ? (
                <button
                  type="button"
                  disabled={actingBranch != null}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-[14px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                  aria-label={footerCreateTitle}
                  onPointerEnter={(event) => showTooltip(footerCreateTitle, event.clientX, event.clientY)}
                  onPointerMove={(event) => moveTooltip(event.clientX, event.clientY)}
                  onPointerLeave={hideTooltip}
                  onPointerCancel={hideTooltip}
                  onClick={() => {
                    hideTooltip()
                    void createAndSwitchBranch()
                  }}
                >
                  {actingBranch === createBranchName && actingKind === 'switch' ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 truncate">{footerCreateLabel}</span>
                </button>
              ) : (
                <div className="min-w-0 flex-1 truncate px-1 py-2 text-[14px] font-medium text-ds-muted">
                  {middleEllipsize(trimmedQuery, BRANCH_FOOTER_LABEL_MAX_LENGTH)}
                </div>
              )}
              <button
                type="button"
                disabled={actingBranch != null}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={footerWorktreeTitle}
                onPointerEnter={(event) => showTooltip(footerWorktreeTitle, event.clientX, event.clientY)}
                onPointerMove={(event) => moveTooltip(event.clientX, event.clientY)}
                onPointerLeave={hideTooltip}
                onPointerCancel={hideTooltip}
                onClick={() => {
                  hideTooltip()
                  if (canCreate) {
                    void createBranchWorktree()
                  } else {
                    void checkoutBranchWorktree(footerWorktreeBranch)
                  }
                }}
              >
                {actingBranch === footerWorktreeBranch && actingKind === 'worktree' ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <GitFork className="h-4 w-4" strokeWidth={1.8} />
                )}
              </button>
            </div>
          ) : null}

          <div className="border-t border-ds-border-muted px-4 py-3">
            <div className="mb-2 text-[13px] font-semibold text-ds-ink">
              {t('composerLaunchWorkspaceMode')}
            </div>
            <button
              type="button"
              data-composer-worktree-mode-toggle
              disabled={!onToggleWorktreeMode}
              onClick={toggleWorktreeMode}
              className="flex w-full items-center gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-3 text-left transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ds-card"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-hover text-ds-muted">
                <GitFork className="h-4.5 w-4.5" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ds-ink">
                  {t('composerLaunchUseIsolatedWorktree')}
                </span>
                <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                  {t('composerLaunchUseIsolatedWorktreeDescription')}
                </span>
              </span>
              <span
                role="switch"
                aria-checked={useWorktreePool}
                aria-label={t('composerLaunchUseIsolatedWorktree')}
                className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${
                  useWorktreePool
                    ? 'bg-accent ring-accent/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                    : 'bg-ds-border-muted ring-ds-border-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${
                    useWorktreePool ? 'translate-x-[17px]' : 'translate-x-0.5'
                  } shadow-[0_1px_4px_rgba(20,47,95,0.28)]`}
                />
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 border-t border-ds-border-muted bg-ds-card/50 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-[12px] leading-5 text-ds-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
              <span className="min-w-0">{launchSummary}</span>
            </div>
            <button
              type="button"
              className="h-9 shrink-0 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-105"
              onClick={() => setOpen(false)}
            >
              {t('composerLaunchDone')}
            </button>
          </div>
        </div>,
        document.body
      ) : null}
      {tooltip ? createPortal(
        <div
          className="pointer-events-none fixed z-[9999] max-w-[min(34rem,calc(100vw-2rem))] break-all rounded-lg border border-ds-border bg-ds-elevated px-2.5 py-1.5 text-[12px] font-medium leading-5 text-ds-ink shadow-[0_14px_36px_rgba(15,23,42,0.22)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>,
        document.body
      ) : null}
    </div>
  )
}
