import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { FileText, Shapes, Sigma, FolderOpen, FileArchive } from 'lucide-react'
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
import { LatexCreateDialog } from './latex/LatexCreateDialog'
import { openLatexSession } from '../../write/latex/latex-project-store'

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
 * Work sidebar, shaped like Code's: mode menu and primary actions, the
 * cross-space entries (产物、论文), then the space you are in and its map —
 * 会话 / 资料 / 文件, all visible at once. Spaces are folders; the global
 * paper library is not part of the current Work space.
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
  const papersActive = useChatStore((s) => s.route === 'papers')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const remoteMobile = useRemoteMobileLayout()
  const actions = useWorkDirectoryActions()
  const { whiteboardCreation, entryDialog, setEntryDialog } = actions
  const [newMenu, setNewMenu] = useState(false)
  const [latexCreate, setLatexCreate] = useState(false)
  const menuHost = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!newMenu) return
    const dismiss = (event: PointerEvent): void => { if (!menuHost.current?.contains(event.target as Node)) setNewMenu(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setNewMenu(false) }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [newMenu])
  const importLatex = (kind: 'folder' | 'zip'): void => {
    setNewMenu(false)
    void (async () => {
      if (!await actions.ensureDocsSpace()) return
      const root = useWriteWorkspaceStore.getState().workspaceRoot
      const result = await window.kunGui.latexImport({ workspaceRoot: root, kind })
      if (!result.ok) throw new Error(result.message)
      if (result.project) {
        await openLatexSession(root, result.project.rootPath)
        await useWriteWorkspaceStore.getState().refreshWorkspace(root)
        await useWriteWorkspaceStore.getState().openFile(root, result.project.mainPath)
      }
    })().catch((error) => useWriteWorkspaceStore.getState().setFileError(String(error)))
  }

  useEffect(() => {
    if (!papersActive) void loadWriteSettings()
  }, [loadWriteSettings, papersActive])

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
        <div ref={menuHost} className="workspace-mode-controls ds-no-drag relative flex flex-col px-1">
          <WorkspaceModeTabs activeView={activeView} onCodeOpen={onCodeOpen} onWriteOpen={onWriteOpen} />
          <WorkSidebarPrimaryActions
            runtimeReady={runtimeReady}
            onNewSession={() => void startWorkSession()}
            onNewDocument={() => setNewMenu((open) => !open)}
          />
          {newMenu ? <div className="latex-new-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setNewMenu(false); void actions.openCreateFileDialog() }}><FileText size={15} />{t('latexNewMarkdown')}</button>
            <button type="button" role="menuitem" onClick={() => { setNewMenu(false); void actions.openNewWhiteboard() }}><Shapes size={15} />{t('latexNewWhiteboard')}</button>
            {!remoteMobile ? <><button type="button" role="menuitem" onClick={() => { setNewMenu(false); void actions.ensureDocsSpace().then((ready) => { if (ready) setLatexCreate(true) }) }}><Sigma size={15} />{t('latexNewPaper')}</button>
              <hr /><button type="button" role="menuitem" onClick={() => importLatex('folder')}><FolderOpen size={15} />{t('latexImportFolder')}</button>
              <button type="button" role="menuitem" onClick={() => importLatex('zip')}><FileArchive size={15} />{t('latexImportZip')}</button></> : null}
          </div> : null}
          {/* Artifacts span spaces, so the entry sits above the space switcher. */}
          <nav className="work-sidebar-nav" aria-label={t('artifactsNav')}>
            <WorkArtifactsSection workspaceRoot={workspaceRoot} />
          </nav>
          {remoteMobile ? null : <WorkPapersSection />}
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
            <WorkSessionsSection onOpenArchives={() => onOpenSettings('archives')} />
            <div className="work-materials-label">{t('workSidebarMaterials')}</div>
            <div className="work-materials">
              {/* Last, so the tree takes the remaining height. */}
              <WorkFilesSection actions={actions} />
            </div>
          </div>
        )}
      </SidebarFrame>
      {latexCreate ? <LatexCreateDialog workspaceRoot={workspaceRoot} onClose={() => setLatexCreate(false)} /> : null}
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
