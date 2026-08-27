import type { ReactElement } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  CornerDownLeft,
  Loader2
} from 'lucide-react'
import type { UserInputOption } from '../../agent/types'
import type { ComposerUserInputController } from './use-composer-user-input'
import { UserInputTimeoutCountdownChip } from './floating-composer-user-input-timeout'
import {
  isMultipleChoiceQuestion,
  shouldShowQuestionHeader
} from './user-input-panel-logic'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Actionable ask-user surface shared by the main composer and narrow side
 * conversations. Both variants keep one question in focus, use full-width
 * option rows, and require an explicit final submit so a selection can be
 * reviewed before it resumes the agent.
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
  const { currentQuestion, total, index } = controller
  if (!controller.active || !currentQuestion) return null

  const compact = variant === 'compact'
  const hasOptions = currentQuestion.options.length > 0
  const multipleChoice = isMultipleChoiceQuestion(currentQuestion)
  const showHeader = shouldShowQuestionHeader(currentQuestion, total)
  const primaryLabel = controller.canSubmit
    ? t('userInputSubmitAnswers')
    : t('userInputNext')

  return (
    <section
      aria-label={t('userInputTitle')}
      data-composer-stack-item="user-input"
      data-user-input-variant={variant}
      className={`ds-no-drag pointer-events-auto relative z-30 w-full overflow-hidden border border-ds-border bg-ds-card shadow-[0_16px_42px_rgba(20,47,95,0.11)] ${
        compact ? 'rounded-[16px]' : 'rounded-[20px]'
      }`}
    >
      <header className={`border-b border-ds-border-muted ${compact ? 'px-4 py-3.5' : 'px-5 py-4'}`}>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-accent/20 bg-accent/10 text-accent">
              <CircleHelp className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold leading-5 text-ds-ink">
                {t('userInputTitle')}
              </h2>
              <p className="mt-0.5 text-[12px] leading-5 text-ds-faint">
                {t('userInputChooseToContinue')}
              </p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-2 pt-1">
            <UserInputTimeoutCountdownChip block={controller.block} t={t} />
            <span className="text-[12px] font-semibold tabular-nums text-ds-muted">
              {index + 1} / {total}
            </span>
          </span>
        </div>

        <div
          className="mt-3 flex gap-1.5"
          role="group"
          aria-label={t('userInputQuestionProgress', { current: index + 1, total })}
        >
          {controller.questions.map((question, questionIndex) => {
            const answered = controller.isAnswered(question.id)
            const current = questionIndex === index
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => controller.goToIndex(questionIndex)}
                aria-current={current ? 'step' : undefined}
                aria-label={t('userInputQuestionProgress', {
                  current: questionIndex + 1,
                  total
                })}
                className={`h-1 min-w-0 flex-1 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  current
                    ? 'bg-accent'
                    : answered
                      ? 'bg-accent/45 hover:bg-accent/60'
                      : 'bg-ds-border-muted hover:bg-ds-border'
                }`}
              />
            )
          })}
        </div>
      </header>

      <div className={compact ? 'px-4 py-4' : 'px-5 py-5'}>
        {showHeader ? (
          <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ds-faint">
            {currentQuestion.header}
          </div>
        ) : null}
        <p className={`whitespace-pre-wrap break-words font-semibold text-ds-ink [overflow-wrap:anywhere] ${
          compact ? 'text-[14px] leading-6' : 'text-[15px] leading-6'
        }`}>
          {currentQuestion.question}
        </p>

        {hasOptions ? (
          <div className={`flex flex-col ${compact ? 'mt-3 gap-2' : 'mt-4 gap-2.5'}`}>
            {currentQuestion.options.map((option) => (
              <OptionRow
                key={option.label}
                option={option}
                multiple={multipleChoice}
                selected={controller.isSelected(currentQuestion.id, option.label)}
                disabled={
                  controller.submitting ||
                  controller.isOptionDisabled(currentQuestion, option)
                }
                compact={compact}
                onSelect={() => controller.chooseOption(currentQuestion, option)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 flex min-h-11 items-center gap-2 rounded-[12px] border border-dashed border-ds-border bg-ds-main/35 px-3 text-[12.5px] leading-5 text-ds-muted">
            <CornerDownLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
            <span>{t('userInputPanelFreeformHint')}</span>
          </div>
        )}

        {multipleChoice ? (
          <p className="mt-2.5 text-[11.5px] leading-5 text-ds-faint">
            {t('userInputMultipleHint')}
          </p>
        ) : null}
      </div>

      <footer className={`flex min-h-14 items-center justify-between gap-3 border-t border-ds-border-muted bg-ds-main/25 ${
        compact ? 'px-4 py-2.5' : 'px-5 py-3'
      }`}>
        <button
          type="button"
          onClick={controller.cancel}
          disabled={controller.submitting}
          className="min-h-9 rounded-[10px] px-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('userInputCancel')}
        </button>

        <div className="flex items-center gap-2">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => controller.goToIndex(index - 1)}
              disabled={controller.submitting}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[11px] border border-ds-border bg-ds-card px-3 text-[13px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              <span>{t('userInputBack')}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={
              controller.canSubmit
                ? controller.submitAnswers
                : controller.confirmCurrentQuestion
            }
            disabled={!controller.canConfirmCurrentQuestion || controller.submitting}
            className="inline-flex min-h-10 items-center gap-2 rounded-[11px] border border-accent bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_rgba(37,99,235,0.2)] transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-ds-border-muted disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none"
          >
            {controller.submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : controller.canSubmit ? (
              <Check className="h-4 w-4" strokeWidth={2.2} />
            ) : null}
            <span>{controller.submitting ? t('userInputSubmitting') : primaryLabel}</span>
            {!controller.submitting && !controller.canSubmit ? (
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            ) : null}
          </button>
        </div>
      </footer>
    </section>
  )
}

function OptionRow({
  option,
  multiple,
  selected,
  disabled,
  compact,
  onSelect
}: {
  option: UserInputOption
  multiple: boolean
  selected: boolean
  disabled: boolean
  compact: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`group flex min-h-11 w-full min-w-0 items-start gap-3 rounded-[12px] border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
        compact ? 'px-3 py-2.5' : 'px-3.5 py-3'
      } ${
        selected
          ? 'border-accent bg-accent/[0.07] text-ds-ink shadow-[0_4px_12px_rgba(37,99,235,0.08)]'
          : disabled
            ? 'cursor-not-allowed border-ds-border-muted bg-ds-subtle text-ds-faint opacity-65'
            : 'border-ds-border bg-ds-card text-ds-muted hover:border-accent/45 hover:bg-accent/[0.025] hover:text-ds-ink'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border transition ${
          multiple ? 'rounded-[6px]' : 'rounded-full'
        } ${
          selected
            ? 'border-accent bg-accent text-white'
            : 'border-ds-border bg-ds-card group-hover:border-accent/60'
        }`}
      >
        {selected ? (
          multiple ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-white" />
          )
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block break-words text-[12px] leading-5 text-ds-faint [overflow-wrap:anywhere]">
            {option.description}
          </span>
        ) : null}
      </span>
    </button>
  )
}
