import {
  DEFAULT_DARK_UI_COLORS,
  type DarkUiColorsPatchV1,
  type DarkUiColorsV1
} from '@shared/app-settings'
import type { ReactElement } from 'react'
import { HexColorControl } from './settings-color-controls'
import { SettingRow, SettingsCard } from './settings-controls'

type Translate = (key: string, values?: Record<string, unknown>) => string

export function DarkUiColorsSettingsCard({
  colors,
  t,
  onChange
}: {
  colors: DarkUiColorsV1
  t: Translate
  onChange: (patch: DarkUiColorsPatchV1) => void
}): ReactElement {
  const fields = [
    { key: 'background' as const, label: t('darkUiColorsBackground'), description: t('darkUiColorsBackgroundDesc') },
    { key: 'border' as const, label: t('darkUiColorsBorder'), description: t('darkUiColorsBorderDesc') },
    { key: 'panel' as const, label: t('darkUiColorsPanel'), description: t('darkUiColorsPanelDesc') }
  ]
  const isDefault = fields.every(({ key }) => colors[key] === DEFAULT_DARK_UI_COLORS[key])

  return (
    <SettingsCard title={t('darkUiColorsTitle')}>
      {fields.map(({ key, label, description }) => (
        <SettingRow
          key={key}
          title={label}
          description={description}
          control={
            <HexColorControl
              value={colors[key]}
              ariaLabel={label}
              onChange={(color) => onChange({ [key]: color })}
            />
          }
        />
      ))}
      <SettingRow
        title={t('darkUiColorsPreview')}
        description={t('darkUiColorsDarkOnlyHint')}
        wideControl
        control={
          <div className="grid w-full gap-3">
            <div
              aria-label={t('darkUiColorsPreview')}
              className="rounded-2xl p-4"
              style={{ backgroundColor: colors.background }}
            >
              <div
                className="rounded-xl border p-4 shadow-sm"
                style={{ backgroundColor: colors.panel, borderColor: colors.border }}
              >
                <div className="h-2 w-24 rounded-full bg-white/70" />
                <div className="mt-3 h-2 w-40 max-w-full rounded-full bg-white/30" />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={isDefault}
                onClick={() => onChange({ ...DEFAULT_DARK_UI_COLORS })}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('darkUiColorsReset')}
              </button>
            </div>
          </div>
        }
      />
    </SettingsCard>
  )
}
