import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Folder, FolderPlus, Loader2, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import type { TaskWorkspacePrep } from '../../store/task-workspace-store'
import { ensureThreadBinding, useReviewStore } from '../../store/review-store'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { readThreadWorktreeRegistry } from '../../lib/thread-worktree-registry'
import { buildWorkspaceProjectPickerOptions } from './WorkspaceProjectPicker'
import { useComposerPickerPopover } from './use-composer-picker-popover'

type Props = {
  workspaceRoot: string
  activeThreadId: string | null
  threadWorkspaceRoot?: string
  threadTaskWorkspaceId?: string
  prep?: TaskWorkspacePrep
  disabledReason?: string
}

/** ADE's project picker keeps the Code project catalog but uses ADE navigation actions. */
export function AdeWorkspaceProjectPicker({
  workspaceRoot,
  activeThreadId,
  threadWorkspaceRoot,
  threadTaskWorkspaceId,
  prep,
  disabledReason
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const conversationWorkspaceRoot = useChatStore((s) => s.conversationWorkspaceRoot)
  const removedCodeWorkspaces = useChatStore((s) => s.removedCodeWorkspaces)
  const selectAdeWorkspaceRoot = useChatStore((s) => s.selectAdeWorkspaceRoot)
  const chooseAdeWorkspace = useChatStore((s) => s.chooseAdeWorkspace)
  const binding = useReviewStore((s) => activeThreadId ? s.bindings[activeThreadId] : undefined)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState(false)
  const pending = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuId = 'ade-workspace-project-menu'

  useEffect(() => {
    if (activeThreadId && threadTaskWorkspaceId && !prep?.sourceRoot) {
      void ensureThreadBinding(activeThreadId)
    }
  }, [activeThreadId, prep?.sourceRoot, threadTaskWorkspaceId])

  const executionRoot = normalizeWorkspaceRoot(threadWorkspaceRoot ?? '')
  const sourceRoot = normalizeWorkspaceRoot(activeThreadId
    ? threadTaskWorkspaceId
      ? prep?.sourceRoot || binding?.sourceRoot || (binding === null ? executionRoot : '')
      : threadWorkspaceRoot ?? ''
    : workspaceRoot)
  const sourceLoading = Boolean(activeThreadId && threadTaskWorkspaceId && !sourceRoot && binding === undefined)
  const sourceUnavailable = Boolean(activeThreadId && threadTaskWorkspaceId && !prep?.sourceRoot && binding === null)
  const { currentRoot, options } = useMemo(() => buildWorkspaceProjectPickerOptions({
    currentWorkspaceRoot: sourceRoot,
    workspaceRoots: codeWorkspaceRoots,
    threadWorktrees: readThreadWorktreeRegistry().worktrees,
    conversationWorkspaceRoot,
    removedCodeWorkspaces
  }), [codeWorkspaceRoots, conversationWorkspaceRoot, removedCodeWorkspaces, sourceRoot])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? options.filter((option) => option.label.toLowerCase().includes(normalized) ||
          option.root.toLowerCase().includes(normalized))
      : options
  }, [options, query])

  const closeMenu = useCallback((): void => { setOpen(false); setQuery('') }, [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: closeMenu,
    preferredWidth: 340,
    estimatedHeight: 380,
    maximumHeight: 480
  })
  useEffect(() => {
    if (open && options.length > 5) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, options.length])

  const select = async (root: string): Promise<void> => {
    if (pending.current || disabledReason) return
    if (workspaceRootIdentityKey(root) === workspaceRootIdentityKey(currentRoot)) {
      closeMenu()
      return
    }
    pending.current = true
    setActing(true)
    try {
      const selected = await selectAdeWorkspaceRoot(root)
      if (selected) closeMenu()
    } finally {
      pending.current = false
      setActing(false)
    }
  }

  const browse = async (): Promise<void> => {
    if (pending.current || disabledReason) return
    pending.current = true
    setActing(true)
    try {
      const selected = await chooseAdeWorkspace()
      if (selected) closeMenu()
    } finally {
      pending.current = false
      setActing(false)
    }
  }

  const label = sourceLoading
    ? t('adeWorkspace.loadingProject')
    : sourceRoot ? workspaceLabelFromPath(sourceRoot) : t('selectWorkspace')
  const pathTitle = [sourceUnavailable ? t('adeWorkspace.sourceUnavailable') : sourceRoot,
    executionRoot && (executionRoot !== sourceRoot || sourceUnavailable)
      ? t('adeWorkspace.executionPath', { path: executionRoot }) : ''].filter(Boolean).join('\n')
  const blocked = Boolean(disabledReason || acting)

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t('adeWorkspace.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      className="ds-no-drag fixed z-50 overflow-hidden rounded-xl border border-ds-border bg-ds-elevated shadow-[0_24px_70px_rgba(44,55,78,0.18)]"
      data-ade-workspace-menu
    >
      <div className="border-b border-ds-border-muted px-3 py-2 text-xs font-medium text-ds-faint">
        {activeThreadId ? t('adeWorkspace.switchHint') : t('adeWorkspace.title')}
      </div>
      {options.length > 5 ? (
        <div className="flex items-center gap-2 border-b border-ds-border-muted px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('composerWorkspaceSearch')}
            aria-label={t('composerWorkspaceSearch')}
            className="min-w-0 flex-1 bg-transparent text-sm text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </div>
      ) : null}
      {disabledReason ? (
        <p className="mx-3 mt-2 rounded-md bg-ds-subtle px-2 py-1.5 text-xs text-ds-muted" role="status">
          {disabledReason}
        </p>
      ) : null}
      {sourceUnavailable ? (
        <p className="mx-3 mt-2 rounded-md bg-ds-subtle px-2 py-1.5 text-xs text-ds-muted" role="status">
          {t('adeWorkspace.sourceUnavailable')}
        </p>
      ) : null}
      <div className="max-h-[280px] overflow-y-auto p-2">
        {filtered.map((option) => {
          const selected = workspaceRootIdentityKey(option.root) === workspaceRootIdentityKey(currentRoot)
          return (
            <button
              key={option.root}
              type="button"
              role="menuitem"
              disabled={blocked}
              onClick={() => void select(option.root)}
              title={option.root}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
              data-ade-project-root={option.root}
            >
              <Folder className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{option.label}</span>
                {option.context ? <span className="block truncate text-xs text-ds-faint">{option.context}</span> : null}
              </span>
              {selected ? <Check className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={2} /> : null}
            </button>
          )
        })}
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ds-faint">
            {options.length ? t('composerWorkspaceNoMatch') : t('composerWorkspaceEmpty')}
          </p>
        ) : null}
      </div>
      <div className="border-t border-ds-border-muted p-2">
        <button
          type="button"
          role="menuitem"
          disabled={blocked}
          onClick={() => void browse()}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
          data-ade-project-browse
        >
          <FolderPlus className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.9} />
          {t('composerWorkspaceAdd')}
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="ds-no-drag min-w-0" data-ade-workspace-picker>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={t('adeWorkspace.title')}
        onClick={() => setOpen((value) => !value)}
        title={pathTitle || t('selectWorkspace')}
        className="inline-flex h-8 max-w-[min(280px,70vw)] min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        data-ade-workspace-trigger
      >
        <Folder className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{label}</span>
        {acting ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} /> :
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
