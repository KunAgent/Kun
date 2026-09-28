import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, CircleStop, Code, ExternalLink, Eye, FilePen, FilePlus, KanbanSquare, Loader2, Play, ShieldAlert } from 'lucide-react'
import type { Room, RoomMessage, WorkbenchLinkEntry, WorkbenchLinkKind } from '@shared/rooms-api'
import { workbenchClient } from './workbench-client'
import { openWorkbenchLinkTarget, workbenchOpenTarget } from './workbench-navigation'
import { subscribeRoomEvents } from './useRoomEvents'
import './rooms-workbench.css'

const KIND_ICON: Record<WorkbenchLinkKind, typeof Code> = {
  code_task: Code, work_task: FilePen, work_document: FilePlus, work_edit: FilePen, board_card: KanbanSquare, watch: Eye
}
const KIND_LABEL: Record<WorkbenchLinkKind, string> = {
  code_task: 'roomsWorkbenchCode', work_task: 'roomsWorkbenchWorkTask', work_document: 'roomsWorkbenchDocument',
  work_edit: 'roomsWorkbenchEdit', board_card: 'roomsWorkbenchBoard', watch: 'roomsWorkbenchWatch'
}
const CONFIRM_LABEL: Record<WorkbenchLinkKind, string> = {
  code_task: 'roomsWorkbenchStart', work_task: 'roomsWorkbenchStart', work_document: 'roomsWorkbenchCreate',
  work_edit: 'roomsWorkbenchApply', board_card: 'roomsWorkbenchAdd', watch: 'roomsWorkbenchStart'
}
const basename = (path?: string): string => path?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''

/**
 * A Code/Work hand-off an Agent proposed or started. The card reads the durable
 * link record, so it stays correct across reloads and while the user is in Code.
 * Accepting is the only way anything runs: the buttons call the user-bound routes.
 */
export function RoomWorkbenchTaskCard({ room, message }: { room: Room; message: RoomMessage }) {
  const { t } = useTranslation('common')
  const linkId = message.workbenchLinkId
  const [link, setLink] = useState<WorkbenchLinkEntry>()
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', goal: '', worktree: false })
  const busyRef = useRef(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!linkId) return
    try {
      setLink(await workbenchClient.get(room.id, linkId, signal))
      setMissing(false)
    } catch (cause) {
      if (signal?.aborted) return
      if ((cause as { status?: number }).status === 404) setMissing(true)
      else setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [room.id, linkId])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== room.id) return
      if (event.kind === 'workbench.link.updated' && (event.payload as { linkId?: string } | undefined)?.linkId === linkId) void refresh()
    })
    return () => { controller.abort(); off() }
  }, [refresh, room.id, linkId])

  const act = useCallback(async (task: () => Promise<WorkbenchLinkEntry | void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await task()
      if (next) setLink(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh()
    } finally { busyRef.current = false; setBusy(false) }
  }, [refresh])

  if (!linkId || missing) return <section className="rooms-workbench-card" role="note"><p>{message.body}</p><small>{t('roomsWorkbenchUnavailable')}</small></section>
  if (!link) return <section className="rooms-workbench-card" aria-busy="true"><p>{message.body}</p></section>

  const { request, status, kind } = link
  const Icon = KIND_ICON[kind]
  const project = basename(request.workspaceRoot)
  const opens = workbenchOpenTarget(link)
  const longRunning = kind === 'code_task' || kind === 'work_task'
  const startEditing = () => {
    setDraft({ title: request.title, goal: request.goal, worktree: request.isolation === 'worktree' })
    setEditing(true)
  }
  const confirm = () => act(async () => {
    const edits = editing ? { title: draft.title.trim() || request.title, goal: draft.goal.trim(),
      ...(kind === 'code_task' ? { isolation: draft.worktree ? 'worktree' as const : 'inherit' as const } : {}) } : undefined
    const next = await workbenchClient.confirm(link, edits)
    setEditing(false)
    return next
  })

  return <section className="rooms-workbench-card" data-status={status} data-kind={kind} aria-label={`${t(KIND_LABEL[kind])}: ${request.title}`}>
    <header>
      <span className="rooms-workbench-kind"><Icon size={14} aria-hidden="true" />{t(KIND_LABEL[kind])}</span>
      <span className="rooms-workbench-status" role="status">
        {status === 'queued' || status === 'running' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
        {status === 'needs_attention' ? <ShieldAlert size={12} aria-hidden="true" /> : null}
        {status === 'completed' ? <Check size={12} aria-hidden="true" /> : null}
        {status === 'failed' || status === 'recovery_required' ? <AlertCircle size={12} aria-hidden="true" /> : null}
        {t(`roomsWorkbenchStatus_${status}`)}
      </span>
    </header>
    {editing ? <div className="rooms-workbench-edit">
      <label>{t('roomsWorkbenchTitleLabel')}<input value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>{t('roomsWorkbenchGoalLabel')}<textarea rows={4} value={draft.goal} maxLength={8000} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
      {kind === 'code_task' ? <label className="rooms-workbench-check"><input type="checkbox" checked={draft.worktree}
        onChange={(event) => setDraft({ ...draft, worktree: event.target.checked })} />{t('roomsWorkbenchUseWorktree')}</label> : null}
    </div> : <>
      <h4>{request.title}</h4>
      {request.goal && kind !== 'work_document' && kind !== 'work_edit' ? <p className="rooms-workbench-goal">{request.goal}</p> : null}
      {request.acceptance ? <p className="rooms-workbench-acceptance"><strong>{t('roomsWorkbenchAcceptance')}</strong> {request.acceptance}</p> : null}
      <div className="rooms-workbench-meta">
        {project && kind !== 'watch' ? <span title={request.workspaceRoot}>{t(kind === 'code_task' || kind === 'board_card' ? 'roomsWorkbenchProject' : 'roomsWorkbenchWorkspace')}: {project}</span> : null}
        {request.relativePath ? <span title={request.relativePath}>{request.relativePath}</span> : null}
        {request.isolation === 'worktree' ? <span>{t('roomsWorkbenchIsolated')}</span> : null}
        {request.mode === 'plan' && longRunning ? <span>{t('roomsWorkbenchPlanMode')}</span> : null}
        {kind === 'board_card' && request.board?.priority ? <span>{request.board.priority}</span> : null}
        {kind === 'board_card' && request.board?.category ? <span>{request.board.category}</span> : null}
      </div>
      {kind === 'work_document' && request.content ? <pre className="rooms-workbench-preview" aria-label={t('roomsWorkbenchPreview')}>{request.content.slice(0, 1200)}{request.content.length > 1200 ? '…' : ''}</pre> : null}
      {kind === 'board_card' && request.board?.description ? <p className="rooms-workbench-goal">{request.board.description}</p> : null}
      {kind === 'work_edit' ? <div className="rooms-workbench-edits">
        {(request.edits ?? []).slice(0, 6).map((edit, index) => <div key={index} className="rooms-workbench-diff">
          <del>{edit.oldText.slice(0, 400)}</del><ins>{edit.newText.slice(0, 400)}</ins>
        </div>)}
      </div> : null}
    </>}
    {link.userTookOver && (status === 'running' || status === 'queued' || status === 'needs_attention') ? <p className="rooms-workbench-note">{t('roomsWorkbenchTookOver')}</p> : null}
    {status === 'needs_attention' && link.attention ? <p className="rooms-workbench-attention" role="alert">
      <ShieldAlert size={14} aria-hidden="true" />
      <span><strong>{t(link.attention.kind === 'approval' ? 'roomsWorkbenchApproval' : 'roomsWorkbenchQuestion')}</strong> {link.attention.summary}</span>
    </p> : null}
    {status === 'completed' && link.result ? <div className="rooms-workbench-result">
      {link.result.summary ? <p>{link.result.summary}</p> : null}
      {link.result.changedFiles.length ? <p className="rooms-workbench-files" title={link.result.changedFiles.join('\n')}>
        {t('roomsWorkbenchFiles', { count: link.result.changedFiles.length })}: {link.result.changedFiles.slice(0, 4).join(', ')}{link.result.changedFiles.length > 4 ? '…' : ''}</p> : null}
      {link.result.commands.length ? <p className="rooms-workbench-files">{t('roomsWorkbenchCommands')}: {link.result.commands.slice(-3).map((command) =>
        `${command.command.slice(0, 60)}${command.exitCode === undefined ? '' : command.exitCode === 0 ? ' ✓' : ` ✗${command.exitCode}`}`).join(' · ')}</p> : null}
    </div> : null}
    {status === 'recovery_required' ? <p className="rooms-workbench-note">{link.error || t('roomsWorkbenchRecovery')}</p> : null}
    {(status === 'failed') && link.error ? <p className="rooms-workbench-error" role="alert">{link.error}</p> : null}
    {error ? <p className="rooms-workbench-error" role="alert">{error}</p> : null}
    <div className="rooms-workbench-actions">
      {status === 'awaiting_confirmation' ? <>
        <button type="button" disabled={busy} onClick={() => void act(() => workbenchClient.dismiss(link))}>{t('roomsWorkbenchDismiss')}</button>
        {longRunning && !editing ? <button type="button" disabled={busy} onClick={startEditing}>{t('roomsWorkbenchEditBefore')}</button> : null}
        {editing ? <button type="button" disabled={busy} onClick={() => setEditing(false)}>{t('roomsWorkbenchCancelEdit')}</button> : null}
        <button type="button" className="is-primary" disabled={busy || (editing && !draft.title.trim())} onClick={() => void confirm()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{t(CONFIRM_LABEL[kind])}
        </button>
      </> : null}
      {(status === 'queued' || status === 'running' || status === 'needs_attention') && kind !== 'watch' && longRunning ? <button type="button" disabled={busy}
        onClick={() => void act(() => workbenchClient.cancel(link))}><CircleStop size={14} />{t('roomsWorkbenchStop')}</button> : null}
      {opens && status !== 'awaiting_confirmation' && status !== 'dismissed' ? <button type="button" className={status === 'needs_attention' ? 'is-primary' : ''}
        onClick={() => void openWorkbenchLinkTarget(link).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>
        <ExternalLink size={14} />{t(opens === 'code' ? 'roomsWorkbenchOpenCode' : opens === 'board' ? 'roomsWorkbenchOpenBoard' : 'roomsWorkbenchOpenWork')}</button> : null}
    </div>
  </section>
}
