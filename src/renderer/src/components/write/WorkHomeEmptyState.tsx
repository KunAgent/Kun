import type { CSSProperties, ReactElement } from 'react'
import { Check, ChevronDown, FilePlus2, FileText, Folder, Import, MessageSquareQuote, Presentation, Search, Shapes, Table2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import kunLaptopUrl from '../../../../asset/img/kun_laptop.png'
import { RoomAvatarPortrait } from '../rooms/RoomAvatar'
import { RoomPopover } from '../rooms/RoomPopover'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { createWorkDraftDocument, ensureWorkSpaceMounted, mountWorkSpace, openPaperImport, openPaperView } from '../../write/work-session-actions'
import { useWorkWhiteboardCreation } from './use-work-whiteboard-creation'
import { WorkWhiteboardTitleDialog } from './WorkWhiteboardTitleDialog'

/** Kun's face for the Work assistant (quill) and paper contexts (glasses). */
export function WorkKunAvatar({ variant = 'writer', size = 22 }: {
  variant?: 'writer' | 'researcher'
  size?: number
}): ReactElement {
  return (
    <span className="work-kun-avatar rooms-avatar" aria-hidden="true"
      style={{ '--rooms-avatar-size': `${size}px` } as CSSProperties}>
      <RoomAvatarPortrait index={variant === 'researcher' ? 9 : 8} />
    </span>
  )
}

/**
 * Center home when nothing is open, in Code's shape: Kun, a heading and a few
 * ways to start; the composer sits right below it.
 */
export function WorkHomeHero(): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const whiteboard = useWorkWhiteboardCreation({ workspaceRoot, onNeedWorkspace: async () => undefined })
  const actions = [
    { id: 'document', label: t('workSidebarNewDocument'), Icon: FilePlus2,
      run: () => void createWorkDraftDocument(t('writeUntitledDraft')) },
    { id: 'import', label: t('workSidebarImportPaper'), Icon: Import, run: () => void openPaperImport() },
    { id: 'whiteboard', label: t('writeCreateWhiteboard'), Icon: Shapes,
      run: () => void ensureWorkSpaceMounted().then((ok) => { if (ok) void whiteboard.openNewWhiteboardDialog() }) },
    { id: 'search', label: t('writePaperDiscoverTab_search'), Icon: Search, run: () => void openPaperView('discover:search') }
  ]
  return (
    <div className="work-home-hero" data-work-home>
      <img src={kunLaptopUrl} alt="" className="work-home-mascot" draggable={false} />
      <h2 className="work-home-title">{t('workHomeTitle')}</h2>
      <p className="work-home-subtitle">{t('workHomeSubtitle')}</p>
      <div className="work-home-actions">
        {actions.map(({ id, label, Icon, run }) => (
          <button key={id} type="button" className="work-home-pill" data-work-home-action={id} onClick={run}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {whiteboard.newWhiteboardDialogOpen ? (
        <WorkWhiteboardTitleDialog
          submitting={whiteboard.creatingWhiteboard}
          onSubmit={(title, engine) => { void whiteboard.submitNewWhiteboardTitle(title, engine) }}
          onClose={() => { if (!whiteboard.creatingWhiteboard) whiteboard.closeNewWhiteboardDialog() }}
        />
      ) : null}
    </div>
  )
}

/** Starter prompts under the home composer; they fill the input, never send. */
export function WorkHomeStarters({ onPrompt }: { onPrompt: (prompt: string) => void }): ReactElement {
  const { t } = useTranslation('common')
  const starters = [
    { label: t('writeStarterSummarize'), prompt: t('writeStarterSummarizePrompt'), Icon: FileText },
    { label: t('writeStarterPdf'), prompt: t('writeStarterPdfPrompt'), Icon: MessageSquareQuote },
    { label: t('writeStarterSpreadsheet'), prompt: t('writeStarterSpreadsheetPrompt'), Icon: Table2 },
    { label: t('writeStarterPresentation'), prompt: t('writeStarterPresentationPrompt'), Icon: Presentation }
  ]
  return (
    <div className="work-home-starters" aria-label={t('writeStarterActionsLabel')}>
      {starters.map(({ label, prompt, Icon }) => (
        <button key={label} type="button" className="work-home-starter" onClick={() => onPrompt(prompt)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

/** Which space a new session lands in, with a quick switch above the home composer. */
export function WorkHomeSpaceChip(): ReactElement | null {
  const { t } = useTranslation('common')
  const { workspaceRoot, workspaceRoots, defaultWorkspaceRoot } = useWriteWorkspaceStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    workspaceRoots: s.workspaceRoots,
    defaultWorkspaceRoot: s.defaultWorkspaceRoot
  })))
  if (!workspaceRoot) return null
  const label = (root: string): string =>
    root === defaultWorkspaceRoot ? t('writeDefaultSpace') : writeBasenameFromPath(root) || root
  return (
    <div className="work-home-space">
      <RoomPopover label={t('workHomeSpaceSwitch')} width={260} side="top"
        className="work-home-space-trigger" trigger={(
          <>
            <Folder className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            <span>{label(workspaceRoot)}</span>
            <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden />
          </>
        )}>
        {(close) => (
          <div className="rooms-menu-list">
            {workspaceRoots.map((root) => (
              <button key={root} type="button" aria-pressed={root === workspaceRoot} title={root}
                onClick={() => { close(); void mountWorkSpace(root) }}>
                <Folder size={15} aria-hidden="true" /><span>{label(root)}</span>
                {root === workspaceRoot ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        )}
      </RoomPopover>
      <span className="work-home-space-hint">{t('workHomeSpaceHint')}</span>
    </div>
  )
}
