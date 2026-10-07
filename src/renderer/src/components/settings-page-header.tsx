import type { ReactElement } from 'react'
import { AlertTriangle, Check, CircleAlert, Hand, LoaderCircle, Zap } from 'lucide-react'
import { SettingsIconTile } from './settings-icon-tile'
import { settingsNavigationItem, type SettingsCategory } from './settings-navigation'

export type SettingsSaveStatusTone = 'manual' | 'blocked' | 'saving' | 'saved' | 'error' | 'idle'

export function settingsSaveStatusTone({
  explicitSavePanel,
  portError,
  saveStatus
}: {
  explicitSavePanel: boolean
  portError: unknown
  saveStatus: string
}): SettingsSaveStatusTone {
  if (explicitSavePanel) return 'manual'
  if (portError) return 'blocked'
  if (saveStatus === 'saving') return 'saving'
  if (saveStatus === 'saved') return 'saved'
  if (saveStatus === 'error') return 'error'
  return 'idle'
}

const STATUS_LABEL_KEYS: Record<SettingsSaveStatusTone, string> = {
  manual: 'adeSettings.manualSaveHint',
  blocked: 'autoApplyBlocked',
  saving: 'applying',
  saved: 'applied',
  error: 'applyFailed',
  idle: 'autoApplyHint'
}

function StatusGlyph({ tone }: { tone: SettingsSaveStatusTone }): ReactElement {
  const className = 'ds-settings-status-glyph'
  if (tone === 'saving') return <LoaderCircle aria-hidden="true" className={`${className} animate-spin`} strokeWidth={2.2} />
  if (tone === 'saved') return <Check aria-hidden="true" className={className} strokeWidth={2.6} />
  if (tone === 'error') return <CircleAlert aria-hidden="true" className={className} strokeWidth={2.2} />
  if (tone === 'blocked') return <AlertTriangle aria-hidden="true" className={className} strokeWidth={2.2} />
  if (tone === 'manual') return <Hand aria-hidden="true" className={className} strokeWidth={2} />
  return <Zap aria-hidden="true" className={className} strokeWidth={2} />
}

/** Live auto-apply state. The keyed inner span replays a short entrance on every change. */
export function SettingsSaveStatusPill({
  tone,
  title,
  t
}: {
  tone: SettingsSaveStatusTone
  title?: string
  t: (key: string) => string
}): ReactElement {
  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      data-tone={tone}
      className="ds-settings-status shrink-0"
    >
      <span key={tone} className="ds-settings-status-content">
        <StatusGlyph tone={tone} />
        <span className="truncate">{t(STATUS_LABEL_KEYS[tone])}</span>
      </span>
    </span>
  )
}

export function SettingsPageHeader({
  category,
  title,
  description,
  status
}: {
  category: SettingsCategory
  title: string
  description: string
  status?: ReactElement | null
}): ReactElement {
  const item = settingsNavigationItem(category)
  return (
    <div className="ds-settings-page-header flex items-start justify-between gap-5">
      <div className="flex min-w-0 items-start gap-4">
        {item ? <SettingsIconTile icon={item.icon} tone={item.tone} size="lg" className="ds-settings-page-header-tile" /> : null}
        <div className="min-w-0">
          <h1 className="ds-settings-page-title">{title}</h1>
          <p className="ds-settings-page-description">{description}</p>
        </div>
      </div>
      {status ?? null}
    </div>
  )
}
