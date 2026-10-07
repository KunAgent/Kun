import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ExternalLink, GitBranch } from 'lucide-react'
import { AgentDispatchIntentPublicSchema, type AgentDispatchIntentView } from '@shared/agent-dispatch'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useAgentDispatchIntent } from './use-agent-dispatch-intent'
import { AgentDispatchIntentControls } from './AgentDispatchIntentControls'
import { selectWorkerPreview } from '../workers/worker-view-store'
import { OPEN_WORKERS_PANEL_EVENT } from './FloatingComposerWorkersPill'

export function isAgentDispatchBlock(block: ChatBlock): block is ToolBlock & { meta: Record<string, unknown> & { dispatchIntentId: string } } {
  return block.kind === 'tool' && typeof block.meta?.dispatchIntentId === 'string'
}

export function AgentDispatchGroup({ blocks, readOnly = false }: { blocks: ChatBlock[]; readOnly?: boolean }) {
  return <div className="space-y-3">{blocks.filter(isAgentDispatchBlock).map((block) =>
    <AgentDispatchCard key={block.id} block={block} readOnly={readOnly} />)}</div>
}

function AgentDispatchCard({ block, readOnly }: { block: ToolBlock; readOnly: boolean }) {
  const { t } = useTranslation('common')
  const activityRows = useActivityStore((state) => state.rows)
  const [now, setNow] = useState(Date.now)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const id = block.meta!.dispatchIntentId as string
  const parsed = AgentDispatchIntentPublicSchema.safeParse(block.meta?.dispatchIntent)
  const { intent, act, busy, error } = useAgentDispatchIntent(id, parsed.success ? parsed.data : undefined)
  const [draft, setDraft] = useState<{ title: string; task: string }>()
  const [saveError, setSaveError] = useState('')
  const intentState = intent?.state
  useEffect(() => {
    if (!intentState || !['queued', 'starting', 'running'].includes(intentState)) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [intentState])
  if (!intent) return <section className="rounded-xl border border-ds-border bg-ds-card p-4" role="status">
    {error || t('dispatchIntent.loading')}
  </section>
  const recommendation = intent.recommendation
  const startEdit = (paused: AgentDispatchIntentView) => setDraft({ title: paused.recommendation.title,
    task: paused.recommendation.task })
  const save = async () => {
    if (!draft?.title.trim() || !draft.task.trim()) return
    const next = await act('update', { recommendation: { title: draft.title.trim(), task: draft.task.trim() } })
    if (next) { setDraft(undefined); setSaveError('') }
    else setSaveError(t('dispatchIntent.updateFailed'))
  }
  const workerIds = intent.target?.workerIds ?? (intent.target?.threadId ? [intent.target.threadId] : [])
  const workerActivity = Object.values(activityRows).find((row) => workerIds.includes(row.unitId) || workerIds.includes(row.threadId))
  const action = workerActivity?.currentTool || workerActivity?.progressNote
  const elapsed = Math.max(0, Math.floor((now - Date.parse(workerActivity?.stateSince ?? intent.updatedAt)) / 1000))
  const openWorker = (workerId: string) => {
    selectWorkerPreview(intent.source.threadId, workerId)
    window.dispatchEvent(new CustomEvent(OPEN_WORKERS_PANEL_EVENT))
  }
  return <section className="min-w-0 rounded-2xl border border-ds-border bg-ds-card p-4 shadow-sm" data-agent-dispatch-card data-intent-id={id}>
    <header className="flex min-w-0 items-start gap-3">
      <span className="rounded-xl bg-accent/10 p-2 text-accent"><Bot size={18} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 break-words text-sm font-semibold text-ds-ink" title={recommendation.title}>{recommendation.title}</h4>
        <p className="mt-1 line-clamp-2 break-words text-xs text-ds-muted" title={recommendation.model}>
          {recommendation.agentName || recommendation.agentId}{recommendation.model ? ` · ${recommendation.model}` : ''}
        </p>
      </div>
    </header>
    {draft ? <div className="mt-3 space-y-2">
      <input value={draft.title} maxLength={512} aria-label={t('dispatchIntent.title')}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        className="w-full rounded-lg border border-ds-border bg-ds-bg p-2 text-sm" />
      <textarea value={draft.task} aria-label={t('dispatchIntent.task')} rows={4}
        onChange={(event) => setDraft({ ...draft, task: event.target.value })}
        className="w-full rounded-lg border border-ds-border bg-ds-bg p-2 text-xs" />
      <button type="button" disabled={busy || !draft.title.trim() || !draft.task.trim()} onClick={() => void save()}
        className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50">{t('dispatchIntent.save')}</button>
      <button type="button" disabled={busy} onClick={() => { setDraft(undefined); void act('resume') }}
        className="ml-2 rounded-lg px-3 py-1.5 text-xs hover:bg-ds-hover">{t('dispatchIntent.keepRecommendation')}</button>
      {saveError || error ? <p role="alert" className="text-xs text-red-600">{saveError || error}</p> : null}
    </div> : <details className="mt-3 text-xs text-ds-muted">
      <summary className="cursor-pointer">{t('dispatchIntent.details')}</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{recommendation.task}</p>
      {recommendation.acceptanceCriteria?.length ? <ul className="mt-2 list-disc space-y-1 pl-4">
        {recommendation.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}
      </ul> : null}
    </details>}
    {['queued', 'starting', 'running'].includes(intent.state) ? <p className="mt-2 break-words text-xs text-ds-muted" role="status">{action ? `${action} · ` : ''}{t('dispatchIntent.elapsed', { seconds: elapsed })}</p> : null}
    {recommendation.workspace ? <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-ds-faint">
      <GitBranch size={12} className="shrink-0" aria-hidden /><span className="truncate" title={recommendation.workspace}>{recommendation.workspace}</span>
    </p> : null}
    <p className="mt-2 text-xs text-ds-faint">{t('dispatchIntent.permissionLabel')}: {t(`dispatchIntent.permission.${recommendation.effectivePermissionMode ?? recommendation.permissionMode}`)}</p>
    <AgentDispatchIntentControls intentId={id} initial={intent} readOnly={readOnly || Boolean(draft) || activeThreadId !== intent.source.threadId} onEdit={startEdit} onTakeover={() => { if (workerIds[0]) openWorker(workerIds[0]) }} />
    {intent.replacementReason ? <p className="mt-2 break-words text-xs text-ds-muted">{intent.replacementReason}</p> : null}
    {intent.resultSummary ? <p className="mt-3 whitespace-pre-wrap break-words text-xs text-ds-ink">{intent.resultSummary}</p> : null}
    {workerIds.length ? <div className="mt-3 flex flex-wrap gap-2">
      {workerIds.map((workerId, index) => <button type="button" key={workerId} onClick={() => openWorker(workerId)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-accent hover:bg-ds-hover">
        <ExternalLink size={12} aria-hidden />{t('dispatchIntent.viewProcess')}{workerIds.length > 1 ? ` ${index + 1}` : ''}
      </button>)}
    </div> : null}
  </section>
}
