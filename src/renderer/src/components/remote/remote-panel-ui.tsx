import { useState, type ReactElement, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const REMOTE_INPUT_CLASS =
  'rounded-md border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-[12px] text-ds-ink outline-none transition focus:border-[var(--ds-border-strong)] disabled:opacity-50'
export const REMOTE_BUTTON_CLASS =
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50'
export const REMOTE_PRIMARY_BUTTON_CLASS =
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg bg-accent px-3 text-[12px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

/** A captioned section: small heading above a white grouped list. */
export function RemoteSection({
  title,
  aside,
  children
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex min-h-[20px] items-center justify-between px-1">
        <h3 className="text-[12px] font-semibold text-ds-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function RemoteGroup({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col divide-y divide-ds-border-muted overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card">
      {children}
    </div>
  )
}

export function RemoteRow({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): ReactElement {
  return <div className={`flex min-h-[44px] items-center gap-2.5 px-3 py-2 ${className}`}>{children}</div>
}

export function RemoteIconTile({ active, children }: { active: boolean; children: ReactNode }): ReactElement {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
        active ? 'bg-accent-soft text-accent' : 'bg-ds-subtle text-ds-muted'
      }`}
      aria-hidden="true"
    >
      {children}
    </span>
  )
}

export function RemoteRowText({
  title,
  subtitle,
  subtitleClassName = 'text-ds-muted'
}: {
  title: ReactNode
  subtitle?: ReactNode
  subtitleClassName?: string
}): ReactElement {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] font-medium text-ds-ink">{title}</div>
      {subtitle ? <div className={`mt-px text-[12px] leading-4 ${subtitleClassName}`}>{subtitle}</div> : null}
    </div>
  )
}

export function RemoteSwitch({
  checked,
  disabled,
  label,
  onToggle
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? 'bg-accent' : 'bg-[var(--ds-border-strong)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function RemoteStatusDot({ on }: { on: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-emerald-500' : 'bg-[var(--ds-border-strong)]'}`}
    />
  )
}

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => { /* best-effort */ })
  }
  return [copied, copy]
}

export function RemoteCopyButton({ text }: { text: string }): ReactElement {
  const { t } = useTranslation('common')
  const [copied, copy] = useCopy(text)
  return (
    <button type="button" onClick={copy} title={t('remoteAccessCopyUrl')} className={REMOTE_BUTTON_CLASS}>
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {t(copied ? 'remoteAccessCopied' : 'remoteAccessCopy')}
    </button>
  )
}

/** A whole-row copy target for a secondary URL. */
export function RemoteUrlRow({ url, tone = 'ink' }: { url: string; tone?: 'ink' | 'success' }): ReactElement {
  const { t } = useTranslation('common')
  const [copied, copy] = useCopy(url)
  return (
    <button
      type="button"
      onClick={copy}
      title={t('remoteAccessCopyUrl')}
      className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-ds-hover"
    >
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[12px] ${
          tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ds-ink'
        }`}
      >
        {url}
      </span>
      {copied ? (
        <Check size={13} className="shrink-0 text-emerald-500" />
      ) : (
        <Copy size={13} className="shrink-0 text-ds-faint transition group-hover:text-ds-ink" />
      )}
    </button>
  )
}

/** "Safari · macOS" style label from a browser user agent. */
export function describeUserAgent(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : ''
  const os = /iPad/.test(userAgent)
    ? 'iPad'
    : /iPhone/.test(userAgent)
      ? 'iPhone'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : ''
  return [browser, os].filter(Boolean).join(' · ')
}
