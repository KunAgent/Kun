import type { AppSettingsV1 } from '@shared/app-settings'
import {
  CHAT_CONTENT_MAX_WIDTH_MAX,
  CHAT_CONTENT_MAX_WIDTH_MIN,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN
} from '@shared/app-settings'
import { Check } from 'lucide-react'
import type { ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsReveal, Toggle } from './settings-controls'
import { SpotlightColorControl } from './settings-color-controls'
import { ColorPaletteSettingsCard } from './settings-color-palette-card'

type ThemeChoice = AppSettingsV1['theme']

const THEME_CHOICES: Array<{ value: ThemeChoice; labelKey: string }> = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' }
]

const stepperButtonClass =
  'flex h-7 w-7 items-center justify-center text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

/** A slider with a precise numeric field and ± steps; shared by font size and text width. */
function ScaleControl({
  label,
  min,
  max,
  step,
  value,
  displayValue,
  unit,
  minGlyph,
  maxGlyph,
  decreaseLabel,
  increaseLabel,
  bigStep,
  onChange,
  onDisplayChange
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  displayValue: number
  unit: string
  minGlyph: ReactElement | string
  maxGlyph: ReactElement | string
  decreaseLabel: string
  increaseLabel: string
  bigStep: number
  onChange: (value: number) => void
  onDisplayChange: (value: number) => void
}): ReactElement {
  return (
    <div className="flex w-full min-w-0 items-center gap-3 md:max-w-md">
      <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">{minGlyph}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        className="w-full accent-accent"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">{maxGlyph}</span>
      <div className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-ds-border bg-ds-card">
        <button type="button" aria-label={decreaseLabel} className={stepperButtonClass} onClick={() => onChange(value - bigStep)}>−</button>
        <div className="flex h-7 min-w-[3.75rem] items-center justify-center border-x border-ds-border px-1.5 tabular-nums">
          <input
            type="number"
            value={displayValue}
            aria-label={label}
            className="hide-number-spinner w-10 border-0 bg-transparent p-0 text-center text-[13px] font-medium text-ds-ink outline-none"
            onChange={(e) => onDisplayChange(Number(e.target.value))}
          />
          <span className="text-[11px] text-ds-faint">{unit}</span>
        </div>
        <button type="button" aria-label={increaseLabel} className={stepperButtonClass} onClick={() => onChange(value + bigStep)}>+</button>
      </div>
    </div>
  )
}

/** Theme, text size and colour: everything that changes how Kun looks. */
export function AppearanceSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update } = ctx
  const fontScale = normalizeUiFontScale(form.uiFontScale)
  const setFontScale = (value: number): void => update({ uiFontScale: normalizeUiFontScale(value) })
  const chatWidth = normalizeChatContentMaxWidth(form.chatContentMaxWidthPx)
  const setChatWidth = (value: number): void =>
    update({ chatContentMaxWidthPx: normalizeChatContentMaxWidth(value) })
  const spotlightOn = form.cursorSpotlight !== false

  return (
    <>
      <SettingsCard title={t('theme')} description={t('themeDesc')}>
        <div className="ds-settings-option-grid" role="radiogroup" aria-label={t('theme')}>
          {THEME_CHOICES.map((choice) => {
            const checked = form.theme === choice.value
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={checked}
                data-theme-choice={choice.value}
                className="ds-settings-option"
                onClick={() => update({ theme: choice.value })}
              >
                <span className="ds-settings-theme-thumb" data-theme-preview={choice.value} aria-hidden="true">
                  <span className="ds-settings-theme-thumb-side" />
                  <span className="ds-settings-theme-thumb-main">
                    <span className="ds-settings-theme-thumb-bar w-3/5" />
                    <span className="ds-settings-theme-thumb-bar w-5/6" />
                    <span className="ds-settings-theme-thumb-bar w-2/5" />
                  </span>
                </span>
                <span className="ds-settings-option-title">{t(choice.labelKey)}</span>
                <span className="ds-settings-option-check" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <ColorPaletteSettingsCard
        form={form}
        t={t}
        onChange={(colorPalette) => update({ colorPalette })}
        onDarkUiColorsChange={(darkUiColors) => update({ darkUiColors })}
      />

      <SettingsCard title={t('settingsIaTextLayoutCard')}>
        <SettingRow
          title={t('fontScale')}
          description={t('fontScaleDesc')}
          control={
            <ScaleControl
              label={t('fontScale')}
              min={UI_FONT_SCALE_MIN}
              max={UI_FONT_SCALE_MAX}
              step={0.01}
              value={fontScale}
              displayValue={Math.round(fontScale * 100)}
              unit="%"
              minGlyph="A"
              maxGlyph={<span className="text-[18px]">A</span>}
              decreaseLabel={t('fontScaleSmall')}
              increaseLabel={t('fontScaleLarge')}
              bigStep={0.05}
              onChange={setFontScale}
              onDisplayChange={(percent) => setFontScale(percent / 100)}
            />
          }
        />
        <SettingRow
          title={t('chatContentMaxWidth')}
          description={t('chatContentMaxWidthDesc')}
          control={
            <ScaleControl
              label={t('chatContentMaxWidth')}
              min={CHAT_CONTENT_MAX_WIDTH_MIN}
              max={CHAT_CONTENT_MAX_WIDTH_MAX}
              step={8}
              value={chatWidth}
              displayValue={chatWidth}
              unit="px"
              minGlyph={t('chatContentMaxWidthNarrow')}
              maxGlyph={t('chatContentMaxWidthWide')}
              decreaseLabel={t('chatContentMaxWidthDecrease')}
              increaseLabel={t('chatContentMaxWidthIncrease')}
              bigStep={32}
              onChange={setChatWidth}
              onDisplayChange={setChatWidth}
            />
          }
        />
      </SettingsCard>

      <SettingsCard>
        <SettingRow
          title={t('cursorSpotlight')}
          description={t('cursorSpotlightDesc')}
          control={
            <Toggle
              checked={spotlightOn}
              onChange={(enabled) => update({ cursorSpotlight: enabled })}
            />
          }
        />
        <SettingsReveal open={spotlightOn}>
          <div className="px-3 py-3.5">
            <SpotlightColorControl
              color={form.cursorSpotlightColor}
              disabled={!spotlightOn}
              t={t}
              onChange={(color) => update({ cursorSpotlightColor: color })}
            />
          </div>
        </SettingsReveal>
        <SettingRow
          title={t('homeGlyphRipple')}
          description={t('homeGlyphRippleDesc')}
          control={
            <Toggle
              checked={form.homeGlyphRipple !== false}
              onChange={(enabled) => update({ homeGlyphRipple: enabled })}
            />
          }
        />
      </SettingsCard>

    </>
  )
}
