import { useEffect, useId, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, CircleAlert, Loader2, Minus } from 'lucide-react'
import type {
  GitTurnReapplyConflict,
  GitTurnUndoIgnoredFile,
  GitTurnUndoSafeFile,
  GitTurnUndoUnsafeFile
} from '@shared/git-turn-undo'
import { useChatStore } from '../../store/chat-store'
import {
  claimTurnUndoDialogHost,
  closeTurnUndoDialog,
  confirmTurnUndo,
  releaseTurnUndoDialogHost,
  useTurnUndoStore,
  type TurnUndoDialog
} from '../../store/turn-undo-store'

const UNSAFE_REASON_KEYS: Record<GitTurnUndoUnsafeFile['reason'], string> = {
  modified_after_turn: 'turnUndoReasonModifiedAfterTurn',
  checkpoint_missing: 'turnUndoReasonCheckpointMissing',
  not_in_snapshot: 'turnUndoReasonNotInSnapshot',
  gitignored: 'turnUndoReasonGitignored',
  outside_workspace: 'turnUndoReasonOutsideWorkspace',
  unreadable: 'turnUndoReasonUnreadable'
}

const IGNORED_REASON_KEYS: Record<GitTurnUndoIgnoredFile['reason'], string> = {
  no_net_change: 'turnUndoReasonNoNetChange',
  shell_changed: 'turnUndoReasonShellChanged',
  end_state_unknown: 'turnUndoReasonEndStateUnknown'
}

const CONFLICT_REASON_KEYS: Record<GitTurnReapplyConflict['reason'], string> = {
  modified_after_undo: 'turnUndoConflictModifiedAfterUndo',
  snapshot_missing: 'turnUndoConflictSnapshotMissing',
  unreadable: 'turnUndoConflictUnreadable'
}

const footerButtonClass =
  'rounded-[10px] px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55'

function FileGroup({
  tone,
  label,
  children
}: {
  tone: 'safe' | 'unsafe' | 'ignored'
  label: string
  children: ReactNode
}): ReactElement {
  const icon = tone === 'safe'
    ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
    : tone === 'unsafe'
      ? <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
      : <Minus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
  const labelClass = tone === 'safe'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'unsafe'
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-ds-muted'
  const listClass = tone === 'unsafe'
    ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950'
    : 'border-ds-border'
  return (
    <section className="flex flex-col gap-1.5" data-turn-undo-group={tone}>
      <h3 className={`flex items-center gap-2 text-[12px] font-semibold ${labelClass}`}>
        {icon}
        {label}
      </h3>
      <ul className={`divide-y divide-ds-border-muted overflow-hidden rounded-xl border ${listClass}`}>
        {children}
      </ul>
    </section>
  )
}

function FileRow({ path, note, unsafe = false }: { path: string; note: string; unsafe?: boolean }): ReactElement {
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5">
      <span className="break-all font-mono text-[12.5px] text-ds-ink">{path}</span>
      <span className={`text-[12px] leading-5 ${unsafe ? 'text-rose-800 dark:text-rose-200' : 'text-ds-muted'}`}>{note}</span>
    </li>
  )
}

function UndoDialogBody({ dialog }: { dialog: Extract<TurnUndoDialog, { kind: 'undo' }> }): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const busy = useChatStore((state) => state.busy)
  const rollbackWorkspaceToCheckpoint = useChatStore((state) => state.rollbackWorkspaceToCheckpoint)
  const { preflight, phase } = dialog
  const safe: GitTurnUndoSafeFile[] = preflight?.safe ?? []
  const unsafe = preflight?.unsafe ?? []
  const ignored = preflight?.ignored ?? []
  const running = phase === 'running'
  const blocked = unsafe.length > 0
  const nothing = Boolean(preflight) && safe.length === 0 && unsafe.length === 0
  const canConfirm = phase === 'ready' && Boolean(preflight?.canUndo) && !busy

  const openAdvanced = (): void => {
    const checkpointId = dialog.target.checkpointId
    closeTurnUndoDialog()
    void rollbackWorkspaceToCheckpoint(checkpointId)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-turn-undo-dialog
      onMouseDown={(event) => event.stopPropagation()}
      className="flex max-h-full w-full max-w-[600px] flex-col overflow-hidden rounded-[20px] border border-ds-border bg-ds-card shadow-2xl"
    >
      <div className="flex flex-col gap-2 px-6 pb-4 pt-6">
        <h2 id={titleId} className="text-[18px] font-semibold tracking-[-0.01em] text-ds-ink">{t('turnUndoDialogTitle')}</h2>
        <p className="text-[13px] leading-6 text-ds-muted">{t('turnUndoDialogDescription')}</p>
      </div>
      {blocked ? (
        <div role="alert" className="mx-6 mb-3 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>{unsafe.length === 1 ? t('turnUndoBlockedOne') : t('turnUndoBlockedMany', { count: unsafe.length })}</span>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6">
        {phase === 'checking' ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('turnUndoChecking')}
          </p>
        ) : null}
        {nothing ? <p className="py-2 text-[13px] text-ds-muted">{t('turnUndoNothing')}</p> : null}
        {safe.length > 0 ? (
          <FileGroup tone="safe" label={t('turnUndoGroupSafe', { count: safe.length })}>
            {safe.map((file) => (
              <FileRow
                key={file.path}
                path={file.path}
                note={file.action === 'delete' ? t('turnUndoActionDelete') : t('turnUndoActionRestore')}
              />
            ))}
          </FileGroup>
        ) : null}
        {unsafe.length > 0 ? (
          <FileGroup tone="unsafe" label={t('turnUndoGroupUnsafe', { count: unsafe.length })}>
            {unsafe.map((file) => (
              <FileRow key={file.path} path={file.path} note={t(UNSAFE_REASON_KEYS[file.reason])} unsafe />
            ))}
          </FileGroup>
        ) : null}
        {ignored.length > 0 ? (
          <FileGroup
            tone="ignored"
            label={t('turnUndoGroupIgnored', { count: ignored.length + (preflight?.ignoredOverflow ?? 0) })}
          >
            {ignored.map((file) => (
              <FileRow key={`${file.reason}:${file.path}`} path={file.path} note={t(IGNORED_REASON_KEYS[file.reason])} />
            ))}
            {preflight?.ignoredOverflow ? (
              <li className="px-3.5 py-2 text-[12px] text-ds-muted">
                {t('turnUndoIgnoredOverflow', { count: preflight.ignoredOverflow })}
              </li>
            ) : null}
          </FileGroup>
        ) : null}
        {dialog.error ? <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-300">{dialog.error}</p> : null}
        {busy ? <p className="text-[12px] text-ds-muted">{t('turnUndoBusy')}</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-ds-border-muted px-6 py-4">
        <button
          type="button"
          onClick={openAdvanced}
          disabled={running || busy}
          className="min-w-[200px] flex-1 text-left text-[12px] font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-55"
          data-turn-undo-advanced
        >
          {t('turnUndoAdvanced')}
        </button>
        <button
          type="button"
          onClick={closeTurnUndoDialog}
          disabled={running}
          className={`${footerButtonClass} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`}
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => void confirmTurnUndo()}
          disabled={!canConfirm}
          className={`${footerButtonClass} inline-flex items-center gap-2 bg-accent text-white hover:brightness-110`}
          data-turn-undo-confirm
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {running
            ? t('turnUndoWorking')
            : safe.length === 0
              ? t('turnUndoAction')
              : safe.length === 1 ? t('turnUndoConfirmOne') : t('turnUndoConfirmMany', { count: safe.length })}
        </button>
      </div>
    </div>
  )
}

function ReapplyBlockedBody({ dialog }: { dialog: Extract<TurnUndoDialog, { kind: 'reapply-blocked' }> }): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-turn-undo-dialog
      onMouseDown={(event) => event.stopPropagation()}
      className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-ds-border bg-ds-card shadow-2xl"
    >
      <div className="flex flex-col gap-2 px-6 pb-4 pt-6">
        <h2 id={titleId} className="text-[18px] font-semibold text-ds-ink">{t('turnUndoReapplyBlockedTitle')}</h2>
        <p className="text-[13px] leading-6 text-ds-muted">{t('turnUndoReapplyBlockedDescription')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <FileGroup tone="unsafe" label={t('turnUndoGroupUnsafe', { count: dialog.conflicts.length })}>
          {dialog.conflicts.map((conflict) => (
            <FileRow key={conflict.path} path={conflict.path} note={t(CONFLICT_REASON_KEYS[conflict.reason])} unsafe />
          ))}
        </FileGroup>
      </div>
      <div className="mt-4 flex justify-end border-t border-ds-border-muted px-6 py-4">
        <button
          type="button"
          autoFocus
          onClick={closeTurnUndoDialog}
          className={`${footerButtonClass} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`}
        >
          {t('turnUndoClose')}
        </button>
      </div>
    </div>
  )
}

/** Renders the per-turn undo dialog; mounted by each timeline, shown by one. */
export function TurnUndoDialogHost(): ReactElement | null {
  const hostId = useId()
  const owner = useTurnUndoStore((state) => state.hostOwner)
  const dialog = useTurnUndoStore((state) => state.dialog)

  useEffect(() => {
    claimTurnUndoDialogHost(hostId)
    return () => releaseTurnUndoDialogHost(hostId)
  }, [hostId])

  useEffect(() => {
    if (!dialog || owner !== hostId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeTurnUndoDialog()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, owner, hostId])

  if (!dialog || owner !== hostId) return null
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 ds-no-drag"
      onMouseDown={closeTurnUndoDialog}
    >
      {dialog.kind === 'undo' ? <UndoDialogBody dialog={dialog} /> : <ReapplyBlockedBody dialog={dialog} />}
    </div>
  )
}
