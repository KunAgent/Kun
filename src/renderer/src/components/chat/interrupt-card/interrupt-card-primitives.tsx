import {
  Children,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Info, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useInterruptCountdown, INTERRUPT_COUNTDOWN_WINDOW_SECONDS } from './interrupt-countdown'
import { useInterruptArmed } from './interrupt-arming'
import '../composer-tray/composer-tray.css'
import './interrupt-card.css'

export { InterruptCard, InterruptCardBody, type InterruptCardProps } from './interrupt-card-shell'

/*
 * Building blocks for the interrupt cards that take the composer shell's
 * place (ask-user questions, tool approvals). Layout and keyboard behavior
 * are shared; content and decisions stay with each card. The card shell
 * itself (InterruptCard, InterruptCardBody) lives in ./interrupt-card-shell.
 */

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/** Header row: leading content (status text, badge) and trailing (pager, countdown). */
export function InterruptCardHeader({
  children,
  trailing
}: {
  children?: ReactNode
  trailing?: ReactNode
}): ReactElement {
  return (
    <div className="ds-interrupt-card-header">
      <div className="ds-interrupt-card-header-lead">{children}</div>
      {trailing ? <div className="ds-interrupt-card-header-trail">{trailing}</div> : null}
    </div>
  )
}

/** Outline badge naming the topic or tool kind ("状态管理", "✎ 修改文件"). */
export function InterruptBadge({ icon, children }: { icon?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <span className="ds-interrupt-badge">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/** "‹ i / n ›" pager; renders nothing for a single item. `index` is 0-based. */
export function InterruptPager({
  index,
  total,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel
}: {
  index: number
  total: number
  onPrevious: () => void
  onNext: () => void
  previousLabel?: string
  nextLabel?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (total <= 1) return null
  const position = Math.min(Math.max(0, index), total - 1) + 1
  const previous = previousLabel ?? t('composerInterrupt.previous')
  const next = nextLabel ?? t('composerInterrupt.next')
  return (
    <span className="ds-interrupt-pager">
      <button
        type="button"
        className="ds-interrupt-icon-button ds-no-drag"
        aria-label={previous}
        title={previous}
        disabled={position <= 1}
        onClick={onPrevious}
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      </button>
      <span
        className="ds-interrupt-pager-position"
        aria-label={t('composerInterrupt.pagerPosition', { index: position, total })}
      >
        {position} / {total}
      </span>
      <button
        type="button"
        className="ds-interrupt-icon-button ds-no-drag"
        aria-label={next}
        title={next}
        disabled={position >= total}
        onClick={onNext}
      >
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * Deadline chip: hidden until the last `windowSeconds` (60), then "⏱ 42 秒",
 * then "Kun 正在自行决定…" once the deadline passes. Use interruptDeadlineMs
 * (./interrupt-countdown) to build `deadlineMs` from createdAt + timeoutSeconds.
 */
export function InterruptCountdownChip({
  deadlineMs,
  windowSeconds = INTERRUPT_COUNTDOWN_WINDOW_SECONDS
}: {
  deadlineMs: number | null | undefined
  windowSeconds?: number
}): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useInterruptCountdown(deadlineMs, windowSeconds)
  if (state.kind === 'hidden') return null
  if (state.kind === 'deciding') {
    return (
      <span className="ds-interrupt-countdown" role="status" data-interrupt-countdown="deciding">
        {t('composerInterrupt.deciding')}
      </span>
    )
  }
  return (
    <span
      className="ds-interrupt-countdown"
      title={t('composerInterrupt.countdownTitle', { seconds: state.seconds })}
      data-interrupt-countdown="counting"
    >
      <Clock className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      {t('composerInterrupt.countdown', { seconds: state.seconds })}
    </span>
  )
}

/** 15px semibold question / request title. */
export function InterruptQuestionTitle({ id, children }: { id?: string; children: ReactNode }): ReactElement {
  return <h2 id={id} className="ds-interrupt-question">{children}</h2>
}

/** Reason / rule line under the title. `faint` for constraints ("最多 3 项"). */
export function InterruptNote({
  tone = 'muted',
  children
}: {
  tone?: 'muted' | 'faint'
  children: ReactNode
}): ReactElement {
  return <p className="ds-interrupt-note" data-tone={tone}>{children}</p>
}

/** Tool preview box (command, diff): header row with optional status, then body. */
export function InterruptPreview({
  header,
  status,
  children
}: {
  header?: ReactNode
  status?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <div className="ds-interrupt-preview">
      {header || status ? (
        <div className="ds-interrupt-preview-header">
          <span className="flex min-w-0 items-center gap-1.5 truncate">{header}</span>
          {status ? <span className="ds-interrupt-preview-status">{status}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** DOM id of option `index` inside list `listId` (aria-activedescendant target). */
export function interruptOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`
}

/**
 * Option listbox. It is the keyboard focus target (tabIndex 0,
 * `data-interrupt-autofocus`); rows are referenced through
 * aria-activedescendant. `after` renders below the listbox inside the same
 * padded column (the free-text row is not an ARIA option).
 */
export function InterruptOptionList({
  id,
  label,
  multiSelect = false,
  activeIndex,
  listboxRef,
  after,
  children
}: {
  id: string
  label?: string
  multiSelect?: boolean
  /** Active row; ignored when it points past the options (free text). */
  activeIndex?: number
  listboxRef?: RefObject<HTMLDivElement | null>
  after?: ReactNode
  children: ReactNode
}): ReactElement {
  const { t } = useTranslation('common')
  const optionCount = Children.count(children)
  const activeDescendant = activeIndex != null && activeIndex >= 0 && activeIndex < optionCount
    ? interruptOptionId(id, activeIndex)
    : undefined
  return (
    <div className="ds-interrupt-options">
      {optionCount > 0 ? (
        <div
          ref={listboxRef}
          id={id}
          role="listbox"
          tabIndex={0}
          className="ds-interrupt-listbox ds-no-drag"
          aria-label={label ?? t('composerInterrupt.optionsLabel')}
          aria-multiselectable={multiSelect || undefined}
          aria-activedescendant={activeDescendant}
          data-interrupt-autofocus
        >
          {children}
        </div>
      ) : null}
      {after}
    </div>
  )
}

export type InterruptOptionRowProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'children' | 'id' | 'role'
> & {
  listId: string
  /** 0-based; the visible prefix is `index + 1`. */
  index: number
  label: ReactNode
  /** Inline secondary text (block-level in compact cards). */
  description?: ReactNode
  recommended?: boolean
  selected: boolean
  /** Keyboard-active row (hover fill). */
  active?: boolean
  multiSelect?: boolean
  disabled?: boolean
  /**
   * Click on the row (not called while the card is still arming). The click
   * event lets protected decisions check it: `runTrustedUserActivation(event, ...)`.
   */
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

/**
 * One option: "1." prefix (or a checkbox for multi-select), bold label,
 * optional "推荐" tag and inline description. Selected single-choice rows get
 * the neutral selected fill and an ink number. Rows are not tab stops and
 * keep focus where it is on mouse down, so the listbox keeps driving keys.
 */
export function InterruptOptionRow({
  listId,
  index,
  label,
  description,
  recommended = false,
  selected,
  active = false,
  multiSelect = false,
  disabled = false,
  onSelect,
  className,
  onMouseDown,
  ...rest
}: InterruptOptionRowProps): ReactElement {
  const { t } = useTranslation('common')
  const isArmed = useInterruptArmed()
  return (
    <button
      {...rest}
      type="button"
      id={interruptOptionId(listId, index)}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={`ds-interrupt-option ds-no-drag ${className ?? ''}`.trim()}
      data-interrupt-option={index}
      data-active={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-multi={multiSelect ? 'true' : undefined}
      onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        onMouseDown?.(event)
      }}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        if (!disabled && isArmed()) onSelect(event)
      }}
    >
      {multiSelect ? (
        <span className="ds-interrupt-check" data-checked={selected ? 'true' : undefined} aria-hidden="true">
          {selected ? <Check className="h-[11px] w-[11px]" strokeWidth={3.4} /> : null}
        </span>
      ) : (
        <span className="ds-interrupt-option-number" aria-hidden="true">{index + 1}.</span>
      )}
      <span className="ds-interrupt-option-text">
        <span className="ds-interrupt-option-label">{label}</span>
        {recommended ? (
          <span className="ds-interrupt-recommended">{t('composerInterrupt.recommended')}</span>
        ) : null}
        {description != null && description !== '' ? (
          <span className="ds-interrupt-option-description">{description}</span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * Final "type your own answer" row: same prefix column as the options (number,
 * or a dashed checkbox in multi-select) and an inline textarea that grows to
 * `maxRows` lines. Enter / IME handling lives in the navigation hook.
 */
export function InterruptFreeTextRow({
  index,
  value,
  onChange,
  placeholder,
  ariaLabel,
  active = false,
  selected = false,
  multiSelect = false,
  disabled = false,
  maxRows = 5,
  textareaRef,
  onFocus,
  autoFocus = false
}: {
  index: number
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel?: string
  active?: boolean
  /** Text is part of the answer (fills like a selected option / checks the box). */
  selected?: boolean
  multiSelect?: boolean
  disabled?: boolean
  maxRows?: number
  /** Usually `navigation.freeTextRef`. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Usually `() => navigation.setActiveIndex(navigation.freeTextIndex, { focus: false })`. */
  onFocus?: () => void
  /**
   * Make the textarea the card's autofocus target (a question without
   * options). A rendered option listbox comes first in the DOM and still wins.
   */
  autoFocus?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const ref = textareaRef ?? localRef
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof window === 'undefined') return
    element.style.height = 'auto'
    const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || 21
    const maxHeight = lineHeight * Math.max(1, maxRows)
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [maxRows, ref, value])
  return (
    <div
      className="ds-interrupt-option ds-interrupt-freetext"
      data-active={active ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-multi={multiSelect ? 'true' : undefined}
      data-interrupt-freetext
      onMouseDown={(event) => {
        if (event.target !== ref.current) {
          event.preventDefault()
          ref.current?.focus()
        }
      }}
    >
      {multiSelect ? (
        <span
          className="ds-interrupt-check"
          data-dashed={selected ? undefined : 'true'}
          data-checked={selected ? 'true' : undefined}
          aria-hidden="true"
        >
          {selected ? <Check className="h-[11px] w-[11px]" strokeWidth={3.4} /> : null}
        </span>
      ) : (
        <span className="ds-interrupt-option-number" aria-hidden="true">{index + 1}.</span>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel ?? t('composerInterrupt.freeTextLabel')}
        className="ds-interrupt-freetext-input ds-no-drag"
        data-interrupt-autofocus={autoFocus ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/** Footer (`<footer>`): ⓘ keyboard hint on the left, buttons (children) on the right. */
export function InterruptFooter({ hint, children }: { hint?: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <footer className="ds-interrupt-footer">
      <span className="ds-interrupt-hint">
        {hint ? (
          <>
            <Info className="h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="ds-interrupt-hint-text">{hint}</span>
          </>
        ) : null}
      </span>
      {children}
    </footer>
  )
}

/**
 * Click handler that ignores clicks while the surrounding card is still
 * arming (see InterruptCard). Footer buttons decide or dismiss requests.
 */
function useArmedClick(
  onClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
): (event: ReactMouseEvent<HTMLButtonElement>) => void {
  const isArmed = useInterruptArmed()
  return (event) => {
    if (!isArmed()) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }
}

/** Secondary footer action: `outline` (跳过) or quiet `ghost` (停止这一轮). */
export function InterruptSecondaryButton({
  variant = 'outline',
  className,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'outline' | 'ghost' }): ReactElement {
  const handleClick = useArmedClick(onClick)
  return (
    <button
      {...rest}
      type={type}
      onClick={handleClick}
      className={`ds-interrupt-button ds-no-drag ${className ?? ''}`.trim()}
      data-variant={variant}
    >
      {children}
    </button>
  )
}

/** Dark primary footer action (提交 / 下一题 → / 确认) with an optional spinner. */
export function InterruptPrimaryButton({
  loading = false,
  trailingIcon,
  className,
  type = 'button',
  disabled,
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  trailingIcon?: ReactNode
}): ReactElement {
  const handleClick = useArmedClick(onClick)
  return (
    <button
      {...rest}
      type={type}
      onClick={handleClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ds-interrupt-button ds-no-drag ${className ?? ''}`.trim()}
      data-variant="primary"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={2.2} aria-hidden="true" /> : null}
      {children}
      {loading ? null : trailingIcon}
    </button>
  )
}
