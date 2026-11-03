import type { ReactElement, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Toggle } from './settings-controls'
import { SettingsIconTile } from './settings-icon-tile'
import type { SettingsIconTone } from './settings-navigation'
import { SettingsReveal } from './settings-reveal'

/**
 * One switchable capability: a header that says what it is and whether it is
 * on, and its detailed settings, which slide open once it is switched on.
 * Without `onEnabledChange` the body is always shown (a group of independent
 * switches) and `enabled` only drives the "on" badge.
 */
export function SettingsFeatureCard({
  icon,
  tone,
  title,
  description,
  enabled,
  onEnabledChange,
  toggleLabel,
  toggleDisabled = false,
  enabledLabel,
  children
}: {
  icon: LucideIcon
  tone: SettingsIconTone
  title: string
  description?: ReactNode
  enabled: boolean
  onEnabledChange?: (enabled: boolean) => void
  toggleLabel?: string
  toggleDisabled?: boolean
  enabledLabel: string
  children?: ReactNode
}): ReactElement {
  const switchable = typeof onEnabledChange === 'function'
  return (
    <section className="ds-settings-feature" data-enabled={enabled ? 'true' : 'false'} aria-label={title}>
      <div className="ds-settings-feature-head">
        <SettingsIconTile icon={icon} tone={tone} size="md" active={enabled} />
        <div className="min-w-0 flex-1">
          <h3 className="ds-settings-feature-title">
            <span className="min-w-0">{title}</span>
            <span className="ds-settings-feature-badge" aria-hidden={enabled ? undefined : true}>{enabledLabel}</span>
          </h3>
          {description ? <div className="ds-settings-feature-description">{description}</div> : null}
        </div>
        {switchable ? (
          <Toggle
            checked={enabled}
            disabled={toggleDisabled}
            ariaLabel={toggleLabel ?? title}
            onChange={(next) => onEnabledChange?.(next)}
          />
        ) : null}
      </div>
      {children ? (
        switchable ? (
          <SettingsReveal open={enabled}>
            <div className="ds-settings-feature-body divide-y divide-ds-border-muted">{children}</div>
          </SettingsReveal>
        ) : (
          <div className="ds-settings-feature-body divide-y divide-ds-border-muted">{children}</div>
        )
      ) : null}
    </section>
  )
}
