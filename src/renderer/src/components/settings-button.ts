import '../styles/settings-buttons.css'

export type SettingsButtonOptions = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'link'
  size?: 'default' | 'compact' | 'icon' | 'inline-icon'
  className?: string
}

/** Explicit action hierarchy without changing native button or activation semantics. */
export function settingsButtonClass({
  variant = 'secondary',
  size = 'default',
  className = ''
}: SettingsButtonOptions = {}): string {
  return `ds-settings-button ds-settings-button--${variant} ds-settings-button--${size} ${className}`.trim()
}
