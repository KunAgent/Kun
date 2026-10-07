import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { SettingsIconTone } from './settings-navigation'

/**
 * Rounded, softly tinted glyph tile used by the settings navigation and page
 * header. Purely decorative: the surrounding control carries the name.
 */
export function SettingsIconTile({
  icon: Icon,
  tone,
  size = 'sm',
  active = false,
  className = ''
}: {
  icon: LucideIcon
  tone: SettingsIconTone
  size?: 'sm' | 'lg'
  active?: boolean
  className?: string
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      data-active={active ? 'true' : undefined}
      className={`ds-settings-icon-tile ds-settings-icon-tile--${size} ${className}`.trim()}
    >
      <Icon className="ds-settings-icon-tile-glyph" strokeWidth={size === 'lg' ? 1.8 : 2} />
    </span>
  )
}
