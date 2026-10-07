import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkSidebarStore } from '../../write/work-sidebar-store'
import { startWorkSession } from '../../write/work-session-actions'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { SidebarFrame } from '../sidebar/SidebarPrimitives'
import { SidebarStandardFooter } from '../sidebar/SidebarStandardFooter'
import { WorkWhiteboardTitleDialog } from './WorkWhiteboardTitleDialog'
import { WriteEntryDialog } from './WriteEntryDialog'
import { useWorkDirectoryActions } from './use-work-directory-actions'
import { WorkSidebarPaperNav, WorkSidebarPrimaryActions, WorkSidebarViewHeader } from './WorkSidebarNav'
import { WorkSessionsSection } from './WorkSessionsSection'
import { WorkDirectorySection } from './WorkDirectorySection'
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
 * Work sidebar, shaped like Code's: mode menu, primary actions, navigation,
 * then a 会话 | 目录 switch between the session list and the directory tree.
 * Papers live inside it (library/discover in the nav, libraries next to the
 * work spaces), so there is no separate paper sidebar or mode toggle.
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
  const refreshWorkspace = useWriteWorkspaceStore((s) => s.refreshWorkspace)
  const view = useWorkSidebarStore((s) => s.view)
  const remoteMobile = useRemoteMobileLayout()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
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
            onOpenAgentSettings={() => onOpenSettings('agents')}
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
          {remoteMobile ? null : <WorkSidebarPaperNav />}
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
          <div className="ds-no-drag flex min-h-0 flex-1 flex-col px-1" data-work-sidebar={view}>
            <WorkSidebarViewHeader
              view={view}
              searchOpen={searchOpen}
              onToggleSearch={() => {
                setSearchOpen((open) => !open)
                setQuery('')
              }}
              onOpenArchives={() => onOpenSettings('archives')}
              onAddSpace={() => void actions.pickWriteWorkspace()}
              onRefresh={() => {
                const root = useWriteWorkspaceStore.getState().workspaceRoot
                if (root) void refreshWorkspace(root)
              }}
            />
            {view === 'sessions' && searchOpen ? (
              <div className="work-sidebar-search">
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    setQuery('')
                    setSearchOpen(false)
                  }}
                  placeholder={t('workSidebarSearchPlaceholder')}
                  aria-label={t('workSidebarSearchSessions')}
                />
              </div>
            ) : null}
            <div className="work-sidebar-body">
              {view === 'sessions'
                ? <WorkSessionsSection query={searchOpen ? query : ''} />
                : <WorkDirectorySection actions={actions} showLibraries={!remoteMobile} />}
            </div>
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
