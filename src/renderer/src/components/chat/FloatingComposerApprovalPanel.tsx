import { useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import type { ChatBlock } from '../../agent/types'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { useChatStore } from '../../store/chat-store'
import { approvalCardModel } from './approval-card-model'
import { ApprovalCardPreview, ApprovalInlineCode, ApprovalKindGlyph, ApprovalOptionDescriptionText } from './approval-card-preview'
import { sendApprovalDenyNote } from './approval-deny-note'
import { setDockedApprovalIds } from './approval-dock-registry'
import { approvalOptionRows } from './approval-kind'
import { MemoryApprovalHint } from './memory-approval-hint'
import { rememberApprovalDenyNote } from './interrupt-card/approval-deny-note-memory'
import {
  InterruptBadge,
  InterruptCard,
  InterruptCardBody,
  InterruptCardHeader,
  InterruptFooter,
  InterruptFreeTextRow,
  InterruptNote,
  InterruptOptionList,
  InterruptOptionRow,
  InterruptPager,
  InterruptPrimaryButton,
  InterruptQuestionTitle,
  InterruptSecondaryButton
} from './interrupt-card/interrupt-card-primitives'
import { useInterruptOptionNavigation } from './interrupt-card/use-interrupt-option-navigation'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Pending runtime approvals take the composer shell's place (the shell stays
 * mounted underneath) so they cannot be scrolled past. One request is in
 * focus at a time, with a pager across the rest. It is decided from numbered
 * rows: digits 1-n decide at once, Up/Down / Tab move and Enter or Confirm decides
 * the active row. The final row is a note for the agent: Enter there (or
 * choosing a deny row) denies and steers the note into the running turn.
 * Decisions still flow through `resolveApproval`, so the transcript record
 * and this card never disagree about state, and every decision runs inside
 * the trusted user activation of the click or keydown that made it.
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
  const listId = `approval-options-${useId()}`
  const compact = variant === 'compact'

  useEffect(() => {
    setIndex((value) => Math.min(value, Math.max(0, approvals.length - 1)))
  }, [approvals.length])

  const dockedIds = approvals.map((approval) => approval.id).join('\n')
  useEffect(() => {
    setDockedApprovalIds(dockedIds ? dockedIds.split('\n') : [])
    return () => setDockedApprovalIds([])
  }, [dockedIds])

  const position = Math.max(0, Math.min(index, approvals.length - 1))
  const current = approvals[position] as ApprovalBlock | undefined
  const currentId = current?.id
  useEffect(() => {
    setExpanded(false)
    setNote('')
  }, [currentId])

  const model = useMemo(() => (current ? approvalCardModel(current, t) : null), [current, t])
  // Rows come narrowest grant first: Enter / Confirm on an untouched card picks "allow once" when offered.
  const { rows, deny } = approvalOptionRows(model?.family ?? 'other', current?.action?.permissionOptions, t)
  const options = [...rows, deny]
  const denyIndex = options.length - 1
  const submitting = current?.status === 'submitting'

  // A deny row carries the typed note; whitespace-only is a plain deny.
  const decide = (optionIndex: number): void => {
    const option = options[optionIndex]
    if (!current || !option || submitting) return
    const text = option.decision === 'deny' ? note.trim() : ''
    if (text) rememberApprovalDenyNote(current.id, text)
    void resolveApproval(current.id, option.decision, option.choice).then(() => {
      if (text) void sendApprovalDenyNote(text)
    })
  }
  // The note row confirms as the deny decision.
  const decisionIndex = (rowIndex: number): number => (rowIndex >= options.length ? denyIndex : rowIndex)

  const navigation = useInterruptOptionNavigation({
    optionCount: options.length,
    hasFreeText: true,
    resetKey: currentId,
    disabled: submitting,
    // The trusted keydown itself is the user activation; a scripted one is not.
    onDigit: (rowIndex, event) => runTrustedUserActivation(event, () => decide(rowIndex)),
    onConfirm: (rowIndex, event) => runTrustedUserActivation(event, () => decide(decisionIndex(rowIndex)))
  })

  if (!current || !model) return null
  const placeholder = t(model.family === 'email'
    ? 'composerApproval.feedbackEmailPlaceholder'
    : 'composerApproval.feedbackPlaceholder')
  const inset = compact ? 'mx-3.5 mb-2' : 'mx-4 mb-2.5'

  return (
    <InterruptCard
      ariaLabel={t('approvalTitle')}
      marker="approval"
      compact={compact}
      focusKey={currentId}
      onKeyDown={navigation.onKeyDown}
      data-approval-kind={model.content.kind}
      aria-busy={submitting || undefined}
    >
      <InterruptCardHeader
        trailing={approvals.length > 1 ? (
          <InterruptPager
            index={position}
            total={approvals.length}
            onPrevious={() => setIndex(Math.max(0, position - 1))}
            onNext={() => setIndex(Math.min(approvals.length - 1, position + 1))}
          />
        ) : undefined}
      >
        <span className="shrink-0">{t('composerApproval.header')}</span>
        <InterruptBadge icon={<ApprovalKindGlyph content={model.content} />}>{model.badge}</InterruptBadge>
      </InterruptCardHeader>
      <InterruptQuestionTitle>{model.question}</InterruptQuestionTitle>

      <InterruptCardBody data-approval-evidence-scroll>
        {/* Block flow: the body is a flex column, and flex items would shrink instead of scrolling. */}
        <div className="min-w-0">
          {model.description ? (
            <InterruptNote>
              <span className="line-clamp-3" title={model.description}><ApprovalInlineCode text={model.description} /></span>
            </InterruptNote>
          ) : null}
          {/* Without the reason line the box keeps the board's 10px (8px compact) below the question. */}
          <div className={model.description ? undefined : compact ? 'pt-1' : 'pt-1.5'}>
            <ApprovalCardPreview
              model={model}
              action={current.action}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((value) => !value)}
              compact={compact}
              t={t}
            />
          </div>
          <MemoryApprovalHint toolName={current.toolName} action={current.action} t={t} className={inset} />
          {current.errorMessage ? (
            <p role="alert" className={`text-[12px] leading-[18px] text-ds-status-danger ${inset}`}>{current.errorMessage}</p>
          ) : null}
          <InterruptOptionList
            id={listId}
            activeIndex={navigation.activeIndex}
            listboxRef={navigation.listboxRef}
            after={(
              <InterruptFreeTextRow
                index={options.length}
                value={note}
                onChange={setNote}
                placeholder={placeholder}
                ariaLabel={t('composerApproval.feedbackLabel')}
                active={navigation.isFreeTextActive}
                selected={navigation.isFreeTextActive}
                disabled={submitting}
                textareaRef={navigation.freeTextRef}
                onFocus={() => navigation.setActiveIndex(navigation.freeTextIndex, { focus: false })}
              />
            )}
          >
            {options.map((option, rowIndex) => (
              <InterruptOptionRow
                key={`${option.label}:${rowIndex}`}
                listId={listId}
                index={rowIndex}
                label={option.label}
                description={option.description ? <ApprovalOptionDescriptionText description={option.description} /> : undefined}
                selected={navigation.activeIndex === rowIndex}
                active={navigation.activeIndex === rowIndex}
                disabled={submitting}
                data-approval-choice={rowIndex + 1}
                data-approval-decision={option.decision}
                onSelect={(event) => {
                  navigation.setActiveIndex(rowIndex)
                  runTrustedUserActivation(event, () => decide(rowIndex))
                }}
              />
            ))}
          </InterruptOptionList>
          {submitting ? <span role="status" className="sr-only">{t('approvalSubmitting')}</span> : null}
        </div>
      </InterruptCardBody>

      {/* Digit keys reach options 1-9 only. */}
      <InterruptFooter hint={t('composerApproval.hint', { last: Math.min(options.length, 9) })}>
        <InterruptSecondaryButton
          variant="ghost"
          onClick={() => void interrupt()}
          disabled={submitting}
          title={t('approvalInterruptTurnHint')}
        >
          {t('approvalStopTurn')}
        </InterruptSecondaryButton>
        <InterruptPrimaryButton
          loading={submitting}
          onClick={(event) => runTrustedUserActivation(event, () => decide(decisionIndex(navigation.activeIndex)))}
          data-approval-confirm
        >
          {t('composerApproval.confirm')}
        </InterruptPrimaryButton>
      </InterruptFooter>
    </InterruptCard>
  )
}
