import type { ReactElement } from 'react'
import {
  Settings,
  Smartphone,
  WandSparkles
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { activePaperViewId } from '../../write/write-editor-layout'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'
import { PaperModeToggle } from './PaperModeToggle'
import { PaperLibrarySwitcher } from './sidebar/PaperLibrarySwitcher'
import { PaperTree } from './sidebar/PaperTree'
import { PaperInfoPanel } from './sidebar/PaperInfoPanel'
import { PaperSidebarNav } from './sidebar/PaperSidebarNav'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  focusModeEnabled: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
}

/**
 * Papers-surface sidebar: mode toggle, library switcher with the import
 * action, library/discover nodes, the grouped paper tree (title rows, not the
 * raw file tree), and the collapsible info panel pinned to the bottom. Search
 * and status/tag/group filters live in the library tab toolbar.
 */
export function PaperSidebar({
  activeView,
  connectPhoneSidebarOpen,
  focusModeEnabled,
  onCodeOpen,
  onWriteOpen,
  onFocusModeChange,
  onOpenSettings,
  onToggleConnectPhone
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const activePaperView = useWriteWorkspaceStore((s) => activePaperViewId(s.editorLayout))
  const counts = usePaperModeStore((s) => s.counts)
  const setImportDialogOpen = usePaperModeStore((s) => s.setImportDialogOpen)

  return (
    <SidebarFrame
      title={t('appName')}
      footer={
        <div className="space-y-1">
          <SidebarFocusModeControl
            enabled={focusModeEnabled}
            onChange={onFocusModeChange}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarCommandRow
                icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
                label={t('settings')}
                onClick={() => onOpenSettings('write')}
                variant="footer"
              />
            </div>
            <SidebarIconButton
              title={t('claw')}
              ariaLabel={t('claw')}
              onClick={onToggleConnectPhone}
              active={connectPhoneSidebarOpen}
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
          </div>
        </div>
      }
    >
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-0.5">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />
        <PaperModeToggle />
      </div>

      <div className="ds-no-drag mx-1.5 my-3" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : (
        <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-0.5 pr-1.5">
            <div className="min-w-0 flex-1">
              <PaperLibrarySwitcher />
            </div>
            <SidebarIconButton
              title={t('writePaperImport')}
              ariaLabel={t('writePaperImport')}
              onClick={() => setImportDialogOpen(true)}
            >
              <WandSparkles className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
          </div>

          <div className="pt-2">
            <PaperSidebarNav activeView={activePaperView} total={counts.total} />
          </div>

          <SidebarSectionHeader label={t('writePaperModePapers')} />
          <PaperTree />
          <PaperInfoPanel />
        </div>
      )}
    </SidebarFrame>
  )
}
