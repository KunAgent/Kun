import { useCallback, useId, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useHarnessStore } from '../../store/harness-store'
import {
  effectiveSettingValue,
  harnessSessionSettingOptions,
  setHarnessSessionSetting,
  useHarnessSessionSettingsStore
} from '../../lib/harness-session-settings'
import { useComposerPickerPopover } from './use-composer-picker-popover'

const MENU_WIDTH = 288
const MENU_ESTIMATED_HEIGHT = 300

type Props = {
  harnessId: string
  threadId?: string | null
  compact?: boolean
  disabled?: boolean
}

/**
 * Generic controls for the settings an external Agent publishes beyond model,
 * permission mode and reasoning (docs/ade/17 §4.4). Hidden until the Agent
 * reports any; a pick applies to the next turns sent to this Agent.
 */
export function FloatingComposerAgentSettings({ harnessId, threadId, compact = false, disabled }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const row = useHarnessStore((state) => state.rows.find((entry) => entry.definition.id === harnessId))
  const catalogSettings = useHarnessStore((state) => state.models[harnessId]?.settings)
  const session = useHarnessStore((state) => threadId ? state.sessions[threadId] : undefined)
  const picked = useHarnessSessionSettingsStore((state) => state.values[harnessId])
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const closeMenu = useCallback((): void => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open, onClose: closeMenu, preferredWidth: MENU_WIDTH, estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  const settings = harnessSessionSettingOptions({
    sessionSettings: session?.harnessId === harnessId ? session.settings : undefined,
    catalogSettings
  })
  if (!row || !settings.length) return null
  const changed = settings.filter((setting) => picked?.[setting.id] !== undefined).length
  const title = t('agentSettingsPicker.triggerTitle', { agent: row.definition.displayName })

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])
    if (!items.length) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1)
    items[next]?.focus()
  }
  const itemClass = (checked: boolean): string =>
    `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition focus-visible:bg-ds-hover ${
      checked ? 'bg-accent-soft text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'}`

  const menu = open && typeof document !== 'undefined' ? (
    <div ref={menuRef} id={menuId} role="menu" aria-label={title} style={{ ...menuStyle, overflowY: 'auto' }}
      onKeyDown={onMenuKeyDown} data-agent-settings-menu={harnessId}
      className="ds-composer-agent-menu ds-no-drag fixed z-50 overflow-hidden rounded-lg border border-ds-border bg-ds-main p-1 shadow-xl">
      {settings.map((setting) => {
        const value = effectiveSettingValue(setting, picked?.[setting.id])
        if (setting.kind === 'toggle') {
          return (
            <button key={setting.id} type="button" role="menuitemcheckbox" aria-checked={value === true}
              data-agent-setting={setting.id} className={itemClass(false)}
              onClick={() => setHarnessSessionSetting(harnessId, setting.id, value !== true)}>
              <span className="min-w-0 flex-1 truncate">{setting.label}</span>
              <span className="flex w-4 shrink-0 justify-center">{value === true ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : null}</span>
            </button>
          )
        }
        return (
          <div key={setting.id} role="group" aria-label={setting.label} data-agent-setting={setting.id}>
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ds-faint">{setting.label}</div>
            {setting.options.map((option) => {
              const checked = value === option.value
              return (
                <button key={option.value} type="button" role="menuitemradio" aria-checked={checked}
                  data-agent-setting-option={option.value} className={itemClass(checked)}
                  onClick={() => setHarnessSessionSetting(harnessId, setting.id, option.value)}>
                  <span className={`min-w-0 flex-1 truncate${checked ? ' font-semibold' : ''}`}>{option.label}</span>
                  <span className="flex w-4 shrink-0 justify-center">{checked ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : null}</span>
                </button>
              )
            })}
          </div>
        )
      })}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-ds-border-muted px-2.5 pb-1 pt-2 text-[11px] leading-4 text-ds-faint">
        <span>{t('agentSettingsPicker.hint')}</span>
        {changed ? (
          <button type="button" role="menuitem" data-agent-settings-reset className="shrink-0 rounded px-1 text-ds-muted hover:text-ds-ink"
            onClick={() => { for (const setting of settings) setHarnessSessionSetting(harnessId, setting.id, undefined) }}>
            {t('agentSettingsPicker.reset')}
          </button>
        ) : null}
      </div>
    </div>
  ) : null

  return (
    <>
      <div className="ds-composer-agent-picker ds-no-drag relative" data-agent-settings-picker={harnessId}>
        <button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="menu" aria-controls={menuId}
          aria-expanded={open} aria-label={title} title={title} onClick={() => setOpen((current) => !current)}
          className={`flex h-7 items-center gap-1 rounded-full border border-ds-border bg-ds-raised px-2 text-xs transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60 ${
            changed ? 'text-ds-ink' : 'text-ds-muted'}`}>
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {!compact ? <span className="max-w-[120px] truncate">{t('agentSettingsPicker.title')}</span> : null}
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.75} />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
