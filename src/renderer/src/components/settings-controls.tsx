import {
  isValidElement,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff, Loader2, type LucideIcon } from 'lucide-react'

export type InlineNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
  copy?: { label: string; copiedLabel: string; text?: string }
  action?: { label: string; onClick: () => void }
}

export function SecretInput({
  value,
  onChange,
  onBlur,
  visible,
  onToggleVisibility,
  placeholder,
  autoComplete,
  invalid = false,
  toggleBusy = false,
  showLabel,
  hideLabel,
  className = ''
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  visible: boolean
  onToggleVisibility: () => void
  placeholder?: string
  autoComplete?: string
  invalid?: boolean
  toggleBusy?: boolean
  showLabel: string
  hideLabel: string
  className?: string
}): ReactElement {
  return (
    <div
      className={`flex min-h-9 w-full min-w-0 items-stretch overflow-hidden rounded-full bg-ds-card ${className} ${
        invalid
          ? 'border border-amber-300 focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-200'
          : 'border border-ds-border focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15'
      }`}
    >
      <input
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px] text-ds-ink focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        onClick={onToggleVisibility}
        disabled={toggleBusy}
        aria-busy={toggleBusy}
        className="shrink-0 border-l border-ds-border-muted px-3 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
      >
        {toggleBusy
          ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          : visible
            ? <EyeOff className="h-4 w-4" strokeWidth={1.75} />
            : <Eye className="h-4 w-4" strokeWidth={1.75} />}
      </button>
    </div>
  )
}

export function SectionJumpButton({
  label,
  onClick,
  active = false,
  controls
}: {
  label: string
  onClick: () => void
  active?: boolean
  controls?: string
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        active
          ? 'border-transparent bg-[var(--ds-control)] text-[var(--ds-control-foreground)]'
          : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {label}
    </button>
  )
}

export type SettingsTabItem<T extends string> = {
  id: T
  label: string
  icon?: LucideIcon
}

export type SettingsTabsProps<T extends string> = {
  items: readonly SettingsTabItem<T>[]
  value: T
  onChange: (value: T) => void
  baseId: string
  ariaLabel: string
  contentSized?: boolean
}

type SettingsTabVariant = 'primary' | 'secondary'

function SettingsTabList<T extends string>({
  items,
  value,
  onChange,
  baseId,
  ariaLabel,
  contentSized = false,
  variant
}: SettingsTabsProps<T> & {
  variant: SettingsTabVariant
}): ReactElement {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const secondary = variant === 'secondary'

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ): void => {
    if (items.length === 0) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % items.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + items.length) % items.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = items.length - 1
    }
    if (nextIndex === null) return

    event.preventDefault()
    const nextItem = items[nextIndex]
    if (!nextItem) return
    onChange(nextItem.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={
        secondary
          ? 'ds-settings-subtabs flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-ds-border-muted bg-ds-main/60 p-1'
          : `ds-settings-tabs grid w-full grid-flow-col gap-1 overflow-x-auto rounded-full border border-ds-border bg-ds-main p-1 ${
              contentSized ? 'auto-cols-max' : 'auto-cols-[minmax(8rem,1fr)]'
            }`
      }
    >
      {items.map((item, index) => {
        const active = item.id === value
        const Icon = item.icon
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            id={`${baseId}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={
              secondary
                ? `group flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    active
                      ? 'border-ds-border bg-ds-card text-ds-ink'
                      : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`
                : `group flex h-9 items-center justify-center gap-2 rounded-full border px-3 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    contentSized ? 'min-w-max whitespace-nowrap' : 'min-w-0'
                  } ${
                    active
                      ? 'border-ds-border bg-ds-card text-ds-ink'
                      : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`
            }
          >
            {Icon ? (
              <Icon
                aria-hidden="true"
                className={secondary ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'}
                strokeWidth={1.9}
              />
            ) : null}
            <span className={secondary || contentSized ? '' : 'truncate'}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsTabs<T extends string>(
  props: SettingsTabsProps<T>
): ReactElement {
  return <SettingsTabList {...props} variant="primary" />
}

export function SettingsSubTabs<T extends string>(
  props: SettingsTabsProps<T>
): ReactElement {
  return <SettingsTabList {...props} variant="secondary" />
}

type SettingsTabPanelProps<T extends string> = {
  baseId: string
  children: ReactNode
  className?: string
} & ({
  tabId: T
  active: boolean
} | {
  value: T
  activeValue: T
})

export function SettingsTabPanel<T extends string>(
  props: SettingsTabPanelProps<T>
): ReactElement {
  const {
    baseId,
    children,
    className = ''
  } = props
  const tabId = 'tabId' in props ? props.tabId : props.value
  const active = 'active' in props ? props.active : props.value === props.activeValue

  return (
    <div
      id={`${baseId}-panel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-tab-${tabId}`}
      hidden={!active}
      className={`ds-settings-tab-panel ${active ? '' : 'hidden'} ${className}`}
    >
      {children}
    </div>
  )
}

export function InlineNoticeView({
  notice
}: {
  notice: InlineNotice
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const className =
    notice.tone === 'error'
      ? 'border-red-300/80 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-200'
      : notice.tone === 'success'
        ? 'border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/25 dark:text-emerald-200'
        : 'border-ds-border bg-ds-main/50 text-ds-muted'

  return (
    // `min-w-0 break-words` keeps long messages (a failed-probe error can carry
    // a full URL or a 300-char response body) wrapping inside the container
    // instead of forcing horizontal overflow that stretches the settings panel
    // — the success notice is short so the bug only ever showed on failure (#617).
    <div className={`flex min-w-0 items-start gap-2 rounded-[var(--ds-radius-card)] border px-3 py-2 text-[12px] leading-5 ${className}`}>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice.message}</span>
      {notice.action || notice.copy ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {notice.action ? (
            <button
              type="button"
              className="rounded-md border border-current/20 px-2 py-0.5 font-medium transition hover:bg-current/10"
              onClick={notice.action.onClick}
            >
              {notice.action.label}
            </button>
          ) : null}
          {notice.copy ? (
            <button
              type="button"
              aria-label={copied ? notice.copy.copiedLabel : notice.copy.label}
              title={copied ? notice.copy.copiedLabel : notice.copy.label}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-current/20 px-2 font-medium transition hover:bg-current/10"
              onClick={() => {
                if (!navigator.clipboard?.writeText) return
                void navigator.clipboard.writeText(notice.copy?.text ?? notice.message).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1_400)
                }).catch(() => undefined)
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? notice.copy.copiedLabel : notice.copy.label}</span>
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

export function SettingsCard({
  title,
  children,
  className = '',
  collapsible = false,
  defaultOpen = false,
  description
}: {
  title: string
  children: ReactNode
  className?: string
  collapsible?: boolean
  defaultOpen?: boolean
  description?: string
}): ReactElement {
  if (collapsible) {
    return (
      <details
        className={`ds-settings-card ds-settings-card--collapsible group overflow-hidden rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-card ${className}`}
        open={defaultOpen || undefined}
      >
        <summary className="ds-settings-card-header flex cursor-pointer list-none items-center justify-between gap-4 px-5 transition hover:bg-ds-hover/55 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <h2 className="text-[16px] font-medium leading-tight text-ds-ink">{title}</h2>
            {description ? (
              <span className="mt-1 block text-[12px] leading-[1.4] text-ds-muted">{description}</span>
            ) : null}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180"
            strokeWidth={1.9}
          />
        </summary>
        <div className="ds-settings-card-body divide-y divide-ds-border-muted px-2">{children}</div>
      </details>
    )
  }

  return (
    <section
      className={`ds-settings-card rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-card ${className}`}
    >
      <div className="ds-settings-card-header px-5">
        <h2 className="text-[16px] font-medium leading-tight text-ds-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12px] leading-[1.4] text-ds-muted">{description}</p>
        ) : null}
      </div>
      <div className="ds-settings-card-body divide-y divide-ds-border-muted px-2">{children}</div>
    </section>
  )
}

export function SettingRow({
  title,
  description,
  control,
  wideControl = false
}: {
  title: string
  description?: string
  control: ReactNode
  wideControl?: boolean
}): ReactElement {
  const compactControl =
    !wideControl
    && isValidElement(control)
    && (control.type === Toggle || control.type === 'button')

  return (
    <div
      className={`ds-setting-row flex gap-3 px-3 py-3.5 ${
        wideControl
          ? 'ds-setting-row--wide flex-col sm:gap-3.5'
          : 'flex-col sm:flex-row sm:items-start sm:justify-between sm:gap-8'
      }`}
    >
      <div className={`min-w-0 ${wideControl ? 'w-full max-w-none shrink-0' : 'flex-1'}`}>
        <div className="text-[13px] font-medium text-ds-ink">{title}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-[1.4] text-ds-muted">{description}</p>
        ) : null}
      </div>
      <div
        className={`w-full min-w-0 ${
          wideControl
            ? ''
            : compactControl
              ? 'flex justify-end sm:w-fit sm:max-w-none sm:shrink-0'
              : 'flex justify-end sm:max-w-[420px]'
        }`}
      >
        {control}
      </div>
    </div>
  )
}

const CUSTOM_MODEL_OPTION = '__custom__'

/**
 * Model picker shared by the agents/write/speech/image sections. Renders a
 * select with an optional "default" first option (empty-string value, caller
 * maps it to its inherit semantics) plus the provider's model list. With
 * allowCustom, a final option reveals a free-text input for unlisted ids.
 */
export function ModelSelect({
  value,
  options,
  defaultLabel,
  optionLabel,
  allowCustom = false,
  customLabel = '',
  customPlaceholder = '',
  disabled = false,
  selectClassName = '',
  onChange
}: {
  value: string
  options: string[]
  defaultLabel?: string
  optionLabel?: (model: string) => string
  allowCustom?: boolean
  customLabel?: string
  customPlaceholder?: string
  disabled?: boolean
  selectClassName?: string
  onChange: (model: string) => void
}): ReactElement {
  const trimmed = value.trim()
  const listed = trimmed === '' || options.includes(trimmed)
  const [customSelected, setCustomSelected] = useState(allowCustom && !listed)
  // 自定义输入用本地草稿渲染:调用方可能会把空值钳制回默认模型,
  // 受控渲染存储值会导致输入框删不空、按键间被回填。
  const [customDraft, setCustomDraft] = useState(trimmed)
  const [customEditing, setCustomEditing] = useState(false)
  const lastValueRef = useRef(trimmed)
  if (trimmed !== lastValueRef.current) {
    lastValueRef.current = trimmed
    // 外部改动(切换供应商、恢复默认)在非编辑状态下同步进来,
    // 并在新值已在列表里时退出自定义模式,避免界面停留在过期的「自定义」。
    if (!customEditing && trimmed !== customDraft.trim()) {
      setCustomDraft(trimmed)
      if (listed) setCustomSelected(false)
    }
  }
  const customActive = allowCustom && (customSelected || !listed)
  const selectValue = customActive ? CUSTOM_MODEL_OPTION : trimmed
  return (
    <div className="grid w-full min-w-0 gap-2">
      <select
        className={selectClassName}
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          if (next === CUSTOM_MODEL_OPTION) {
            setCustomDraft(trimmed)
            setCustomSelected(true)
            return
          }
          setCustomSelected(false)
          setCustomDraft(next)
          onChange(next)
        }}
      >
        {defaultLabel !== undefined ? <option value="">{defaultLabel}</option> : null}
        {options.map((model) => (
          <option key={model} value={model}>
            {optionLabel ? optionLabel(model) : model}
          </option>
        ))}
        {allowCustom ? <option value={CUSTOM_MODEL_OPTION}>{customLabel}</option> : null}
      </select>
      {customActive ? (
        <input
          className="w-full min-w-0 rounded-full border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/15"
          value={customDraft}
          placeholder={customPlaceholder}
          spellCheck={false}
          disabled={disabled}
          onFocus={() => setCustomEditing(true)}
          onChange={(e) => {
            setCustomDraft(e.target.value)
            onChange(e.target.value)
          }}
          onBlur={() => {
            setCustomEditing(false)
            const draft = customDraft.trim()
            const stored = value.trim()
            if (!draft) {
              setCustomDraft(stored)
              if (stored === '' || options.includes(stored)) setCustomSelected(false)
            } else if (draft !== stored) {
              setCustomDraft(stored)
            }
          }}
        />
      ) : null}
    </div>
  )
}

export function AdvancedSettingsDisclosure({
  title,
  description,
  contentClassName = '',
  children
}: {
  title: string
  description?: string
  contentClassName?: string
  children: ReactNode
}): ReactElement {
  return (
    <details className="ds-settings-disclosure group overflow-hidden rounded-[var(--ds-radius-card)] border border-ds-border-muted bg-ds-main/35">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-ds-hover/70 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ds-ink">{title}</span>
          {description ? (
            <span className="mt-1 block text-[12px] leading-[1.4] text-ds-muted">{description}</span>
          ) : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.9} />
      </summary>
      <div className={`border-t border-ds-border-muted bg-ds-card/45 ${contentClassName}`}>{children}</div>
    </details>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        checked ? 'bg-[var(--ds-control)]' : 'bg-ds-faint'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.98]'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
