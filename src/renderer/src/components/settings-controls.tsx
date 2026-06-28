import { isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'

export type InlineNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
}

export function SecretInput({
  value,
  onChange,
  visible,
  onToggleVisibility,
  placeholder,
  autoComplete,
  invalid = false,
  showLabel,
  hideLabel,
  className = ''
}: {
  value: string
  onChange: (value: string) => void
  visible: boolean
  onToggleVisibility: () => void
  placeholder?: string
  autoComplete?: string
  invalid?: boolean
  showLabel: string
  hideLabel: string
  className?: string
}): ReactElement {
  return (
    <div
      className={`flex w-full min-w-0 items-stretch overflow-hidden rounded-xl bg-ds-card shadow-sm ${className} ${
        invalid
          ? 'border border-amber-300 focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-200'
          : 'border border-ds-border focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/30'
      }`}
    >
      <input
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[14px] text-ds-ink focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        onClick={onToggleVisibility}
        className="shrink-0 border-l border-ds-border-muted px-3 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        {visible ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
      </button>
    </div>
  )
}

export function SectionJumpButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
    >
      {label}
    </button>
  )
}

export function InlineNoticeView({
  notice
}: {
  notice: InlineNotice
}): ReactElement {
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
    <div
      className={`min-w-0 break-words rounded-xl border px-3 py-2 text-[12.5px] leading-5 ${className}`}
    >
      {notice.message}
    </div>
  )
}

export function SettingsCard({
  title,
  children,
  className = ''
}: {
  title: string
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <section
      className={`rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25 ${className}`}
    >
      <div className="border-b border-ds-border-muted px-5 py-3">
        <h2 className="text-[16px] font-semibold text-ds-ink">{title}</h2>
      </div>
      <div className="divide-y divide-ds-border-muted px-2 py-1">{children}</div>
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
      className={`flex gap-3 px-3 py-4 ${
        wideControl
          ? 'flex-col sm:gap-3.5'
          : 'flex-col sm:flex-row sm:items-start sm:justify-between sm:gap-8'
      }`}
    >
      <div className={`min-w-0 ${wideControl ? 'w-full max-w-none shrink-0' : 'flex-1'}`}>
        <div className="text-[14px] font-semibold text-ds-ink">{title}</div>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-ds-muted">{description}</p>
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
          className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
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
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): ReactElement {
  return (
    <details className="group overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/35">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-ds-hover/70 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ds-ink">{title}</span>
          {description ? (
            <span className="mt-1 block text-[12.5px] leading-5 text-ds-faint">{description}</span>
          ) : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.9} />
      </summary>
      <div className="border-t border-ds-border-muted bg-ds-card/45">{children}</div>
    </details>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled = false
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-out ${
        checked ? 'bg-emerald-500' : 'bg-ds-faint'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.98]'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
