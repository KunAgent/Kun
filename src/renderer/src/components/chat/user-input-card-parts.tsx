import type { ReactElement } from 'react'
import { CircleAlert } from 'lucide-react'
import type { UserInputQuestion } from '../../agent/types'
import { multiSelectRule } from './user-input-panel-logic'

export type Translate = (key: string, options?: Record<string, unknown>) => string

/** Rule line under a multiple-choice question ("可以多选，最多 3 项"); null otherwise. */
export function userInputRuleText(question: UserInputQuestion, t: Translate): string | null {
  const rule = multiSelectRule(question)
  if (!rule) return null
  switch (rule.kind) {
    case 'any':
      return t('composerAsk.ruleAny')
    case 'max':
      return t('composerAsk.ruleMax', { count: rule.count })
    case 'min':
      return t('composerAsk.ruleMin', { count: rule.count })
    case 'exact':
      return t('composerAsk.ruleExact', { count: rule.count })
    case 'range':
      return t('composerAsk.ruleRange', { min: rule.min, max: rule.max })
  }
}

/**
 * Footer keyboard hint. Enter submits once this answer completes the set and
 * moves on otherwise; Esc skips the request on the first question and goes
 * back elsewhere. While the free-text row is active (always for a question
 * without options) the hint is about typing instead; Esc there only leaves the
 * text, except in a question without options (`textOnly`), where it goes
 * back / skips and the hint says so.
 */
export function userInputCardHint({
  multiSelect,
  typing,
  textOnly = false,
  submits,
  first,
  t
}: {
  multiSelect: boolean
  typing: boolean
  textOnly?: boolean
  submits: boolean
  first: boolean
  t: Translate
}): string {
  const enter = submits ? t('composerAsk.hintEnterSubmit') : t('composerAsk.hintEnterNext')
  const escape = first ? t('composerAsk.hintEscapeSkip') : t('composerAsk.hintEscapeBack')
  if (typing) {
    return textOnly ? t('composerAsk.hintTextOnly', { enter, escape }) : t('composerAsk.hintText', { enter })
  }
  if (multiSelect) return t('composerAsk.hintMulti', { enter })
  return t('composerAsk.hintSingle', { enter, escape })
}

/**
 * Brings the keyboard back to the card after focus fell to the page (a
 * focused button that turned disabled while sending): `focusRow` focuses the
 * active row, and the card itself is the fallback (e.g. a disabled text row).
 * Focus the user moved anywhere else is left alone.
 */
export function restoreCardFocus(anchor: HTMLElement | null, focusRow: () => void): void {
  const active = document.activeElement
  if (active && active !== document.body) return
  const card = anchor?.closest<HTMLElement>('.ds-interrupt-card')
  if (!card) return
  focusRow()
  if (!card.contains(document.activeElement)) card.focus({ preventScroll: true })
}

/**
 * Scrolls the card body (not the page) just enough to show `row`, or back to
 * the top (question included) for the first row; a no-op while the body does
 * not scroll.
 */
export function revealRowInCardBody(row: HTMLElement | null, first = false): void {
  const body = row?.closest<HTMLElement>('.ds-interrupt-card-body')
  if (!row || !body || body.scrollHeight <= body.clientHeight) return
  if (first) {
    body.scrollTop = 0
    return
  }
  const rowRect = row.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  if (rowRect.top < bodyRect.top) body.scrollTop -= bodyRect.top - rowRect.top + 4
  else if (rowRect.bottom > bodyRect.bottom) body.scrollTop += rowRect.bottom - bodyRect.bottom + 4
}

/** Inline error row when submitting (or skipping) did not reach the runtime. */
export function UserInputCardError({
  message,
  compact,
  t
}: {
  message: string
  compact: boolean
  t: Translate
}): ReactElement {
  const text = message.trim()
    ? t('composerAsk.submitFailed', { message: message.trim() })
    : t('composerAsk.submitFailedGeneric')
  return (
    <div
      role="alert"
      data-user-input-error
      className={`mt-2 flex items-start gap-1.5 rounded-[10px] bg-ds-danger-soft px-2.5 py-1.5 text-[12px] leading-[18px] text-ds-status-danger ${
        compact ? 'mx-3.5' : 'mx-4'
      }`}
    >
      <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </div>
  )
}
