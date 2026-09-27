import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import type { ActivityRow } from '@shared/activity-row'
import { displayBucket } from '@shared/activity-display'
import { useActivityStore } from '../../store/activity-store'
import { getProvider } from '../../agent/registry'
import { useMobileAdeAttention } from './use-mobile-ade-attention'
import type { MobileAttentionItem } from './mobile-agents-attention'
import { MobileLoadingState } from '../lib/MobileLoading'
import { mobileRelativeTime } from '../lib/relative-time'
import './mobile-agents.css'

/**
 * Read-only Mission Control + "needs you" list for the phone (P3-19):
 * approvals and worker questions resolve inline, every other wait opens the
 * owning conversation. Work is never dispatched from this surface.
 */

function stateLabel(row: ActivityRow, now: number, t: (key: string) => string): string {
  if (row.stalled) return t('adeStatusStalled')
  if (row.waitingReason) return t(`adeWaiting_${row.waitingReason}`)
  const bucket = displayBucket(row, now)
  if (bucket === 'working') return t('adeStatusWorking')
  if (bucket === 'review') return t('adeStatusReview')
  if (bucket === 'done') return t(row.lastOutcome === 'failed' ? 'adeStatusFailed' : 'adeStatusDone')
  return t('adeStatusIdle')
}

function ApprovalCard({ item, busy, onDecide }: {
  item: Extract<MobileAttentionItem, { kind: 'approval' }>
  busy: boolean
  onDecide: (decision: 'allow' | 'deny') => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <article className="kun-mobile-agents-card">
    <header>
      <span className="kun-mobile-agents-card-title">{item.row.title}</span>
      <span className="kun-mobile-agents-badge">{t('adeWaiting_approval')}</span>
    </header>
    <p className="kun-mobile-agents-card-detail">
      {item.approval.toolName}{item.approval.summary ? ` — ${item.approval.summary}` : ''}
    </p>
    <div className="kun-mobile-agents-card-actions">
      <button type="button" disabled={busy} onClick={() => onDecide('deny')}>{t('approvalDeny')}</button>
      <button type="button" disabled={busy} onClick={() => onDecide('allow')}>{t('approvalAllow')}</button>
    </div>
  </article>
}

function QuestionCard({ item, busy, onAnswer }: {
  item: Extract<MobileAttentionItem, { kind: 'question' }>
  busy: boolean
  onAnswer: (answer: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState('')
  const submit = (answer: string): void => {
    if (!answer.trim() || busy) return
    setDraft('')
    onAnswer(answer.trim())
  }
  return <article className="kun-mobile-agents-card">
    <header>
      <span className="kun-mobile-agents-card-title">{item.row.title}</span>
      <span className="kun-mobile-agents-badge">{t('adeWaiting_question')}</span>
    </header>
    <p className="kun-mobile-agents-card-detail">{item.question.question}</p>
    {item.question.options?.length ? <div className="kun-mobile-agents-card-actions">
      {item.question.options.map((option) => (
        <button key={option} type="button" disabled={busy} onClick={() => submit(option)}>{option}</button>
      ))}
    </div> : null}
    <div className="kun-mobile-agents-answer">
      <input
        value={draft}
        placeholder={t('missionAnswerPlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(draft) }}
      />
      <button type="button" disabled={busy || !draft.trim()} onClick={() => submit(draft)}>
        {t('missionAnswerSubmit')}
      </button>
    </div>
  </article>
}

function WaitCard({ item, onOpen }: {
  item: Extract<MobileAttentionItem, { kind: 'wait' }>
  onOpen: (threadId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <article className="kun-mobile-agents-card">
    <header>
      <span className="kun-mobile-agents-card-title">{item.row.title}</span>
      <span className="kun-mobile-agents-badge">{t(`adeWaiting_${item.reason}`)}</span>
    </header>
    <div className="kun-mobile-agents-card-actions">
      <button type="button" onClick={() => onOpen(item.row.threadId)}>{t('missionOpen')}</button>
    </div>
  </article>
}

function RowLine({ row, depth, time, now, onOpen }: {
  row: ActivityRow
  depth: number
  time: string
  now: number
  onOpen: (threadId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <button type="button" className="kun-mobile-agents-row" style={{ paddingInlineStart: 12 + depth * 16 }}
    onClick={() => onOpen(row.threadId)}>
    <span className={`kun-mobile-agents-dot kun-mobile-agents-dot-${displayBucket(row, now)}`} aria-hidden />
    <span className="kun-mobile-agents-row-body">
      <span className="kun-mobile-agents-row-title">{row.title}</span>
      <span className="kun-mobile-agents-row-meta">
        {stateLabel(row, now, t)}{row.progressNote ? ` · ${row.progressNote}` : ''}
      </span>
    </span>
    <span className="kun-mobile-agents-row-time">{time}</span>
  </button>
}

export function MobileAgentsHome({ onOpenThread, onOpenSettings }: {
  onOpenThread: (threadId: string) => void
  onOpenSettings: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const rows = useActivityStore((s) => s.rows)
  const status = useActivityStore((s) => s.status)
  const { items, refresh } = useMobileAdeAttention(rows)
  const now = Date.now()
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const allRows = useMemo(() => Object.values(rows), [rows])
  // Roots are parent-less units; workers and terminal agents nest under the
  // manager/thread row that owns them (docs/ade/06 §9 tree projection).
  const roots = useMemo(() => {
    const ids = new Set(allRows.map((row) => row.threadId))
    const list = allRows.filter((row) =>
      row.visibility !== 'archived' && (!row.parentThreadId || !ids.has(row.parentThreadId)))
    list.sort((a, b) => {
      const order = { 'needs-you': 0, working: 1, review: 2, done: 3, idle: 4 } as const
      const diff = order[displayBucket(a, now)] - order[displayBucket(b, now)]
      return diff !== 0 ? diff : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })
    return list
  }, [allRows, now])
  const childrenOf = useMemo(() => {
    const map = new Map<string, ActivityRow[]>()
    for (const row of allRows) {
      if (row.visibility === 'archived' || !row.parentThreadId) continue
      const list = map.get(row.parentThreadId) ?? []
      list.push(row)
      map.set(row.parentThreadId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    }
    return map
  }, [allRows])

  const decide = async (item: Extract<MobileAttentionItem, { kind: 'approval' }>, decision: 'allow' | 'deny'): Promise<void> => {
    const provider = getProvider()
    if (!provider.submitApprovalDecision) return
    setBusyId(item.unitId)
    setError('')
    try {
      await provider.submitApprovalDecision(item.approval.approvalId, decision, true)
      refresh(`appr:${item.row.threadId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId('')
    }
  }

  const answer = async (item: Extract<MobileAttentionItem, { kind: 'question' }>, answer: string): Promise<void> => {
    const provider = getProvider()
    if (!provider.answerTeamQuestion) return
    setBusyId(item.unitId)
    setError('')
    try {
      await provider.answerTeamQuestion(item.question.questionId, answer)
      const manager = item.row.parentThreadId ?? item.row.teamId ?? ''
      if (manager) refresh(`ov:${manager}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId('')
    }
  }

  const timeOf = (row: ActivityRow): string => mobileRelativeTime(row.updatedAt, i18n.language)
  const missionEmpty = roots.length === 0

  return <div className="kun-mobile-agents">
    <header className="kun-mobile-agents-header">
      <h1>{t('missionControl')}</h1>
      <button type="button" className="kun-mobile-agents-icon" aria-label={t('settings')}
        onClick={onOpenSettings}><Settings size={18} /></button>
    </header>
    {status !== 'live' ? <p className="kun-mobile-agents-feed" role="status">
      {t(`missionFeed_${status === 'error' ? 'error' : 'connecting'}`)}
    </p> : null}
    {error ? <p className="kun-mobile-agents-error" role="alert">{error}</p> : null}
    {items.length ? <section className="kun-mobile-agents-section">
      <h2>{t('missionColumnNeedsYou')}</h2>
      {items.map((item) => {
        if (item.kind === 'approval') {
          return <ApprovalCard key={item.unitId} item={item} busy={busyId === item.unitId}
            onDecide={(decision) => void decide(item, decision)} />
        }
        if (item.kind === 'question') {
          return <QuestionCard key={item.unitId} item={item} busy={busyId === item.unitId}
            onAnswer={(answerText) => void answer(item, answerText)} />
        }
        return <WaitCard key={item.unitId} item={item} onOpen={onOpenThread} />
      })}
    </section> : null}
    <section className="kun-mobile-agents-section">
      {status === 'idle' && missionEmpty ? <MobileLoadingState label={t('loading')} /> : null}
      {missionEmpty && status !== 'idle' ? <p className="kun-mobile-agents-empty">{t('missionEmpty')}</p> : null}
      {roots.map((root) => {
        const children = childrenOf.get(root.threadId) ?? []
        return <div key={root.unitId} className="kun-mobile-agents-group">
          <RowLine row={root} depth={0} time={timeOf(root)} now={now} onOpen={onOpenThread} />
          {children.map((child) =>
            <RowLine key={child.unitId} row={child} depth={1} time={timeOf(child)} now={now} onOpen={onOpenThread} />)}
        </div>
      })}
    </section>
  </div>
}
