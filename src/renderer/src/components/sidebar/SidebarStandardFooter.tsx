import { useEffect, useState, type ReactElement } from 'react'
import { Moon, Settings, Smartphone, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarCommandRow, SidebarIconButton } from './SidebarPrimitives'
import { SidebarFocusModeControl } from './SidebarFocusModeControl'
import { SidebarFocusModeSwitch, SidebarKunStatus, useSidebarSceneFooter } from './SidebarKunFooter'
import { SidebarGuiUpdate } from './SidebarGuiUpdate'
import { GuidedToursButton } from '../guided-tour/GuidedToursButton'
import { KunAccountControl, kunAccountAvailable } from '../account/KunAccountControl'
import '../account/kun-account-dock.css'

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
 * Footer shared by the Code and Work sidebars. On the desktop app it is one dock: the Kun account
 * card (its menu holds the wardrobe and Settings) with the Settings gear on its right edge, and
 * below it the focus switch, the GUI update chip, phone and theme. Focus mode drops the frame for
 * one flat row: the account face (signed in only, never a sign-in prompt), then the right-aligned
 * Focus, Settings and tools. Theme packs with their own sidebar scene use the
 * one-line card; the remote browser client, which has no account, keeps Kun's status card.
 */
export function SidebarStandardFooter({
  focusModeEnabled,
  connectPhoneSidebarOpen,
  onFocusModeChange,
  onOpenSettings,
  onToggleConnectPhone,
  onToggleTheme
}: {
  focusModeEnabled: boolean
  connectPhoneSidebarOpen: boolean
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: () => void
  onToggleConnectPhone: () => void
  onToggleTheme?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const sceneFooter = useSidebarSceneFooter()
  const isDarkMode = useDocumentDarkMode()
  const account = kunAccountAvailable()
  const settingsButton = (
    <SidebarIconButton title={t('settings')} ariaLabel={t('settings')} onClick={onOpenSettings} className="kun-account-dock-settings">
      <Settings className="h-4 w-4" strokeWidth={1.75} />
    </SidebarIconButton>
  )
  const tools = (
    <>
      {window.kunGui?.isRemoteWeb ? null : <GuidedToursButton />}
      <SidebarIconButton title={t('claw')} ariaLabel={t('claw')} onClick={onToggleConnectPhone} active={connectPhoneSidebarOpen}
        className="kun-sidebar-phone-button">
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
    </>
  )
  if (account && !sceneFooter) {
    // Focus mode drops the frame: one flat row with the face (signed in only), Focus, and the tools.
    if (focusModeEnabled) {
      return (
        <div className="ds-sidebar-footer-bar kun-account-focus-row relative flex items-center gap-1" data-kun-account-dock data-focus>
          <KunAccountControl variant="mini" onOpenSettings={onOpenSettings} />
          <div className="min-w-0 flex-1" data-footer-settings-slot="spacer" />
          <SidebarGuiUpdate />
          <SidebarFocusModeSwitch enabled={focusModeEnabled} onChange={onFocusModeChange} />
          {settingsButton}
          {tools}
        </div>
      )
    }
    return (
      <div className="kun-account-dock" data-kun-account-dock>
        <KunAccountControl accessory={settingsButton} onOpenSettings={onOpenSettings} />
        <div className="ds-sidebar-footer-bar kun-account-dock-bar relative flex items-center gap-1">
          <div className="min-w-0 flex-1" data-footer-settings-slot="spacer" />
          <SidebarGuiUpdate />
          <SidebarFocusModeSwitch enabled={focusModeEnabled} onChange={onFocusModeChange} />
          {tools}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {sceneFooter ? (
        <>
          <SidebarFocusModeControl enabled={focusModeEnabled} onChange={onFocusModeChange} />
          {account && !focusModeEnabled ? <KunAccountControl variant="compact" /> : null}
        </>
      ) : !focusModeEnabled ? (
        <div className="border-b border-[var(--ds-sidebar-divider)] pb-1">
          <SidebarKunStatus />
        </div>
      ) : null}
      <div className="ds-sidebar-footer-bar relative flex items-center gap-1">
        {sceneFooter ? (
          <div className="min-w-0 flex-1" data-footer-settings-slot>
            <SidebarCommandRow
              icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
              label={t('settings')}
              onClick={onOpenSettings}
              variant="footer"
              collapseLabel
            />
          </div>
        ) : <div className="min-w-0 flex-1" data-footer-settings-slot="spacer" />}
        <SidebarGuiUpdate />
        {!sceneFooter ? (
          <>
            <SidebarFocusModeSwitch enabled={focusModeEnabled} onChange={onFocusModeChange} />
            {settingsButton}
          </>
        ) : null}
        {tools}
      </div>
    </div>
  )
}
