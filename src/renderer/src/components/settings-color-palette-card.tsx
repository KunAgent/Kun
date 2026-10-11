import {
  DEFAULT_CUSTOM_DARK_ACCENT,
  DEFAULT_CUSTOM_LIGHT_PALETTE,
  DEFAULT_DARK_UI_COLORS,
  normalizeColorPaletteSettings,
  normalizeDarkUiColors,
  type AppSettingsV1,
  type ColorPaletteId,
  type ColorPaletteSettingsPatchV1,
  type DarkUiColorsPatchV1
} from '@shared/app-settings'
import { Check } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { COLOR_PALETTE_PRESETS, customPaletteSwatches, type PaletteSwatch } from '../lib/color-palettes'
import { settingsButtonClass } from './settings-button'
import { HexColorControl } from './settings-color-controls'
import { SettingRow, SettingsCard, SettingsReveal, Toggle } from './settings-controls'

type Translate = (key: string, values?: Record<string, unknown>) => string

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(DARK_QUERY).matches
}

/** Which half of each palette the previews show: the one the app is painting now. */
function useResolvedDark(theme: AppSettingsV1['theme']): boolean {
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (): void => setSystemDark(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])
  return theme === 'dark' || (theme === 'system' && systemDark)
}

function paletteKey(prefix: string, id: ColorPaletteId): string {
  return `${prefix}${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

/** A miniature window: sidebar with an active row, a user bubble, two lines, and the composer. */
function PalettePreview({ swatch }: { swatch: PaletteSwatch }): ReactElement {
  const line = (width: string, color: string, opacity: number): ReactElement => (
    <span className="block h-[5px] rounded-full" style={{ width, background: color, opacity }} />
  )
  return (
    <span
      className="ds-settings-palette-preview"
      aria-hidden="true"
      style={{ background: swatch.bg, borderColor: swatch.border }}
    >
      <span
        className="flex w-[30%] flex-col gap-1.5 border-r px-2 py-2.5"
        style={{ background: swatch.side, borderColor: swatch.border }}
      >
        {line('70%', swatch.text, 0.75)}
        <span className="flex h-3.5 items-center rounded-[5px] px-1" style={{ background: swatch.soft }}>
          {line('60%', swatch.accent, 1)}
        </span>
        {line('80%', swatch.muted, 0.45)}
        {line('62%', swatch.muted, 0.45)}
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span className="self-end rounded-lg px-2 py-[5px]" style={{ background: swatch.bubble }}>
          {line('2.75rem', swatch.bubbleFg, 0.75)}
        </span>
        {line('92%', swatch.text, 0.7)}
        {line('70%', swatch.muted, 0.5)}
        <span
          className="mt-auto flex h-[22px] items-center justify-end rounded-lg border px-[3px]"
          style={{ background: swatch.card, borderColor: swatch.border }}
        >
          <span className="h-4 w-4 rounded-full" style={{ background: swatch.accent }} />
        </span>
      </span>
    </span>
  )
}

function CustomPaletteEditor({
  palette,
  darkUiColors,
  t,
  onChange,
  onDarkUiColorsChange
}: {
  palette: ReturnType<typeof normalizeColorPaletteSettings>
  darkUiColors: ReturnType<typeof normalizeDarkUiColors>
  t: Translate
  onChange: (patch: ColorPaletteSettingsPatchV1) => void
  onDarkUiColorsChange: (patch: DarkUiColorsPatchV1) => void
}): ReactElement {
  const light = palette.customLight
  const isDefault =
    (Object.keys(DEFAULT_CUSTOM_LIGHT_PALETTE) as Array<keyof typeof light>)
      .every((key) => light[key] === DEFAULT_CUSTOM_LIGHT_PALETTE[key])
    && palette.customDarkAccent === DEFAULT_CUSTOM_DARK_ACCENT
    && (Object.keys(DEFAULT_DARK_UI_COLORS) as Array<keyof typeof darkUiColors>)
      .every((key) => darkUiColors[key] === DEFAULT_DARK_UI_COLORS[key])
  const groups = [
    {
      title: t('themeLight'),
      fields: [
        { label: t('darkUiColorsBackground'), value: light.background, set: (v: string) => onChange({ customLight: { background: v } }) },
        { label: t('darkUiColorsPanel'), value: light.panel, set: (v: string) => onChange({ customLight: { panel: v } }) },
        { label: t('darkUiColorsBorder'), value: light.border, set: (v: string) => onChange({ customLight: { border: v } }) },
        { label: t('colorPaletteAccent'), value: light.accent, set: (v: string) => onChange({ customLight: { accent: v } }) }
      ]
    },
    {
      title: t('themeDark'),
      fields: [
        { label: t('darkUiColorsBackground'), value: darkUiColors.background, set: (v: string) => onDarkUiColorsChange({ background: v }) },
        { label: t('darkUiColorsPanel'), value: darkUiColors.panel, set: (v: string) => onDarkUiColorsChange({ panel: v }) },
        { label: t('darkUiColorsBorder'), value: darkUiColors.border, set: (v: string) => onDarkUiColorsChange({ border: v }) },
        { label: t('colorPaletteAccent'), value: palette.customDarkAccent, set: (v: string) => onChange({ customDarkAccent: v }) }
      ]
    }
  ]
  return (
    <div className="ds-settings-palette-custom">
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.title} className="m-0 grid min-w-0 gap-2 border-0 p-0">
            <legend className="mb-2 text-[12px] font-semibold text-ds-muted">{group.title}</legend>
            {group.fields.map((field) => (
              <div key={field.label} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
                <span className="text-[12.5px] text-ds-ink">{field.label}</span>
                <HexColorControl
                  value={field.value}
                  ariaLabel={`${group.title} ${field.label}`}
                  onChange={field.set}
                />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12px] leading-5 text-ds-muted">{t('colorPaletteCustomHint')}</p>
        <button
          className={settingsButtonClass()}
          type="button"
          disabled={isDefault}
          onClick={() => {
            onChange({ customLight: { ...DEFAULT_CUSTOM_LIGHT_PALETTE }, customDarkAccent: DEFAULT_CUSTOM_DARK_ACCENT })
            onDarkUiColorsChange({ ...DEFAULT_DARK_UI_COLORS })
          }}
        >
          {t('colorPaletteCustomReset')}
        </button>
      </div>
    </div>
  )
}

export function ColorPaletteSettingsCard({
  form,
  t,
  onChange,
  onDarkUiColorsChange
}: {
  form: AppSettingsV1
  t: Translate
  onChange: (patch: ColorPaletteSettingsPatchV1) => void
  onDarkUiColorsChange: (patch: DarkUiColorsPatchV1) => void
}): ReactElement {
  const palette = normalizeColorPaletteSettings(form.colorPalette, form.darkUiColors)
  const darkUiColors = normalizeDarkUiColors(form.darkUiColors)
  const dark = useResolvedDark(form.theme)
  const mode = dark ? 'dark' : 'light'
  const custom = customPaletteSwatches(palette, darkUiColors)
  const options: Array<{ id: ColorPaletteId; swatch: PaletteSwatch }> = [
    ...COLOR_PALETTE_PRESETS.map((entry) => ({ id: entry.id, swatch: entry[mode] })),
    { id: 'custom', swatch: custom[mode] }
  ]
  const currentName = t(paletteKey('colorPaletteName', palette.id))

  return (
    <SettingsCard
      title={t('colorPaletteTitle')}
      description={t('colorPaletteDesc')}
      action={
        <span className="whitespace-nowrap text-[12px] text-ds-muted">
          {t('colorPaletteCurrent', { name: currentName, mode: t(dark ? 'themeDark' : 'themeLight') })}
        </span>
      }
    >
      <div className="ds-settings-palette-grid" role="radiogroup" aria-label={t('colorPaletteTitle')}>
        {options.map((option) => {
          const checked = palette.id === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-color-palette-choice={option.id}
              className="ds-settings-option"
              onClick={() => onChange({ id: option.id })}
            >
              <PalettePreview swatch={option.swatch} />
              <span className="flex min-w-0 flex-col gap-0.5 pr-6">
                <span className="ds-settings-option-title">{t(paletteKey('colorPaletteName', option.id))}</span>
                <span className="ds-settings-option-description">{t(paletteKey('colorPaletteDesc', option.id))}</span>
              </span>
              <span className="ds-settings-option-check ds-settings-palette-check" aria-hidden="true">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </button>
          )
        })}
      </div>
      <SettingsReveal open={palette.id === 'custom'}>
        <CustomPaletteEditor
          palette={palette}
          darkUiColors={darkUiColors}
          t={t}
          onChange={onChange}
          onDarkUiColorsChange={onDarkUiColorsChange}
        />
      </SettingsReveal>
      <SettingRow
        title={t('colorPalettePackFirst')}
        description={t('colorPalettePackFirstDesc')}
        control={
          <Toggle
            checked={palette.uiPackFirst}
            onChange={(enabled) => onChange({ uiPackFirst: enabled })}
          />
        }
      />
    </SettingsCard>
  )
}
