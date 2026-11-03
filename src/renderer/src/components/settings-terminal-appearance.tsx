import type { ReactElement } from 'react'
import { Check } from 'lucide-react'
import {
  defaultTerminalColors,
  TERMINAL_DEFAULT_ANSI_COLORS,
  TERMINAL_NATIVE_LIGHT_ANSI_COLORS,
  TERMINAL_PRESET_CONTRAST,
  TERMINAL_PRESET_LIGHT,
  type TerminalColorMode,
  type TerminalColorSettingsV1,
  type TerminalSettingsV1
} from '@shared/app-settings'
import { TERMINAL_FONT_SIZE_RANGE } from '@shared/app-settings-terminal-dock'
import { settingsButtonClass } from './settings-button'
import { SettingRow, Toggle } from './settings-controls'

type T = (key: string, options?: Record<string, unknown>) => string
type Update = (patch: { terminal: Record<string, unknown> }) => void

type Preview = { background: string; foreground: string; prompt: string; branch: string; ok: string; bad: string; dim: string }

const PREVIEWS: Record<Exclude<TerminalColorMode, 'custom'>, Preview> = {
  native: {
    background: '#ffffff', foreground: TERMINAL_PRESET_LIGHT.foreground, prompt: TERMINAL_NATIVE_LIGHT_ANSI_COLORS.cyan,
    branch: TERMINAL_NATIVE_LIGHT_ANSI_COLORS.magenta, ok: TERMINAL_NATIVE_LIGHT_ANSI_COLORS.green, bad: TERMINAL_NATIVE_LIGHT_ANSI_COLORS.red, dim: '#6e7781'
  },
  none: { background: '#ffffff', foreground: TERMINAL_PRESET_LIGHT.foreground, prompt: TERMINAL_PRESET_LIGHT.foreground, branch: TERMINAL_PRESET_LIGHT.foreground, ok: TERMINAL_PRESET_LIGHT.foreground, bad: TERMINAL_PRESET_LIGHT.foreground, dim: '#6e7781' },
  contrast: {
    background: TERMINAL_PRESET_CONTRAST.background, foreground: TERMINAL_PRESET_CONTRAST.foreground, prompt: TERMINAL_PRESET_CONTRAST.cyan,
    branch: TERMINAL_PRESET_CONTRAST.magenta, ok: TERMINAL_PRESET_CONTRAST.green, bad: TERMINAL_PRESET_CONTRAST.red, dim: TERMINAL_PRESET_CONTRAST.brightBlack
  }
}

function PreviewLines({ preview }: { preview: Preview }): ReactElement {
  return (
    <div className="h-[84px] overflow-hidden whitespace-pre rounded-xl border border-ds-border px-3 py-2.5 font-mono text-[11px] leading-[17px]" style={{ background: preview.background, color: preview.foreground }}>
      <span style={{ color: preview.prompt }}>kun</span> <span style={{ color: preview.branch }}>main</span> <span style={{ color: preview.ok }}>❯</span> npm test{'\n'}
      {' '}<span style={{ color: preview.ok }}>✓</span> 14 passed{'\n'}
      {' '}<span style={{ color: preview.bad }}>× 1 failed</span>{'\n'}
      <span style={{ color: preview.dim }}>  Duration 1.84s</span>
    </div>
  )
}

const MODE_LABEL: Record<TerminalColorMode, string> = {
  native: 'termSetThemeKun',
  none: 'termSetThemeMono',
  contrast: 'termSetThemeContrast',
  custom: 'termSetThemeCustom'
}

export function TerminalThemePresets({ colors, onSelect, t }: { colors: TerminalColorSettingsV1; onSelect: (mode: TerminalColorMode) => void; t: T }): ReactElement {
  const custom: Preview = {
    background: colors.background, foreground: colors.foreground, prompt: colors.cyan, branch: colors.magenta, ok: colors.green, bad: colors.red, dim: colors.brightBlack
  }
  return (
    <div className="grid grid-cols-2 gap-3 px-5 pb-4 pt-1 sm:grid-cols-4">
      {(['native', 'none', 'contrast', 'custom'] as const).map((mode) => {
        const selected = colors.colorMode === mode
        return (
          <button key={mode} type="button" aria-pressed={selected} className="min-w-0 text-left" onClick={() => onSelect(mode)}>
            <div className={`rounded-xl ${selected ? 'ring-2 ring-[var(--ds-accent)] ring-offset-2 ring-offset-[var(--ds-surface-card)]' : ''}`}>
              <PreviewLines preview={mode === 'custom' ? custom : PREVIEWS[mode]} />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ds-ink">
              {selected ? <Check className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={2.2} /> : null}
              {t(MODE_LABEL[mode])}
            </div>
            {mode === 'native' ? <div className="text-[11.5px] text-ds-muted">{t('termSetThemeKunHint')}</div> : null}
            {mode === 'custom' ? <div className="text-[11.5px] text-ds-muted">{t('termSetThemeCustomHint')}</div> : null}
          </button>
        )
      })}
    </div>
  )
}

const FONT_OPTIONS = ['', 'SF Mono', 'JetBrains Mono', 'Menlo', 'Fira Code', 'Cascadia Code', 'Consolas']
const LINE_HEIGHTS = [
  { value: 1.3, key: 'termSetLineCompact' },
  { value: 1.45, key: 'termSetLineStandard' },
  { value: 1.6, key: 'termSetLineRelaxed' }
] as const

function Segmented<V extends string | number>({ value, options, onChange, label }: {
  value: V
  options: ReadonlyArray<{ value: V; label: string }>
  onChange: (value: V) => void
  label: string
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-[9px] bg-ds-subtle p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`h-7 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] ${option.value === value ? 'bg-ds-card text-ds-ink shadow-[0_0_0_1px_var(--ds-border)]' : 'text-ds-muted hover:text-ds-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export { Segmented as TerminalSegmented }

export function TerminalAppearanceRows({ terminal, update, selectControlClass, t }: {
  terminal: TerminalSettingsV1
  update: Update
  selectControlClass: string
  t: T
}): ReactElement {
  const appearance = terminal.appearance
  const setAppearance = (patch: Partial<TerminalSettingsV1['appearance']>): void => update({ terminal: { appearance: patch } })
  const fontKnown = FONT_OPTIONS.includes(appearance.fontFamily)
  return (
    <>
      <SettingRow
        title={t('termSetFont')}
        description={t('termSetFontDesc')}
        control={
          <select className={selectControlClass} value={fontKnown ? appearance.fontFamily : '__custom'} onChange={(event) => {
            if (event.target.value !== '__custom') setAppearance({ fontFamily: event.target.value })
          }}>
            {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font || t('termSetFontSystem')}</option>)}
            {!fontKnown ? <option value="__custom">{appearance.fontFamily}</option> : null}
          </select>
        }
      />
      <SettingRow
        title={t('termSetFontSize')}
        control={
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-8 items-center overflow-hidden rounded-[9px] border border-ds-border">
              <button type="button" aria-label={t('termSetFontSmaller')} className="h-8 w-8 text-ds-ink hover:bg-ds-hover disabled:opacity-40" disabled={appearance.fontSize <= TERMINAL_FONT_SIZE_RANGE.min} onClick={() => setAppearance({ fontSize: appearance.fontSize - 1 })}>−</button>
              <span className="w-9 text-center font-mono text-[13px] text-ds-ink">{appearance.fontSize}</span>
              <button type="button" aria-label={t('termSetFontLarger')} className="h-8 w-8 text-ds-ink hover:bg-ds-hover disabled:opacity-40" disabled={appearance.fontSize >= TERMINAL_FONT_SIZE_RANGE.max} onClick={() => setAppearance({ fontSize: appearance.fontSize + 1 })}>+</button>
            </div>
            <Segmented
              label={t('termSetLineHeight')}
              value={LINE_HEIGHTS.find((entry) => Math.abs(entry.value - appearance.lineHeight) < 0.01)?.value ?? 1.45}
              options={LINE_HEIGHTS.map((entry) => ({ value: entry.value, label: t(entry.key) }))}
              onChange={(lineHeight) => setAppearance({ lineHeight })}
            />
          </div>
        }
      />
      <SettingRow
        title={t('termSetCursor')}
        control={
          <div className="flex items-center gap-3">
            <Segmented
              label={t('termSetCursor')}
              value={appearance.cursorStyle}
              options={[
                { value: 'block', label: t('termSetCursorBlock') },
                { value: 'bar', label: t('termSetCursorBar') },
                { value: 'underline', label: t('termSetCursorUnderline') }
              ]}
              onChange={(cursorStyle) => setAppearance({ cursorStyle })}
            />
            <span className="text-[12.5px] text-ds-muted">{t('termSetCursorBlink')}</span>
            <Toggle checked={appearance.cursorBlink} onChange={(cursorBlink) => setAppearance({ cursorBlink })} ariaLabel={t('termSetCursorBlink')} />
          </div>
        }
      />
    </>
  )
}

/** Reset the color grid back to the dark defaults (custom mode only). */
export function TerminalColorReset({ update, t }: { update: Update; t: T }): ReactElement {
  return (
    <SettingRow
      title={t('terminalColorReset')}
      description={t('terminalColorResetDesc')}
      control={
        <button className={settingsButtonClass()} type="button" onClick={() => update({ terminal: { colors: { ...defaultTerminalColors(), colorMode: 'custom', ...TERMINAL_DEFAULT_ANSI_COLORS } } })}>
          {t('terminalColorResetButton')}
        </button>
      }
    />
  )
}
