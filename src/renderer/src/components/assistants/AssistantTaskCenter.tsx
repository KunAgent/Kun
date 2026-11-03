import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AssistantTaskDetails, AssistantTaskPage, AssistantTaskQuery, AssistantTaskStatus, AssistantView } from '@shared/assistant-mailbox'
import { useAssistantMailboxStore } from './assistant-mailbox-store'
import { assistantStatusKey, taskHeadline } from './assistant-format'

const statuses: AssistantTaskStatus[] = ['queued', 'sent', 'received', 'working', 'blocked', 'done', 'failed', 'cancel_requested', 'cancelled']
const field = 'rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1.5 text-[12px] text-ds-ink'
const button = 'rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-[12px] text-ds-ink hover:bg-ds-hover disabled:opacity-50'
export function AssistantTaskCenter({ assistants, initialAssistantId, onClose }: { assistants: AssistantView[]; initialAssistantId: string; onClose(): void }) {
  const { t } = useTranslation('common')
  const [assistantId, setAssistant] = useState(initialAssistantId), [status, setStatus] = useState(''), [query, setQuery] = useState('')
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [archived, setArchived] = useState(false)
  const [page, setPage] = useState<AssistantTaskPage>({ tasks: [], hasMore: false }), [selected, setSelected] = useState<AssistantTaskDetails | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const serial = useRef(0), selectedId = useRef<string | null>(null), api = window.kunGui?.assistantMailbox
  const lastSyncAt = useAssistantMailboxStore(state => state.status?.lastSyncAt)
  const filters = (): AssistantTaskQuery => ({ ...(assistantId ? { assistantId } : {}), ...(status ? { status: status as AssistantTaskStatus } : {}),
    ...(query.trim() ? { query: query.trim() } : {}), ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}), archived, limit: 30 })
  const load = async (cursor?: string) => {
    const turn = ++serial.current
    setBusy(true); setError('')
    try {
      if (!api?.listTasks) throw new Error('TASK_CENTER_UNAVAILABLE')
      const result = await api.listTasks({ ...filters(), ...(cursor ? { cursor } : {}) })
      if (turn === serial.current) setPage(previous => cursor ? { ...result, tasks: [...previous.tasks, ...result.tasks] } : result)
    } catch (cause) { if (turn === serial.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (turn === serial.current) setBusy(false) }
  }
  useEffect(() => { selectedId.current = null; setSelected(null); void load(); return () => { serial.current++ } }, [assistantId, status, query, from, to, archived, revision])
  useEffect(() => { if (lastSyncAt) { void load(); if (selectedId.current) void detail(selectedId.current) } }, [lastSyncAt])
  const detail = async (id: string) => {
    const turn = serial.current
    try { if (!api?.taskDetails) throw new Error('TASK_CENTER_UNAVAILABLE'); const result = await api.taskDetails(id); if (turn === serial.current) { selectedId.current = id; setSelected(result) } }
    catch (cause) { if (turn === serial.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); selectedId.current = null; setSelected(null); setRevision(value => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={t('assistantTaskCenter')} className="flex max-h-[85vh] w-full max-w-[850px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-main shadow-2xl">
      <header className="flex items-center justify-between border-b border-ds-border px-5 py-3"><h2 className="font-semibold text-ds-ink">{t('assistantTaskCenter')}</h2><button type="button" className="rooms-icon-button" aria-label={t('assistantMailboxClose')} onClick={onClose}><X size={16} /></button></header>
      <div className="flex flex-wrap gap-2 border-b border-ds-border p-3">
        <select aria-label={t('assistantTaskFilterAssistant')} className={field} value={assistantId} onChange={e => setAssistant(e.target.value)}><option value="">{t('assistantTaskAllAssistants')}</option>{assistants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select aria-label={t('assistantTaskFilterStatus')} className={field} value={status} onChange={e => setStatus(e.target.value)}><option value="">{t('assistantTaskAllStatuses')}</option>{statuses.map(s => <option key={s} value={s}>{t(assistantStatusKey(s))}</option>)}</select>
        <input aria-label={t('assistantTaskSearch')} placeholder={t('assistantTaskSearch')} className={field} value={query} onChange={e => setQuery(e.target.value)} />
        <input aria-label={t('assistantTaskFrom')} className={field} type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <input aria-label={t('assistantTaskTo')} className={field} type="date" value={to} onChange={e => setTo(e.target.value)} />
        <label className="flex items-center gap-1.5 text-[12px] text-ds-muted"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />{t('assistantTaskArchived')}</label>
      </div>
      {error ? <p role="alert" className="px-4 py-2 text-[12px] text-ds-danger">{error.includes('CONTINUATION_FEATURE_DISABLED') ? t('assistantTaskContinuationFeatureDisabled') : error.includes('CONTINUATION_SOURCE_UNAVAILABLE') ? t('assistantTaskContinuationSourceUnavailable') : error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-2">
        <div className="min-w-0 space-y-1 border-r border-ds-border p-3">
          {!page.tasks.length && !busy ? <p className="p-3 text-[12px] text-ds-muted">{t('assistantTaskEmpty')}</p> : null}
          {page.tasks.map(task => <button type="button" key={task.id} onClick={() => void detail(task.id)} className="block w-full rounded-xl p-3 text-left hover:bg-ds-hover">
            <span className="block truncate text-[13px] font-medium text-ds-ink">{taskHeadline(task.title, task.body)}</span>
            <span className="text-[11px] text-ds-muted">#{task.id.slice(0, 8)}…{task.id.slice(-4)} · {task.assistantName} · {t(assistantStatusKey(task.status))} · {new Date(task.updatedAt).toLocaleString()}</span>
          </button>)}
          {page.hasMore ? <button type="button" className={button} disabled={busy} onClick={() => void load(page.nextCursor)}>{t('assistantTaskLoadMore')}</button> : null}
        </div>
        <div className="min-w-0 space-y-3 p-4 text-[12px] text-ds-ink">
          {selected ? <>
            <h3 className="text-[14px] font-semibold">{taskHeadline(selected.task.title, selected.task.body)}</h3>
            <p className="break-all text-ds-muted">ID: {selected.task.id}</p>
            <p className="whitespace-pre-wrap break-words">{selected.task.body}</p>
            <p className="text-ds-muted">{t(assistantStatusKey(selected.task.status))} · {t('assistantTaskCreated', { time: new Date(selected.task.createdAt).toLocaleString() })}</p>
            <p className="text-ds-muted">{selected.task.delivery?.consumedAt ? t('assistantDeliveryConsumed') : selected.task.delivery?.receivedAt ? t('assistantDeliveryDownloaded') : selected.task.delivery?.storedAt ? t('assistantNoteDelivery_stored') : t('assistantNoteDelivery_queued')}</p>
            {selected.task.cancellationError ? <p className="text-ds-danger">{t('assistantCancellationNeedsAttention')}</p> : null}
            {selected.task.updates.map((update, i) => <p key={`${update.at}-${i}`} className="whitespace-pre-wrap break-words rounded-lg bg-ds-subtle p-2">{t(assistantStatusKey(update.status))} · {update.body}</p>)}
            {selected.notes.map(note => <p key={note.id} className="whitespace-pre-wrap break-words rounded-lg bg-ds-subtle p-2">{note.from === 'you' ? t('roomsSidebarYou') : selected.task.assistantName} · {note.body}</p>)}
            {selected.task.source ? <label className="flex items-start gap-2 rounded-lg border border-ds-border-muted p-2 text-ds-muted">
              <input type="checkbox" disabled={busy || !api?.setContinuation || ['completed', 'failed', 'revoked'].includes(selected.task.continuation?.state ?? '')} checked={selected.task.continuation?.enabled === true}
                onChange={event => void perform(() => api!.setContinuation!(selected.task.id, event.target.checked))} />
              <span>{t('assistantTaskAutoContinue')}<br />{t('assistantTaskAutoContinueHelp')}</span>
            </label> : null}
            {selected.task.continuation?.state === 'queued' ? <p className="text-ds-muted">{t('assistantTaskContinuationQueued')}</p> : null}
            {selected.task.continuation?.state === 'completed' ? <p className="text-ds-muted">{t('assistantTaskContinuationCompleted')}</p> : null}
            {selected.task.continuation?.state === 'failed' ? <p className="text-ds-muted">{t('assistantTaskContinuationFailed')}</p> : null}
            {selected.task.continuation?.state === 'revoked' ? <p className="text-ds-muted">{t('assistantTaskContinuationRevoked')}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy || !api?.archiveTask} onClick={() => void perform(() => api!.archiveTask!(selected.task.id, !selected.task.archived))}>{t(selected.task.archived ? 'assistantTaskUnarchive' : 'assistantTaskArchive')}</button>
              {selected.retryable.map(item => <button key={item.messageId} type="button" className={button} disabled={busy || !api?.retryDelivery} onClick={() => void perform(() => api!.retryDelivery!(item.messageId))}>{t('assistantTaskRetryDelivery', { kind: t(`assistantTaskRetryKind_${item.kind}`) })}</button>)}
              {['done', 'failed', 'cancelled'].includes(selected.task.status) ? <button type="button" className={button} disabled={busy || !api?.rerunTask} onClick={() => { if (window.confirm(t('assistantTaskRerunConfirm'))) void perform(() => api!.rerunTask!(selected.task.id)) }}>{t('assistantTaskRerun')}</button> : null}
            </div>
          </> : <p className="text-ds-muted">{t('assistantTaskSelect')}</p>}
        </div>
      </div>
    </section>
  </div>
}
