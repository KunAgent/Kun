import { useEffect, useId, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import type { UserInputQuestion } from '../../agent/types'
import type { ComposerUserInputController } from './use-composer-user-input'
import {
  InterruptBadge,
  InterruptCard,
  InterruptCardBody,
  InterruptCardHeader,
  InterruptCountdownChip,
  InterruptFooter,
  InterruptFreeTextRow,
  InterruptNote,
  InterruptOptionList,
  InterruptOptionRow,
  InterruptPager,
  InterruptPrimaryButton,
  InterruptQuestionTitle,
  InterruptSecondaryButton,
  interruptOptionId
} from './interrupt-card/interrupt-card-primitives'
import { interruptDeadlineMs, useInterruptCountdown } from './interrupt-card/interrupt-countdown'
import { useInterruptOptionNavigation } from './interrupt-card/use-interrupt-option-navigation'
import {
  UserInputCardError,
  restoreCardFocus,
  revealRowInCardBody,
  userInputCardHint,
  userInputRuleText,
  type Translate
} from './user-input-card-parts'
import { isMultipleChoiceQuestion, shouldShowQuestionHeader } from './user-input-panel-logic'

/**
 * Ask-user card. It takes the composer shell's place (main composer and
 * narrow side conversations) with the shell's width and radius: one question
 * at a time, numbered option rows (checkboxes for multiple choice), a final
 * free-text row, and an explicit submit so a pick can be reviewed before it
 * resumes the agent.
 */
export function FloatingComposerUserInputPanel({
  controller,
  t,
  variant = 'main'
}: {
  controller: ComposerUserInputController
  t: Translate
  variant?: 'main' | 'compact'
}): ReactElement | null {
  const { block, currentQuestion } = controller
  if (!controller.active || !block || !currentQuestion) return null
  return (
    <UserInputCard
      controller={controller}
      question={currentQuestion}
      requestKey={`${block.id}:${currentQuestion.id}`}
      t={t}
      variant={variant}
    />
  )
}

function UserInputCard({
  controller,
  question,
  requestKey,
  t,
  variant
}: {
  controller: ComposerUserInputController
  question: UserInputQuestion
  requestKey: string
  t: Translate
  variant: 'main' | 'compact'
}): ReactElement {
  const compact = variant === 'compact'
  const listId = `user-input-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { block, index, total, submitting } = controller
  const options = question.options
  const multiSelect = isMultipleChoiceQuestion(question)
  const typed = controller.typedText(question.id)
  const hasTyped = typed.trim().length > 0
  const selectedIndex = options.findIndex((option) => controller.isSelected(question.id, option.label))
  const initialIndex = multiSelect
    ? 0
    : selectedIndex >= 0 ? selectedIndex : hasTyped ? options.length : 0

  const pick = (optionIndex: number): void => {
    const option = options[optionIndex]
    if (!option || controller.isOptionDisabled(question, option)) return
    controller.chooseOption(question, option)
  }

  const nav = useInterruptOptionNavigation({
    optionCount: options.length,
    hasFreeText: true,
    multiSelect,
    initialIndex,
    resetKey: requestKey,
    disabled: submitting,
    onDigit: pick,
    onToggle: pick,
    onConfirm: (activeIndex, event) => {
      // Enter typed in the text row confirms the text, even over an option
      // clicked after the text was typed (and even if the row's focus event
      // was missed, so the active row is stale).
      const inText = event.target === nav.freeTextRef.current
      const option = !multiSelect && !inText ? options[activeIndex] : undefined
      if (option) controller.confirmOption(question, option)
      else if (inText || activeIndex === options.length) controller.confirmTypedText(question)
      else controller.confirmCurrentQuestion()
    },
    onEscape: (event: ReactKeyboardEvent<HTMLElement>) => {
      const textarea = nav.freeTextRef.current
      if (options.length > 0 && textarea && event.target === textarea) {
        // Leave the text (keeping the draft) for the options: the pick, else
        // the last option, becomes the active row, so the row fill, the
        // listbox's active descendant and the hint match what the next key does.
        nav.setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length - 1)
        return
      }
      // Elsewhere (and in the text row of a question without options, which
      // has nothing else to return to; the hint says so) Esc goes back, or
      // skips on the first question.
      if (index > 0) controller.goToIndex(index - 1)
      else controller.cancel()
    }
  })

  // Rows are aria-activedescendant targets (focus stays on the listbox), so a
  // keyboard move into the scrolled-away part of a long list reveals the row.
  const { activeIndex, freeTextRef, listboxRef, setActiveIndex } = nav
  useEffect(() => {
    if (typeof document === 'undefined') return
    const row = activeIndex < options.length
      ? document.getElementById(interruptOptionId(listId, activeIndex))
      : freeTextRef.current?.closest<HTMLElement>('[data-interrupt-freetext]') ?? null
    revealRowInCardBody(row, activeIndex === 0)
  }, [activeIndex, freeTextRef, listId, options.length])

  // A failed submit / skip: the primary button was disabled while sending, so
  // the browser dropped its focus to the page. The editor is hidden, so bring
  // the keyboard back to the active row (focus the user moved elsewhere on
  // the page stays there).
  const failed = controller.error !== null
  useEffect(() => {
    if (!failed || typeof document === 'undefined') return
    restoreCardFocus(listboxRef.current ?? freeTextRef.current, () => setActiveIndex(activeIndex))
  }, [activeIndex, failed, freeTextRef, listboxRef, setActiveIndex])

  const deadlineMs = interruptDeadlineMs(block?.createdAt, block?.timeoutSeconds)
  const countdown = useInterruptCountdown(deadlineMs)
  const showBadge = shouldShowQuestionHeader(question, total)
  const showHeader = showBadge || total > 1 || countdown.kind !== 'hidden'
  const rule = userInputRuleText(question, t)
  const willSubmit = controller.canSubmit || controller.completesOnAnswer
  const primaryLabel = submitting
    ? t('composerAsk.submitting')
    : willSubmit ? t('composerAsk.submit') : t('composerAsk.next')

  return (
    <InterruptCard
      ariaLabel={t('composerAsk.cardLabel')}
      marker="user-input"
      compact={compact}
      focusKey={requestKey}
      onKeyDown={nav.onKeyDown}
      data-user-input-variant={variant}
      data-user-input-question={index + 1}
    >
      {showHeader ? (
        <InterruptCardHeader
          trailing={(
            <>
              <InterruptCountdownChip deadlineMs={deadlineMs} />
              <InterruptPager
                index={index}
                total={total}
                onPrevious={() => controller.goToIndex(index - 1)}
                onNext={() => controller.goToIndex(index + 1)}
                previousLabel={t('composerAsk.previousQuestion')}
                nextLabel={t('composerAsk.nextQuestion')}
              />
            </>
          )}
        >
          {showBadge ? <InterruptBadge>{question.header.trim()}</InterruptBadge> : null}
        </InterruptCardHeader>
      ) : (
        <div className="h-2 shrink-0" aria-hidden="true" />
      )}
      <InterruptCardBody>
        <InterruptQuestionTitle id={`${listId}-question`}>
          <span className="whitespace-pre-wrap">{question.question}</span>
        </InterruptQuestionTitle>
        {rule ? (
          <InterruptNote tone="faint">{rule}</InterruptNote>
        ) : (
          <div className={`shrink-0 ${compact ? 'h-1' : 'h-1.5'}`} aria-hidden="true" />
        )}
        <InterruptOptionList
          id={listId}
          label={question.question}
          multiSelect={multiSelect}
          activeIndex={nav.activeIndex}
          listboxRef={nav.listboxRef}
          after={(
            <InterruptFreeTextRow
              index={options.length}
              value={typed}
              onChange={(value) => controller.setTypedText(question, value)}
              placeholder={multiSelect ? t('composerAsk.otherPlaceholder') : t('composerAsk.freeTextPlaceholder')}
              active={nav.isFreeTextActive}
              selected={hasTyped && (multiSelect || selectedIndex < 0)}
              multiSelect={multiSelect}
              disabled={controller.isFreeTextDisabled(question)}
              textareaRef={nav.freeTextRef}
              onFocus={() => nav.setActiveIndex(nav.freeTextIndex, { focus: false })}
              autoFocus={options.length === 0}
            />
          )}
        >
          {options.map((option, optionIndex) => (
            <InterruptOptionRow
              key={option.label}
              listId={listId}
              index={optionIndex}
              label={option.label}
              description={option.description?.trim() || undefined}
              recommended={option.recommended === true}
              selected={controller.isSelected(question.id, option.label)}
              active={nav.activeIndex === optionIndex}
              multiSelect={multiSelect}
              disabled={submitting || controller.isOptionDisabled(question, option)}
              onSelect={() => {
                nav.setActiveIndex(optionIndex)
                pick(optionIndex)
              }}
            />
          ))}
        </InterruptOptionList>
        {controller.error !== null ? (
          <UserInputCardError message={controller.error} compact={compact} t={t} />
        ) : null}
      </InterruptCardBody>
      <InterruptFooter
        hint={compact ? undefined : userInputCardHint({
          multiSelect,
          typing: nav.isFreeTextActive,
          textOnly: options.length === 0,
          submits: willSubmit,
          first: index === 0,
          t
        })}
      >
        <InterruptSecondaryButton onClick={controller.cancel} disabled={submitting}>
          {t('composerAsk.skip')}
        </InterruptSecondaryButton>
        <InterruptPrimaryButton
          loading={submitting}
          disabled={!controller.canConfirmCurrentQuestion}
          onClick={controller.canSubmit ? controller.submitAnswers : controller.confirmCurrentQuestion}
          trailingIcon={willSubmit ? undefined : <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />}
          data-user-input-primary={willSubmit ? 'submit' : 'next'}
        >
          {primaryLabel}
        </InterruptPrimaryButton>
      </InterruptFooter>
    </InterruptCard>
  )
}
