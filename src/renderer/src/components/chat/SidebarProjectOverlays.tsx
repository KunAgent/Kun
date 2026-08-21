import { useEffect, type FormEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  ClipboardCopy,
  ExternalLink,
  FolderPlus,
  MoveRight,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  ScrollText,
  Trash2,
  X
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import type { SidebarThreadWorktreeRecord } from './sidebar-project-selectors'
import type { SidebarVirtualFolder } from './sidebar-folders'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ThreadContextMenuState = {
  thread: NormalizedThread
  worktreeRecord?: SidebarThreadWorktreeRecord
  x: number
  y: number
}

export type WorkspaceContextMenuState = {
  workspacePath: string
  x: number
  y: number
}

export type FolderContextMenuState = {
  workspacePath: string
  folder: SidebarVirtualFolder
  x: number
  y: number
}

export type MoveThreadDialogState = {
  thread: NormalizedThread
  targets: string[]
  targetWorkspace: string | null
  submitting: boolean
  error?: string
}

export type SidebarActionDialogState = {
  title: string
  description: string
  detail: string
  confirmLabel: string
  danger?: boolean
  submitting: boolean
  onConfirm: () => Promise<void>
}

export type RenameThreadDialogState = {
  thread: NormalizedThread
  value: string
  submitting: boolean
}

export type SidebarFolderDialogState = {
  mode: 'create' | 'rename'
  workspacePath: string
  parentId?: string | null
  folder?: SidebarVirtualFolder
  value: string
  error?: string
}

export function sidebarOverlayPortalHost(
  currentDocument: Document | undefined = typeof document === 'undefined' ? undefined : document
): HTMLElement | null {
  return currentDocument?.body ?? null
}

function SidebarOverlayPortal({ children }: { children: ReactElement }): ReactElement {
  const host = sidebarOverlayPortalHost()
  return host ? createPortal(children, host) : children
}

export function ThreadRenameDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: RenameThreadDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: Translate
}): ReactElement {
  const nextTitle = state.value.trim()
  const canSubmit = Boolean(nextTitle) && nextTitle !== state.thread.title && !state.submitting
  useEscapeToClose(onClose, state.submitting)
  return (
    <SidebarOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-rename-dialog-title"
        className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
        onMouseDown={onClose}
      >
        <form
          onSubmit={onSubmit}
          onMouseDown={(event) => event.stopPropagation()}
          className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
        >
          <h2 id="thread-rename-dialog-title" className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
            {t('sidebarThreadRename')}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-ds-muted">{t('sidebarThreadRenamePrompt')}</p>
          <input
            autoFocus
            aria-label={t('sidebarThreadRenamePrompt')}
            disabled={state.submitting}
            value={state.value}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-wait disabled:opacity-70"
          />
          <DialogActions
            submitting={state.submitting}
            confirmDisabled={!canSubmit}
            confirmLabel={t('confirm')}
            onClose={onClose}
            t={t}
          />
        </form>
      </div>
    </SidebarOverlayPortal>
  )
}

export function SidebarFolderDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: SidebarFolderDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: Translate
}): ReactElement {
  const nextName = state.value.trim()
  const canSubmit = Boolean(nextName) && (
    state.mode === 'create' || nextName !== state.folder?.name
  )
  useEscapeToClose(onClose, false)
  const title = state.mode === 'create'
    ? t('sidebarFolderCreate')
    : t('sidebarFolderRename')
  const prompt = state.mode === 'create'
    ? t('sidebarFolderCreatePrompt')
    : t('sidebarFolderRenamePrompt')
  return (
    <SidebarOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-folder-dialog-title"
        className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
        onMouseDown={onClose}
      >
        <form
          onSubmit={onSubmit}
          onMouseDown={(event) => event.stopPropagation()}
          className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
        >
          <h2 id="sidebar-folder-dialog-title" className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
            {title}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-ds-muted">{prompt}</p>
          <input
            autoFocus
            aria-label={prompt}
            value={state.value}
            maxLength={80}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          />
          {state.error ? (
            <p className="mt-2 text-[12.5px] leading-5 text-red-600 dark:text-red-300">{state.error}</p>
          ) : null}
          <DialogActions
            submitting={false}
            confirmDisabled={!canSubmit}
            confirmLabel={t('confirm')}
            onClose={onClose}
            t={t}
          />
        </form>
      </div>
    </SidebarOverlayPortal>
  )
}

export function MoveThreadDialog({
  state,
  onClose,
  onPickTarget,
  onConfirm,
  t
}: {
  state: MoveThreadDialogState
  onClose: () => void
  onPickTarget: (workspacePath: string) => void
  onConfirm: () => Promise<void>
  t: Translate
}): ReactElement {
  const threadTitle = state.thread.title.trim() || state.thread.id
  const fromWorkspace = normalizeWorkspaceRoot(state.thread.workspace)
  const selectedTarget = state.targetWorkspace ? normalizeWorkspaceRoot(state.targetWorkspace) : ''
  useEscapeToClose(onClose, state.submitting)
  return (
    <SidebarOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-thread-dialog-title"
        className="ds-no-drag fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
        onMouseDown={onClose}
      >
        <div
          onMouseDown={(event) => event.stopPropagation()}
          className="w-full max-w-lg rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
        >
          <h2 id="move-thread-dialog-title" className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink">
            {state.targetWorkspace
              ? t('sidebarThreadMoveDialogTitle', { title: threadTitle })
              : t('sidebarThreadMovePickerTitle')}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-ds-muted">
            {state.targetWorkspace
              ? t('sidebarThreadMoveDialogDescription', {
                  from: workspaceLabelFromPath(fromWorkspace),
                  to: workspaceLabelFromPath(selectedTarget)
                })
              : t('sidebarThreadMovePickerDescription')}
          </p>
          {state.targetWorkspace ? (
            <div className="mt-4 space-y-2">
              <p className="rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">
                {t('sidebarThreadMoveDialogDetail')}
              </p>
              <p className="rounded-2xl border border-amber-300/45 bg-amber-50/75 px-3.5 py-3 text-[12.5px] leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
                {t('sidebarThreadMoveMetadataOnlyDetail')}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {state.targets.length === 0 ? (
                <div className="rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">
                  {t('sidebarThreadMoveNoTargets')}
                </div>
              ) : state.targets.map((workspacePath) => (
                <button
                  key={workspacePath}
                  type="button"
                  onClick={() => onPickTarget(workspacePath)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-ds-border bg-ds-main/55 px-3.5 py-3 text-left transition hover:border-accent/35 hover:bg-accent/6"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ds-ink">
                      {workspaceLabelFromPath(workspacePath)}
                    </span>
                    <span className="mt-1 block truncate text-[12px] text-ds-faint">{workspacePath}</span>
                  </span>
                  <MoveRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                </button>
              ))}
            </div>
          )}
          {state.error ? <p className="mt-4 text-[12.5px] leading-5 text-red-600 dark:text-red-300">{state.error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={state.submitting}
              onClick={onClose}
              className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {t('cancel')}
            </button>
            {state.targetWorkspace ? (
              <button
                type="button"
                disabled={!selectedTarget || state.submitting}
                onClick={() => void onConfirm()}
                className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {state.submitting ? t('loading') : t('sidebarThreadMoveConfirmButton')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarOverlayPortal>
  )
}

export function ThreadContextMenu({
  state,
  busy,
  moveDisabled,
  moveDisabledTitle,
  onClose,
  onMove,
  onPin,
  onRename,
  onSummarize,
  onCopyId,
  onArchive,
  onDelete,
  onRestore,
  t
}: {
  state: ThreadContextMenuState
  busy: boolean
  moveDisabled: boolean
  moveDisabledTitle?: string
  onClose: () => void
  onMove: () => void
  onPin: () => void
  onRename: () => void
  onSummarize: () => void
  onCopyId: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  t: Translate
}): ReactElement {
  const archived = state.thread.archived === true
  const pinned = state.thread.pinned === true
  const run = (action: () => void): void => {
    onClose()
    action()
  }
  return (
    <div
      role="menu"
      aria-label={state.thread.title}
      className="ds-thread-context-menu ds-no-drag fixed z-50 min-w-[210px] rounded-[16px] border border-ds-border bg-ds-card/95 p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem
        icon={pinned ? <PinOff className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Pin className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
        disabled={busy || archived}
        onClick={() => run(onPin)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <MenuItem icon={<MoveRight className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarThreadMove')} disabled={moveDisabled} title={moveDisabledTitle} onClick={() => run(onMove)} />
      <MenuItem icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarThreadRename')} disabled={busy} onClick={() => run(onRename)} />
      <MenuItem icon={<ScrollText className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('summarizeSession')} disabled={busy} onClick={() => run(onSummarize)} />
      <MenuItem
        icon={<ClipboardCopy className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadCopyId')}
        title={state.thread.id}
        disabled={!state.thread.id.trim()}
        onClick={() => run(onCopyId)}
      />
      <MenuItem
        icon={archived ? <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
        disabled={busy}
        onClick={() => run(archived ? onRestore : onArchive)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <MenuItem icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarThreadDelete')} disabled={busy} danger onClick={() => run(onDelete)} />
    </div>
  )
}

export function WorkspaceContextMenu({
  state,
  onClose,
  onNewThread,
  onNewFolder,
  onOpenInSystem,
  onArchiveThreads,
  onRemove,
  archiveDisabled,
  t
}: {
  state: WorkspaceContextMenuState
  onClose: () => void
  onNewThread: () => void
  onNewFolder: () => void
  onOpenInSystem: () => void
  onArchiveThreads: () => void
  onRemove: () => void
  archiveDisabled: boolean
  t: Translate
}): ReactElement {
  const run = (action: () => void): void => {
    onClose()
    action()
  }
  return (
    <div
      role="menu"
      aria-label={state.workspacePath}
      className="ds-workspace-context-menu ds-no-drag fixed z-50 min-w-[230px] rounded-[16px] border border-ds-border bg-ds-card/95 p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarWorkspaceNewThread')} disabled={false} onClick={() => run(onNewThread)} />
      <MenuItem icon={<FolderPlus className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarFolderCreate')} disabled={false} onClick={() => run(onNewFolder)} />
      <MenuItem icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarWorkspaceOpenInSystem')} disabled={false} onClick={() => run(onOpenInSystem)} />
      <MenuItem icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarWorkspaceArchiveThreads')} disabled={archiveDisabled} onClick={() => run(onArchiveThreads)} />
      <div className="my-1 h-px bg-ds-border-muted" />
      <MenuItem icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('sidebarWorkspaceRemove')} disabled={false} danger onClick={() => run(onRemove)} />
    </div>
  )
}

export function FolderContextMenu({
  state,
  onClose,
  onNewThread,
  onNewFolder,
  onRename,
  onDelete,
  t
}: {
  state: FolderContextMenuState
  onClose: () => void
  onNewThread: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  t: Translate
}): ReactElement {
  const run = (action: () => void): void => {
    onClose()
    action()
  }
  return (
    <div
      role="menu"
      aria-label={state.folder.name}
      className="ds-folder-context-menu ds-no-drag fixed z-50 min-w-[190px] rounded-[16px] border border-ds-border bg-ds-card/95 p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem
        icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarWorkspaceNewThread')}
        disabled={false}
        onClick={() => run(onNewThread)}
      />
      <MenuItem
        icon={<FolderPlus className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarFolderCreateChild')}
        disabled={false}
        onClick={() => run(onNewFolder)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <MenuItem
        icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarFolderRename')}
        disabled={false}
        onClick={() => run(onRename)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarFolderDelete')}
        disabled={false}
        danger
        onClick={() => run(onDelete)}
      />
    </div>
  )
}

export function SidebarActionDialog({
  state,
  onClose,
  onConfirm,
  t
}: {
  state: SidebarActionDialogState
  onClose: () => void
  onConfirm: () => void
  t: Translate
}): ReactElement {
  useEscapeToClose(onClose, state.submitting)
  return (
    <SidebarOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-action-dialog-title"
        className="ds-no-drag fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/28 px-4 pb-10 backdrop-blur-[2px] dark:bg-black/45 sm:items-center sm:pb-0"
        onMouseDown={onClose}
      >
        <div
          onMouseDown={(event) => event.stopPropagation()}
          className="w-full max-w-[520px] rounded-[26px] border border-ds-border bg-[var(--surface-3)] p-6 shadow-[0_26px_82px_rgba(20,47,95,0.24)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="sidebar-action-dialog-title" className="text-[22px] font-semibold tracking-[-0.04em] text-ds-ink">{state.title}</h2>
              <p className="mt-2 text-[14px] leading-6 text-ds-muted">{state.description}</p>
            </div>
            <button
              type="button"
              disabled={state.submitting}
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink disabled:cursor-wait disabled:opacity-50"
              aria-label={t('cancel')}
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <p className="mt-4 rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">{state.detail}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={state.submitting} onClick={onClose} className="rounded-2xl px-4 py-2 text-[14px] font-medium text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink disabled:cursor-wait disabled:opacity-60">{t('cancel')}</button>
            <button
              type="button"
              disabled={state.submitting}
              onClick={onConfirm}
              className={`rounded-2xl px-5 py-2 text-[14px] font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                state.danger
                  ? 'bg-red-500/12 text-red-600 hover:bg-red-500/18 dark:text-red-300'
                  : 'bg-accent text-white hover:brightness-110'
              }`}
            >
              {state.submitting ? t('loading') : state.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </SidebarOverlayPortal>
  )
}

function DialogActions({
  submitting,
  confirmDisabled,
  confirmLabel,
  onClose,
  t
}: {
  submitting: boolean
  confirmDisabled: boolean
  confirmLabel: string
  onClose: () => void
  t: Translate
}): ReactElement {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" disabled={submitting} onClick={onClose} className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60">{t('cancel')}</button>
      <button type="submit" disabled={confirmDisabled} className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55">
        {submitting ? t('loading') : confirmLabel}
      </button>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  disabled,
  title,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled: boolean
  title?: string
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300' : 'text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function useEscapeToClose(onClose: () => void, disabled: boolean): void {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, onClose])
}
