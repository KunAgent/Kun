import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ResolvedWriteAgentPreset } from '../../../write/agent-presets'
import { MenuButton } from './MenuButton'
import { MenuFlyout } from './MenuFlyout'
export function AgentDropdown({ presets, active, onSelect, onManage, focusMode }: {
  presets: ResolvedWriteAgentPreset[]; active: string; onSelect?: (id: string) => void; onManage?: () => void; focusMode?: boolean
}): ReactElement {
  const { t } = useTranslation('common'), anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), close = useCallback(() => setOpen(false), [])
  return <div ref={anchor} className="write-selection-menu-agent">
    <MenuButton className="write-selection-menu-small" label={t('writeAgentSwitcherLabel')} aria-haspopup="menu" aria-expanded={open}
      onActivate={() => setOpen(!open)}><span>{presets.find((preset) => preset.id === active)?.name ?? t('writeAgentSwitcherNone')}</span><ChevronDown /></MenuButton>
    {open && <MenuFlyout anchor={anchor} onClose={close} focusMode={focusMode}>
      <MenuButton className="write-selection-menu-row" role="menuitemradio" aria-checked={!active} label={t('writeAgentSwitcherNone')}
        onActivate={() => { onSelect?.(''); close() }}><span>{t('writeAgentSwitcherNone')}</span>{!active && <Check className="is-check" />}</MenuButton>
      {presets.map((preset) => <MenuButton key={preset.id} className="write-selection-menu-row" role="menuitemradio" aria-checked={active === preset.id}
        label={preset.name} onActivate={() => { onSelect?.(preset.id); close() }}><b aria-hidden="true">{preset.emoji}</b><span>{preset.name}</span>{active === preset.id && <Check className="is-check" />}</MenuButton>)}
      {!presets.length && <div className="write-selection-menu-note">{t('writeAgentSwitcherEmptyHint')}</div>}
      {onManage && <><div className="write-selection-menu-separator" /><MenuButton className="write-selection-menu-row" role="menuitem" label={t('writeAgentSwitcherManage')}
        onActivate={() => { close(); onManage() }}><Settings2 /><span>{t('writeAgentSwitcherManage')}</span></MenuButton></>}
    </MenuFlyout>}
  </div>
}
