import { settingsButtonClass } from './settings-button'
import type {
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  defaultModelRequestRetrySettings
} from '@shared/app-settings'
import {
  SlidersHorizontal,
  X
} from 'lucide-react'
import {
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Toggle
} from './settings-controls'
import type { ProviderCapability } from './settings-section-providers-profile'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'


export const fieldLabelClass = 'grid gap-2 text-[13px] font-semibold text-ds-ink'
export const textInputClass =
  'h-11 w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-3.5 text-[14px] font-normal text-ds-ink transition focus:border-accent/55 focus:outline-none focus:ring-2 focus:ring-accent/15'
export const providerSelectControlClass =
  'h-11 w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-3.5 text-[14px] font-normal text-ds-ink transition focus:border-accent/55 focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-55'
export function retryStatusCodesText(codes: readonly number[] | undefined): string {
  return (codes?.length ? codes : defaultModelRequestRetrySettings().httpStatusCodes).join(',')
}

export function providerRetrySettings(provider: ModelProviderProfileV1) {
  return provider.retry ?? defaultModelRequestRetrySettings()
}

export function parseRetryStatusCodes(value: string): number[] {
  const codes = new Set<number>()
  for (const part of value.split(/[\s,]+/)) {
    const code = Number(part.trim())
    if (Number.isInteger(code) && code >= 400 && code <= 599) codes.add(code)
  }
  return codes.size > 0
    ? [...codes].sort((a, b) => a - b)
    : defaultModelRequestRetrySettings().httpStatusCodes
}

export function DetailSection({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <section className="grid gap-4 border-t border-ds-border-muted pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ds-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatusPill({
  tone,
  icon,
  children,
  title
}: {
  tone: 'success' | 'warning' | 'error' | 'muted'
  icon?: ReactNode
  children: ReactNode
  title?: string
}): ReactElement {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
        : tone === 'error'
          ? 'border-red-300/70 bg-red-50 text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-300'
          : 'border-ds-border-muted bg-ds-main/50 text-ds-muted'
  return (
    <span
      title={title}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${toneClass}`}
    >
      {icon}
      {children}
    </span>
  )
}

export function CapabilitySection({
  capabilityId,
  icon,
  title,
  description,
  enabled,
  invalid,
  expanded,
  modelCountLabel,
  configureLabel,
  collapseLabel,
  enabledLabel,
  disabledLabel,
  needsConfigurationLabel,
  toggleDisabled = false,
  onToggle,
  onExpandedChange,
  children
}: {
  capabilityId: ProviderCapability
  icon: ReactNode
  title: string
  description: string
  enabled: boolean
  invalid?: boolean
  expanded: boolean
  modelCountLabel?: string
  configureLabel: string
  collapseLabel: string
  enabledLabel: string
  disabledLabel: string
  needsConfigurationLabel: string
  toggleDisabled?: boolean
  onToggle: (enabled: boolean) => void
  onExpandedChange: (expanded: boolean) => void
  children: ReactNode
}): ReactElement {
  return (
    <section className={`rounded-2xl border bg-ds-card transition ${
      enabled ? 'border-ds-border shadow-sm' : 'border-ds-border-muted'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
            enabled ? 'bg-accent/10 text-accent' : 'bg-ds-main text-ds-faint'
          }`}>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-ds-ink">{title}</h3>
              <StatusPill tone={invalid ? 'warning' : enabled ? 'success' : 'muted'}>
                {invalid ? needsConfigurationLabel : enabled ? enabledLabel : disabledLabel}
              </StatusPill>
              {modelCountLabel ? (
                <span className="text-[11.5px] text-ds-faint">{modelCountLabel}</span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ds-faint">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className={settingsButtonClass()}
            type="button"
            disabled={!enabled}
            aria-expanded={enabled && expanded}
            aria-controls={`provider-capability-${capabilityId}`}
            aria-label={`${expanded ? collapseLabel : configureLabel}: ${title}`}
            onClick={() => onExpandedChange(!expanded)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
            {expanded ? collapseLabel : configureLabel}
          </button>
          <Toggle
            checked={enabled}
            onChange={onToggle}
            disabled={toggleDisabled}
            ariaLabel={title}
          />
        </div>
      </div>
      {enabled && expanded ? (
        <div id={`provider-capability-${capabilityId}`} className="border-t border-ds-border-muted px-4 py-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}

export function ProviderBadge({
  tone,
  children
}: {
  tone: 'accent' | 'warning'
  children: ReactNode
}): ReactElement {
  const toneClass =
    tone === 'accent'
      ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
      : 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${toneClass}`}>
      {children}
    </span>
  )
}

export function ProviderListGroup({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: ReactNode
}): ReactElement {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ds-faint">{label}</span>
        <span className="text-[11px] font-medium text-ds-faint">· {count}</span>
      </div>
      <div className="grid max-h-[360px] gap-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  )
}

export function ModelChipsInput({
  values,
  onChange,
  placeholder,
  inputAriaLabel,
  removeLabel
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  inputAriaLabel: string
  removeLabel: (model: string) => string
}): ReactElement {
  const [draft, setDraft] = useState('')

  const commit = (raw: string): void => {
    const ids = raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
    setDraft('')
    if (ids.length === 0) return
    const seen = new Set(values)
    const next = [...values]
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    if (next.length !== values.length) onChange(next)
  }

  const removeAt = (index: number): void => {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2 py-1.5 shadow-sm focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/30">
      {values.map((model, index) => (
        <span
          key={`${model}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-ds-border-muted bg-ds-main/60 py-0.5 pl-2.5 pr-1 font-mono text-[12px] text-ds-ink"
        >
          <span className="truncate">{model}</span>
          <button
            type="button"
            aria-label={removeLabel(model)}
            onClick={() => removeAt(index)}
            className={settingsButtonClass({ variant: 'ghost', size: 'inline-icon' })}
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[150px] flex-1 bg-transparent px-1 py-1 font-mono text-[12.5px] font-normal text-ds-ink placeholder:text-ds-faint focus:outline-none"
        value={draft}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            e.preventDefault()
            removeAt(values.length - 1)
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (/[\s,]/.test(text)) {
            e.preventDefault()
            commit(`${draft} ${text}`)
          }
        }}
      />
    </div>
  )
}
