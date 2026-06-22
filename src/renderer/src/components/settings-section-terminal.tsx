import { type ReactElement } from 'react'
import type { TerminalColorSettingsV1 } from '@shared/app-settings'
import { SettingsCard, SettingRow } from './settings-controls'

type ColorField = {
  key: keyof TerminalColorSettingsV1
  labelKey: string
}

const SURFACE_FIELDS: ColorField[] = [
  { key: 'foreground', labelKey: 'terminalColorForeground' },
  { key: 'background', labelKey: 'terminalColorBackground' },
  { key: 'cursor', labelKey: 'terminalColorCursor' },
  { key: 'selectionBackground', labelKey: 'terminalColorSelection' }
]

const ANSI_FIELDS: ColorField[] = [
  { key: 'black', labelKey: 'terminalColorBlack' },
  { key: 'red', labelKey: 'terminalColorRed' },
  { key: 'green', labelKey: 'terminalColorGreen' },
  { key: 'yellow', labelKey: 'terminalColorYellow' },
  { key: 'blue', labelKey: 'terminalColorBlue' },
  { key: 'magenta', labelKey: 'terminalColorMagenta' },
  { key: 'cyan', labelKey: 'terminalColorCyan' },
  { key: 'white', labelKey: 'terminalColorWhite' },
  { key: 'brightBlack', labelKey: 'terminalColorBrightBlack' },
  { key: 'brightRed', labelKey: 'terminalColorBrightRed' },
  { key: 'brightGreen', labelKey: 'terminalColorBrightGreen' },
  { key: 'brightYellow', labelKey: 'terminalColorBrightYellow' },
  { key: 'brightBlue', labelKey: 'terminalColorBrightBlue' },
  { key: 'brightMagenta', labelKey: 'terminalColorBrightMagenta' },
  { key: 'brightCyan', labelKey: 'terminalColorBrightCyan' },
  { key: 'brightWhite', labelKey: 'terminalColorBrightWhite' }
]

function ColorInput({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (v: string) => void
  label: string
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-ds-border bg-ds-card p-0.5"
        aria-label={label}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 min-w-0 rounded-lg border border-ds-border bg-ds-card px-2 py-1 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
        spellCheck={false}
        aria-label={label}
      />
    </div>
  )
}

export function TerminalSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update } = ctx
  const colors: TerminalColorSettingsV1 = form.terminal.colors

  const updateColors = (patch: Partial<TerminalColorSettingsV1>): void => {
    update({ terminal: { colors: patch } })
  }

  return (
    <SettingsCard title={t('sectionTerminal')}>
      <SettingRow
        title={t('terminalColorMode')}
        description={t('terminalColorModeDesc')}
        control={
          <select
            className={ctx.selectControlClass}
            value={colors.colorMode}
            onChange={(e) => updateColors({ colorMode: e.target.value as 'none' | 'custom' })}
          >
            <option value="none">{t('terminalColorModeNone')}</option>
            <option value="custom">{t('terminalColorModeCustom')}</option>
          </select>
        }
      />

      {colors.colorMode === 'none' ? (
        <SettingRow
          title={t('terminalColorModeNoneHint')}
          description={t('terminalColorModeNoneDesc')}
          control={<span />}
        />
      ) : (
        <>
          <SettingRow
            title={t('terminalColorSurface')}
            description={t('terminalColorSurfaceDesc')}
            wideControl
            control={
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                {SURFACE_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-ds-muted">{t(field.labelKey)}</span>
                    <ColorInput
                      value={colors[field.key] as string}
                      onChange={(v) => updateColors({ [field.key]: v })}
                      label={t(field.labelKey)}
                    />
                  </div>
                ))}
              </div>
            }
          />
          <SettingRow
            title={t('terminalColorAnsi')}
            description={t('terminalColorAnsiDesc')}
            wideControl
            control={
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ANSI_FIELDS.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1">
                    <span className="text-[12px] text-ds-muted">{t(field.labelKey)}</span>
                    <ColorInput
                      value={colors[field.key] as string}
                      onChange={(v) => updateColors({ [field.key]: v })}
                      label={t(field.labelKey)}
                    />
                  </div>
                ))}
              </div>
            }
          />
          <SettingRow
            title={t('terminalColorReset')}
            description={t('terminalColorResetDesc')}
            control={
              <button
                type="button"
                onClick={() => updateColors({ colorMode: 'none' })}
                className="rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('terminalColorResetButton')}
              </button>
            }
          />
        </>
      )}
    </SettingsCard>
  )
}
