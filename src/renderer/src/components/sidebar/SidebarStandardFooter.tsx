import { useEffect, useState, type ReactElement } from 'react'
import { Moon, Settings, Smartphone, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarCommandRow, SidebarIconButton } from './SidebarPrimitives'
import { SidebarFocusModeControl } from './SidebarFocusModeControl'
import { SidebarFocusModeSwitch, SidebarKunStatus, useSidebarSceneFooter } from './SidebarKunFooter'

function useDocumentDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * Footer shared by the Code and Work sidebars: Kun's status, then Settings
 * beside the focus, phone and theme switches. Theme packs with their own
 * sidebar scene keep the original Focus pill instead of the status row.
 */
export function SidebarStandardFooter({
  focusModeEnabled,
  connectPhoneSidebarOpen,
  onFocusModeChange,
  onOpenSettings,
  onOpenAgentSettings,
  onToggleConnectPhone,
  onToggleTheme
}: {
  focusModeEnabled: boolean
  connectPhoneSidebarOpen: boolean
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: () => void
  onOpenAgentSettings: () => void
  onToggleConnectPhone: () => void
  onToggleTheme?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const sceneFooter = useSidebarSceneFooter()
  const isDarkMode = useDocumentDarkMode()
  return (
    <div className="space-y-1">
      {sceneFooter ? (
        <SidebarFocusModeControl enabled={focusModeEnabled} onChange={onFocusModeChange} />
      ) : !focusModeEnabled ? (
        <div className="border-b border-[var(--ds-sidebar-divider)] pb-1">
          <SidebarKunStatus onOpen={onOpenAgentSettings} />
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={onOpenSettings}
            variant="footer"
          />
        </div>
        {!sceneFooter ? <SidebarFocusModeSwitch enabled={focusModeEnabled} onChange={onFocusModeChange} /> : null}
        <SidebarIconButton title={t('claw')} ariaLabel={t('claw')} onClick={onToggleConnectPhone} active={connectPhoneSidebarOpen}>
          <Smartphone className="h-4 w-4" strokeWidth={1.75} />
        </SidebarIconButton>
        {onToggleTheme ? (
          <SidebarIconButton
            title={isDarkMode ? t('switchToLight') : t('switchToDark')}
            ariaLabel={t('toggleTheme')}
            onClick={onToggleTheme}
          >
            {isDarkMode ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
          </SidebarIconButton>
        ) : null}
      </div>
    </div>
  )
}
