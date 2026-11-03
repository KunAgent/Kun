import { useEffect, useState, type ReactElement } from 'react'
import { normalizeTerminalSettings, type TerminalColorSettingsV1, type TerminalSettingsV1 } from '@shared/app-settings'
import { TERMINAL_SCROLLBACK_RANGE } from '@shared/app-settings-terminal-dock'
import type { TerminalShellOption } from '@shared/terminal'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'
import { SshServersCard } from './remote-ssh/SshServersCard'
import { CliCommandSettingsCard } from './settings-section-general-desktop'
import { TerminalAppearanceRows, TerminalColorReset, TerminalSegmented, TerminalThemePresets } from './settings-terminal-appearance'
import { TerminalAgentsCard } from './settings-terminal-agents'

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

function CustomColorRows({ colors, updateColors, t }: {
  colors: TerminalColorSettingsV1
  updateColors: (patch: Partial<TerminalColorSettingsV1>) => void
  t: (key: string) => string
}): ReactElement {
  return (
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
                <ColorInput value={colors[field.key] as string} onChange={(v) => updateColors({ [field.key]: v })} label={t(field.labelKey)} />
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
                <ColorInput value={colors[field.key] as string} onChange={(v) => updateColors({ [field.key]: v })} label={t(field.labelKey)} />
              </div>
            ))}
          </div>
        }
      />
    </>
  )
}

function BehaviorCard({ terminal, update, selectControlClass, t }: {
  terminal: TerminalSettingsV1
  update: (patch: { terminal: Record<string, unknown> }) => void
  selectControlClass: string
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const behavior = terminal.behavior
  const setBehavior = (patch: Partial<TerminalSettingsV1['behavior']>): void => update({ terminal: { behavior: patch } })
  const [shells, setShells] = useState<TerminalShellOption[]>([])
  const [scrollback, setScrollback] = useState(String(behavior.scrollback))
  useEffect(() => { void window.kunGui.listTerminalShells?.().then((list) => setShells(list ?? [])).catch(() => setShells([])) }, [])
  useEffect(() => setScrollback(String(behavior.scrollback)), [behavior.scrollback])
  const toggle = (key: keyof TerminalSettingsV1['behavior'], title: string, description?: string): ReactElement => (
    <SettingRow
      title={t(title)}
      description={description ? t(description) : undefined}
      control={<Toggle checked={Boolean(behavior[key])} onChange={(value) => setBehavior({ [key]: value })} />}
    />
  )
  const systemShell = shells[0]?.name
  return (
    <SettingsCard title={t('termSetBehavior')}>
      <SettingRow
        title={t('termSetShell')}
        control={
          <select className={selectControlClass} value={behavior.shell} onChange={(event) => setBehavior({ shell: event.target.value })}>
            <option value="">{systemShell ? t('termSetShellSystemNamed', { shell: systemShell }) : t('termSetShellSystem')}</option>
            {shells.map((shell) => <option key={shell.path} value={shell.path}>{shell.name} · {shell.path}</option>)}
            {behavior.shell && !shells.some((shell) => shell.path === behavior.shell) ? <option value={behavior.shell}>{behavior.shell}</option> : null}
          </select>
        }
      />
      <SettingRow
        title={t('termSetStartDir')}
        control={
          <TerminalSegmented
            label={t('termSetStartDir')}
            value={behavior.startDirectory}
            options={[{ value: 'workspace', label: t('termSetStartWorkspace') }, { value: 'home', label: t('termSetStartHome') }]}
            onChange={(startDirectory) => setBehavior({ startDirectory })}
          />
        }
      />
      <SettingRow
        title={t('termSetScrollback')}
        description={t('termSetScrollbackDesc')}
        control={
          <label className="inline-flex items-center gap-2">
            <input
              type="number"
              min={TERMINAL_SCROLLBACK_RANGE.min}
              max={TERMINAL_SCROLLBACK_RANGE.max}
              step={500}
              value={scrollback}
              aria-label={t('termSetScrollback')}
              className="h-8 w-28 rounded-[9px] border border-ds-border bg-ds-card px-2.5 font-mono text-[13px] text-ds-ink"
              onChange={(event) => setScrollback(event.target.value)}
              onBlur={() => {
                const value = Number(scrollback)
                if (Number.isFinite(value)) setBehavior({ scrollback: value })
                else setScrollback(String(behavior.scrollback))
              }}
            />
            <span className="text-[12.5px] text-ds-muted">{t('termSetLines')}</span>
          </label>
        }
      />
      {toggle('shellIntegration', 'termSetIntegration', 'termSetIntegrationDesc')}
      {toggle('restoreSessions', 'termSetRestore', 'termSetRestoreDesc')}
      {toggle('showKunProcesses', 'termSetKunProcesses', 'termSetKunProcessesDesc')}
      {toggle('statusAlerts', 'termSetAlerts', 'termSetAlertsDesc')}
      {toggle('confirmClose', 'termSetConfirmClose')}
      {toggle('copyOnSelect', 'termSetCopyOnSelect')}
      {window.kunGui?.platform === 'darwin' ? toggle('macOptionIsMeta', 'termSetOptionMeta', 'termSetOptionMetaDesc') : null}
    </SettingsCard>
  )
}

export function TerminalSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update, selectControlClass, openSettingsCategory } = ctx
  const terminal: TerminalSettingsV1 = normalizeTerminalSettings(form.terminal)
  const colors = terminal.colors
  const updateColors = (patch: Partial<TerminalColorSettingsV1>): void => {
    update({ terminal: { colors: patch } })
  }

  return (
    <div className="space-y-4">
      <SettingsCard title={t('termSetAppearance')}>
        <TerminalThemePresets colors={colors} onSelect={(colorMode) => updateColors({ colorMode })} t={t} />
        <TerminalAppearanceRows terminal={terminal} update={update} selectControlClass={selectControlClass} t={t} />
        {colors.colorMode === 'custom' ? (
          <>
            <CustomColorRows colors={colors} updateColors={updateColors} t={t} />
            <TerminalColorReset update={update} t={t} />
          </>
        ) : null}
      </SettingsCard>
      <BehaviorCard terminal={terminal} update={update} selectControlClass={selectControlClass} t={t} />
      <TerminalAgentsCard terminal={terminal} update={update} openSettingsCategory={openSettingsCategory} t={t} />
      <SshServersCard t={t} />
      <CliCommandSettingsCard locale={form.locale} />
    </div>
  )
}
