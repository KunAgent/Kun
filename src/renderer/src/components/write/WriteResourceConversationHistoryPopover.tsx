import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Check,
  ChevronDown,
  FileText,
  History,
  LayoutPanelTop,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../../lib/format-relative-time'
import type {
  WriteResourceConversationEntry,
  WriteResourceConversationHistoryModel
} from './useWriteResourceConversationHistory'
import {
  WriteResourceConversationActionsMenu
} from './WriteResourceConversationActionsMenu'
import type {
  WriteResourceConversationAction
} from './WriteResourceConversationActionsMenu'
import type { AnchorRect } from './WriteResourceConversationActionsMenu'

type Props = {
  model: WriteResourceConversationHistoryModel
  lockedExternally: boolean
  onNewConversation: () => void
}

type RenameState = {
  entry: WriteResourceConversationEntry
  value: string
  submitting: boolean
}

type ArchiveState = {
  entry: WriteResourceConversationEntry
  submitting: boolean
}

export function WriteResourceConversationHistoryPopover({
  model,
  lockedExternally,
  onNewConversation
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement>(null)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const [menuAnchorRect, setMenuAnchorRect] = useState<AnchorRect | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)
  const [archiveState, setArchiveState] = useState<ArchiveState | null>(null)
  const interactionLocked = lockedExternally || model.running || !model.runtimeReady
  const canCreate = !interactionLocked && !model.workflowLocked
  const canSwitch = !interactionLocked && !model.workflowLocked
  const canRename = !interactionLocked
  const canArchive = !interactionLocked && !model.workflowLocked
  const locale = i18n.resolvedLanguage || i18n.language || 'en'

  useEffect(() => {
    setOpen(false)
    setSearch('')
    setMenuThreadId(null)
    setRenameState(null)
    setArchiveState(null)
  }, [model.scopeKey])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOnOutsidePointer = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (menuContainerRef.current?.contains(target)) return
      setOpen(false)
      setMenuThreadId(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !renameState && !archiveState) {
        setOpen(false)
        setMenuThreadId(null)
      }
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [archiveState, open, renameState])

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale)
    return model.entries.filter((entry, index) => {
      if (!query) return true
      return conversationTitle(entry, index, t).toLocaleLowerCase(locale).includes(query)
    })
  }, [locale, model.entries, search, t])

  const toggleOpen = (): void => {
    const next = !open
    setOpen(next)
    setMenuThreadId(null)
    setMenuAnchorRect(null)
    if (next) void model.loadMissingThreads()
  }

  const closeActionsMenu = (restoreFocus: boolean): void => {
    setMenuThreadId(null)
    setMenuAnchorRect(null)
    if (restoreFocus) {
      rootRef.current
        ?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
        ?.focus()
    }
  }

  const selectMenuAction = (
    action: WriteResourceConversationAction
  ): void => {
    const entry = model.entries.find((candidate) => candidate.id === menuThreadId)
    setMenuThreadId(null)
    setMenuAnchorRect(null)
    if (!entry) return
    const sourceIndex = model.entries.findIndex((candidate) => candidate.id === entry.id)
    if (action === 'rename') {
      setRenameState({ entry, value: conversationTitle(entry, sourceIndex, t), submitting: false })
    } else {
      setArchiveState({ entry, submitting: false })
    }
  }

  const registerMenuContainer = (element: HTMLDivElement | null): void => {
    menuContainerRef.current = element
  }

  const handleMenuOutsidePointer = (target: Node | null): void => {
    if (!target) return
    if (rootRef.current?.contains(target)) return
    if (menuContainerRef.current?.contains(target)) return
    setMenuThreadId(null)
    setMenuAnchorRect(null)
  }

  const lockTitle = model.running
    ? t('writeConversationLockedRunning')
    : !model.runtimeReady
      ? t('runtimeActionNeedsConnection')
      : model.workflowLocked
        ? t('writeConversationWorkflowLocked')
        : undefined

  return (
    <div ref={rootRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={toggleOpen}
        className={`flex h-8 max-w-[150px] items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition ${
          open
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-ds-border-muted bg-ds-card/70 text-ds-muted hover:border-ds-border hover:bg-ds-hover hover:text-ds-ink'
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t(model.resourceKind === 'file'
          ? 'writeConversationFileTrigger'
          : 'writeConversationWhiteboardTrigger')}
      >
        <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
        <span className="truncate">
          {t(model.resourceKind === 'file'
            ? 'writeConversationFileTrigger'
            : 'writeConversationWhiteboardTrigger')}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t(model.resourceKind === 'file'
            ? 'writeConversationFileTitle'
            : 'writeConversationWhiteboardTitle')}
          className="absolute right-0 top-[calc(100%+9px)] z-[70] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-[0_22px_64px_rgba(20,47,95,0.22)] dark:shadow-[0_22px_64px_rgba(0,0,0,0.42)]"
          data-testid="write-resource-conversation-history"
        >
          <div className="border-b border-ds-border-muted px-3.5 pb-3 pt-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-ds-ink">
                  {t(model.resourceKind === 'file'
                    ? 'writeConversationFileTitle'
                    : 'writeConversationWhiteboardTitle')}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-ds-faint">
                  {model.resourceKind === 'file' ? (
                    <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  ) : (
                    <LayoutPanelTop className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  )}
                  <span className="truncate" title={model.resourceLabel}>{model.resourceLabel}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={!canCreate}
                onClick={() => {
                  if (!canCreate) return
                  setOpen(false)
                  onNewConversation()
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                title={!canCreate ? lockTitle : t('writeConversationNew')}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                {t('writeConversationNew')}
              </button>
            </div>
            <label className="mt-3 flex h-8 items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-main/65 px-2.5 focus-within:border-accent/35 focus-within:ring-1 focus-within:ring-accent/15">
              <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('writeConversationSearch')}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="rounded p-0.5 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={t('clear')}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              ) : null}
            </label>
          </div>

          <div className="max-h-[330px] overflow-y-auto p-2">
            {visibleEntries.length > 0 ? visibleEntries.map((entry) => {
              const sourceIndex = model.entries.findIndex((candidate) => candidate.id === entry.id)
              const title = conversationTitle(entry, sourceIndex, t)
              return (
                <div
                  key={entry.id}
                  className={`group relative flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 transition ${
                    entry.current ? 'bg-accent/[0.09]' : 'hover:bg-ds-hover'
                  }`}
                >
                  <button
                    type="button"
                    disabled={!canSwitch || entry.current || entry.missing}
                    onClick={() => void model.selectConversation(entry.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                    title={entry.missing ? t('writeConversationUnavailable') : !canSwitch ? lockTitle : title}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                      entry.current ? 'bg-accent/15 text-accent' : 'bg-ds-main text-ds-faint'
                    }`}>
                      <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-medium text-ds-ink">{title}</span>
                        {entry.current ? (
                          <span className="shrink-0 rounded-full bg-accent/12 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent">
                            {t('writeConversationCurrent')}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-ds-faint">
                        {entry.missing
                          ? t('writeConversationLoadingMetadata')
                          : entry.updatedAt
                            ? formatRelativeTime(entry.updatedAt, locale)
                            : t('writeConversationNoTimestamp')}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (menuThreadId === entry.id) {
                        closeActionsMenu(false)
                        return
                      }
                      const rect = (event.currentTarget as HTMLButtonElement | undefined)?.getBoundingClientRect()
                      setMenuAnchorRect(
                        rect
                          ? { left: rect.left ?? 0, right: rect.right ?? 0, top: rect.top ?? 0, bottom: rect.bottom ?? 0 }
                          : { left: 0, right: 0, top: 0, bottom: 0 }
                      )
                      setMenuThreadId(entry.id)
                    }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ds-faint opacity-70 transition hover:bg-ds-card hover:text-ds-ink group-hover:opacity-100"
                    aria-label={t('writeConversationMore')}
                    aria-expanded={menuThreadId === entry.id}
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.9} />
                  </button>
                </div>
              )
            }) : (
              <div className="flex min-h-28 flex-col items-center justify-center px-6 text-center text-[12px] leading-5 text-ds-faint">
                <History className="mb-2 h-5 w-5 opacity-65" strokeWidth={1.7} />
                {search ? t('writeConversationNoMatches') : t('writeConversationEmpty')}
              </div>
            )}
          </div>

          {menuThreadId && menuAnchorRect ? (
            <WriteResourceConversationActionsMenu
              anchorRect={menuAnchorRect}
              canRename={canRename && !model.entries.find((entry) => entry.id === menuThreadId)?.missing}
              canArchive={canArchive && !model.entries.find((entry) => entry.id === menuThreadId)?.missing}
              onSelect={selectMenuAction}
              onClose={closeActionsMenu}
              onOutsidePointer={handleMenuOutsidePointer}
              registerContainer={registerMenuContainer}
            />
          ) : null}
          {(model.running || model.workflowLocked) ? (
            <div className="border-t border-ds-border-muted bg-ds-main/45 px-3 py-2 text-[10.5px] leading-4 text-ds-faint">
              {model.running ? t('writeConversationLockedRunning') : t('writeConversationWorkflowLocked')}
            </div>
          ) : null}
        </div>
      ) : null}

      {renameState ? createPortal(
        <RenameConversationDialog
          state={renameState}
          onChange={(value) => setRenameState((current) => current ? { ...current, value } : current)}
          onClose={() => {
            if (!renameState.submitting) setRenameState(null)
          }}
          onSubmit={async (event) => {
            event.preventDefault()
            const title = renameState.value.trim()
            if (!title || title === renameState.entry.title || renameState.submitting) return
            setRenameState((current) => current ? { ...current, submitting: true } : current)
            await model.renameConversation(renameState.entry.id, title)
            setRenameState(null)
          }}
        />,
        document.body
      ) : null}

      {archiveState ? createPortal(
        <ArchiveConversationDialog
          state={archiveState}
          title={conversationTitle(
            archiveState.entry,
            model.entries.findIndex((entry) => entry.id === archiveState.entry.id),
            t
          )}
          onClose={() => {
            if (!archiveState.submitting) setArchiveState(null)
          }}
          onConfirm={async () => {
            if (archiveState.submitting) return
            setArchiveState((current) => current ? { ...current, submitting: true } : current)
            await model.archiveConversation(archiveState.entry.id)
            setArchiveState(null)
          }}
        />,
        document.body
      ) : null}
    </div>
  )
}

function conversationTitle(
  entry: WriteResourceConversationEntry,
  index: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return entry.title || t('writeConversationFallback', { number: Math.max(1, index + 1) })
}

function RenameConversationDialog({
  state,
  onChange,
  onClose,
  onSubmit
}: {
  state: RenameState
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}): ReactElement {
  const { t } = useTranslation('common')
  useDialogEscape(onClose, state.submitting)
  const nextTitle = state.value.trim()
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="write-conversation-rename-title"
      className="ds-no-drag fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px] dark:bg-black/45"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[22px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.24)]"
      >
        <h2 id="write-conversation-rename-title" className="text-[18px] font-semibold tracking-[-0.03em] text-ds-ink">
          {t('sidebarThreadRename')}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-ds-muted">{t('sidebarThreadRenamePrompt')}</p>
        <input
          autoFocus
          value={state.value}
          disabled={state.submitting}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-60"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={state.submitting} onClick={onClose} className="rounded-xl px-3 py-2 text-[13px] font-medium text-ds-muted hover:bg-ds-hover disabled:opacity-55">
            {t('cancel')}
          </button>
          <button type="submit" disabled={!nextTitle || nextTitle === state.entry.title || state.submitting} className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
            {state.submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t('confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}

function ArchiveConversationDialog({
  state,
  title,
  onClose,
  onConfirm
}: {
  state: ArchiveState
  title: string
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  useDialogEscape(onClose, state.submitting)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="write-conversation-archive-title"
      className="ds-no-drag fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px] dark:bg-black/45"
      onMouseDown={onClose}
    >
      <div onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-[22px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.24)]">
        <h2 id="write-conversation-archive-title" className="text-[18px] font-semibold tracking-[-0.03em] text-ds-ink">
          {t('writeConversationArchiveTitle')}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-ds-muted">{t('writeConversationArchiveDescription')}</p>
        <p className="mt-4 truncate rounded-xl border border-ds-border-muted bg-ds-main/65 px-3 py-2.5 text-[13px] font-medium text-ds-ink" title={title}>{title}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={state.submitting} onClick={onClose} className="rounded-xl px-3 py-2 text-[13px] font-medium text-ds-muted hover:bg-ds-hover disabled:opacity-55">
            {t('cancel')}
          </button>
          <button type="button" disabled={state.submitting} onClick={onConfirm} className="flex items-center gap-1.5 rounded-xl bg-red-500/12 px-3 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-500/18 disabled:cursor-wait disabled:opacity-55 dark:text-red-300">
            {state.submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            {t('sidebarThreadArchive')}
          </button>
        </div>
      </div>
    </div>
  )
}

function useDialogEscape(onClose: () => void, disabled: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !disabled) onClose()
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [disabled, onClose])
}
