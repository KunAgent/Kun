import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { useChatStore } from '../../store/chat-store'
import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalEmailPreview } from './ApprovalEmailPreview'
import { setDockedApprovalIds } from './approval-dock-registry'
import {
  ApprovalKindIcon,
  approvalKind,
  approvalOptionRows,
  approvalQuestion,
  type ApprovalKind,
  type ApprovalOptionRow
} from './approval-kind'
import { sendApprovalDenyNote } from './approval-deny-note'
import { MemoryApprovalHint } from './memory-approval-hint'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

type Translate = (key: string, options?: Record<string, unknown>) => string

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * Pending runtime approvals take over the space above the composer so they
 * cannot be scrolled past. One request is in focus at a time and is decided
 * from a numbered list (keys 1-n when no text field has focus); the last row
 * declines and can carry a note that is steered into the running turn.
 * Decisions still flow through `resolveApproval`, so the transcript record
 * and this panel never disagree about state.
 */
export function FloatingComposerApprovalPanel({
  approvals,
  t,
  variant = 'main'
}: {
  approvals: ApprovalBlock[]
  t: Translate
  variant?: 'main' | 'compact'
}): ReactElement | null {
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  const interrupt = useChatStore((s) => s.interrupt)
  const [index, setIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [note, setNote] = useState('')
  const compact = variant === 'compact'

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, approvals.length - 1)))
  }, [approvals.length])

  const dockedIds = approvals.map((approval) => approval.id).join('\n')
  useEffect(() => {
    setDockedApprovalIds(dockedIds ? dockedIds.split('\n') : [])
    return () => setDockedApprovalIds([])
  }, [dockedIds])

  const current = approvals[Math.min(index, approvals.length - 1)]
  const currentId = current?.id
  useEffect(() => {
    setExpanded(false)
    setNote('')
  }, [currentId])

  const kind = approvalKind(current?.action)
  const { rows, deny } = approvalOptionRows(kind, current?.action?.permissionOptions, t)
  const submitting = current?.status === 'submitting'
  const decide = (row: ApprovalOptionRow, withNote = false): void => {
    if (!current || submitting) return
    const text = withNote ? note.trim() : ''
    void resolveApproval(current.id, row.decision, row.choice).then(() => {
      if (text) void sendApprovalDenyNote(text)
    })
  }

  const choicesRef = useRef<{ choices: Array<() => void> }>({ choices: [] })
  choicesRef.current.choices = [...rows.map((row) => () => decide(row)), () => decide(deny, true)]
  useEffect(() => {
    if (!currentId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest(EDITABLE)) return
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return
      const choice = choicesRef.current.choices[Number(event.key) - 1]
      if (!/^[1-9]$/.test(event.key) || !choice) return
      event.preventDefault()
      // The trusted keydown itself is the user activation; a scripted click would not be.
      runTrustedUserActivation(event, choice)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentId])

  if (!current) return null
  const pad = compact ? 'px-4' : 'px-[18px]'
  const inset = compact ? 'ml-[58px] mr-4' : 'ml-16 mr-[18px]'
  const notePlaceholder = t(kind.kind === 'email' ? 'approvalEmailNotePlaceholder' : 'approvalDenyNotePlaceholder')

  return (
    <section
      aria-label={t('approvalTitle')}
      data-composer-stack-item="approval"
      className={`ds-no-drag pointer-events-auto relative z-30 flex max-h-[70dvh] w-full flex-col overflow-hidden border border-ds-border bg-ds-card shadow-[0_10px_32px_rgba(24,39,75,0.08)] ${
        compact ? 'rounded-[16px]' : 'rounded-[20px]'
      }`}
    >
      <header className={`flex shrink-0 items-start gap-3 pb-1.5 pt-4 ${pad}`}>
        <ApprovalKindIcon kind={kind.kind} />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[14.5px] font-semibold leading-5 text-ds-ink [overflow-wrap:anywhere]">
            {approvalQuestion(kind, current.toolName, t)}
          </h2>
          <p className="truncate text-[12.5px] leading-5 text-ds-muted">{approvalSubtitle(kind, t)}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {expanded ? t('approvalCollapse') : t('approvalExpand')}
        </button>
      </header>

      <div className="min-h-0 overflow-y-auto" data-approval-evidence-scroll>
        <div className={`mb-3 mt-1.5 ${inset}`}>
          <ApprovalPreview kind={kind} block={current} expanded={expanded} t={t} />
          <MemoryApprovalHint toolName={current.toolName} action={current.action} t={t} />
          {current.errorMessage ? (
            <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{current.errorMessage}</p>
          ) : null}
        </div>
      </div>

      <div className={`flex shrink-0 flex-col gap-0.5 pb-2.5 ${compact ? 'px-2' : 'px-2.5'}`} data-testid="approval-actions">
        {rows.map((row, rowIndex) => (
          <button
            key={`${row.label}:${rowIndex}`}
            type="button"
            data-approval-choice={rowIndex + 1}
            disabled={submitting}
            onClick={(event) => runTrustedUserActivation(event, () => decide(row))}
            className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[14px] text-ds-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-wait disabled:opacity-60 ${
              rowIndex === 0 ? 'bg-accent-tint/10 font-semibold hover:bg-accent-tint/15' : 'hover:bg-ds-hover'
            }`}
          >
            <ChoiceKey number={rowIndex + 1} primary={rowIndex === 0} />
            <span className="min-w-0 flex-1 break-words">{row.label}</span>
          </button>
        ))}
        <div className="flex items-center gap-3 rounded-[12px] px-3 py-1.5">
          <button
            type="button"
            data-approval-choice={rows.length + 1}
            disabled={submitting}
            onClick={(event) => runTrustedUserActivation(event, () => decide(deny, true))}
            className="flex shrink-0 items-center gap-3 rounded-lg py-1 text-[14px] text-ds-ink transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-wait disabled:opacity-60"
          >
            <ChoiceKey number={rows.length + 1} />
            <span>{deny.label}</span>
          </button>
          <input
            value={note}
            disabled={submitting}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || !note.trim()) return
              event.preventDefault()
              runTrustedUserActivation(event, () => decide(deny, true))
            }}
            aria-label={notePlaceholder}
            placeholder={notePlaceholder}
            className="min-w-0 flex-1 border-0 border-b border-ds-border-muted bg-transparent px-0.5 py-1.5 text-[13.5px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-accent"
          />
        </div>
        {submitting ? <span role="status" className="sr-only">{t('approvalSubmitting')}</span> : null}
      </div>

      <footer className={`flex shrink-0 items-center gap-2 border-t border-ds-border-muted py-2 text-[12px] text-ds-muted ${pad}`}>
        {approvals.length > 1 ? (
          <span className="flex items-center gap-0.5">
            <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}
              aria-label={t('findInChatPrevious')}
              className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35">
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <span className="tabular-nums">{t('approvalQueueCount', { index: index + 1, total: approvals.length })}</span>
            <button type="button" onClick={() => setIndex((value) => Math.min(approvals.length - 1, value + 1))}
              disabled={index >= approvals.length - 1} aria-label={t('findInChatNext')}
              className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35">
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </span>
        ) : kind.kind === 'email' && kind.email.from ? (
          <span className="min-w-0 truncate">{t('approvalEmailFromLine', { email: kind.email.from })}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void interrupt()}
          disabled={submitting}
          title={t('approvalInterruptTurnHint')}
          className="ml-auto shrink-0 rounded-md px-1.5 py-1 transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('approvalStopTurn')}
        </button>
      </footer>
    </section>
  )
}

function approvalSubtitle(kind: ApprovalKind, t: Translate): string {
  if (kind.kind === 'email') {
    return t('approvalEmailSummary', { to: kind.email.to.join(', '), subject: kind.email.subject || t('approvalEmailNoSubject') })
  }
  if (kind.kind === 'command' && kind.cwd) return t('approvalCommandIn', { cwd: kind.cwd })
  return t('approvalPending')
}

function ChoiceKey({ number, primary = false }: { number: number; primary?: boolean }): ReactElement {
  return (
    <span aria-hidden="true" className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${
      primary ? 'bg-accent text-white' : 'bg-ds-subtle text-ds-muted'
    }`}>
      {number}
    </span>
  )
}

function ApprovalPreview({ kind, block, expanded, t }: {
  kind: ApprovalKind
  block: ApprovalBlock
  expanded: boolean
  t: Translate
}): ReactElement {
  if (kind.kind === 'email') {
    return expanded
      ? <ApprovalEmailPreview email={kind.email} t={t} />
      : <div className="rounded-[10px] bg-ds-subtle px-3 py-2.5 text-[13px] leading-[1.6] text-ds-ink">
          <p className="line-clamp-3 whitespace-pre-line break-words [overflow-wrap:anywhere]">{kind.email.body}</p>
        </div>
  }
  if (kind.kind === 'command' && expanded) return <ApprovalDetails action={block.action} />
  const mono = kind.kind === 'command' ? kind.command : block.summary
  return (
    <>
      <div
        tabIndex={0}
        className={`rounded-[10px] bg-ds-subtle px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ds-ink ${
          expanded ? 'max-h-60 overflow-y-auto' : ''
        }`}
      >
        <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{mono}</p>
      </div>
      {expanded ? <ApprovalDetails action={block.action} /> : null}
    </>
  )
}
