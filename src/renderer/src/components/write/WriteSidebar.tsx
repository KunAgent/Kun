import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { startWorkSession } from '../../write/work-session-actions'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { SidebarFrame } from '../sidebar/SidebarPrimitives'
import { SidebarStandardFooter } from '../sidebar/SidebarStandardFooter'
import { WorkWhiteboardTitleDialog } from './WorkWhiteboardTitleDialog'
import { WriteEntryDialog } from './WriteEntryDialog'
import { useWorkDirectoryActions } from './use-work-directory-actions'
import { WorkSidebarPrimaryActions } from './WorkSidebarNav'
import { WorkSpaceSwitcher } from './WorkSpaceSwitcher'
import { WorkSessionsSection } from './WorkSessionsSection'
import { WorkFilesSection } from './WorkFilesSection'
import { WorkArtifactsSection } from './WorkArtifactsSection'
import { WorkPapersSection } from './WorkPapersSection'
import './work-sidebar.css'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  focusModeEnabled: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
  onToggleTheme?: () => void
}

/**
 * Work sidebar, shaped like Code's: mode menu and primary actions, then the
 * space you are in and its map — 会话 / 文件 / 论文, all visible at once.
 * Spaces are folders; their papers live in `<space>/papers`, so there is no
 * separate library list, view switch or paper mode.
 */
export function WriteSidebar({
  activeView,
  connectPhoneSidebarOpen,
  focusModeEnabled,
  onCodeOpen,
  onWriteOpen,
  onFocusModeChange,
  onOpenSettings,
  onToggleConnectPhone,
  onToggleTheme
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const runtimeReady = useChatStore((s) => s.runtimeConnection === 'ready')
  const loadWriteSettings = useWriteWorkspaceStore((s) => s.loadWriteSettings)
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const remoteMobile = useRemoteMobileLayout()
  const actions = useWorkDirectoryActions()
  const { whiteboardCreation, entryDialog, setEntryDialog } = actions

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  return (
    <>
      <SidebarFrame
        title={t('appName')}
        footer={
          <SidebarStandardFooter
            focusModeEnabled={focusModeEnabled}
            connectPhoneSidebarOpen={connectPhoneSidebarOpen}
            onFocusModeChange={onFocusModeChange}
            onOpenSettings={() => onOpenSettings('write')}
            onToggleConnectPhone={onToggleConnectPhone}
            onToggleTheme={onToggleTheme}
          />
        }
      >
        <div className="workspace-mode-controls ds-no-drag flex flex-col px-1">
          <WorkspaceModeTabs activeView={activeView} onCodeOpen={onCodeOpen} onWriteOpen={onWriteOpen} />
          <WorkSidebarPrimaryActions
            runtimeReady={runtimeReady}
            onNewSession={() => void startWorkSession()}
            onNewDocument={() => void actions.openCreateFileDialog()}
          />
          <WorkSpaceSwitcher onAddSpace={() => void actions.pickWriteWorkspace()} />
        </div>

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
          <div className="work-sidebar-body ds-no-drag px-1" data-work-sidebar>
            <WorkArtifactsSection workspaceRoot={workspaceRoot} />
            <WorkSessionsSection onOpenArchives={() => onOpenSettings('archives')} />
            <WorkFilesSection actions={actions} />
            {/* Phones keep their own paper home. */}
            {remoteMobile ? null : <WorkPapersSection />}
          </div>
        )}
      </SidebarFrame>
      {whiteboardCreation.newWhiteboardDialogOpen ? (
        <WorkWhiteboardTitleDialog
          submitting={whiteboardCreation.creatingWhiteboard}
          onSubmit={(title, engine) => { void whiteboardCreation.submitNewWhiteboardTitle(title, engine) }}
          onClose={() => {
            if (!whiteboardCreation.creatingWhiteboard) whiteboardCreation.closeNewWhiteboardDialog()
          }}
        />
      ) : null}
      {entryDialog ? (
        <WriteEntryDialog
          dialog={entryDialog}
          onClose={() => setEntryDialog(null)}
          onValueChange={(value) =>
            setEntryDialog((current) => {
              if (!current || current.kind === 'delete' || current.kind === 'delete-whiteboard') return current
              return { ...current, value }
            })
          }
          onSubmit={(event) => void actions.submitEntryDialog(event)}
          t={t}
        />
      ) : null}
    </>
  )
}
