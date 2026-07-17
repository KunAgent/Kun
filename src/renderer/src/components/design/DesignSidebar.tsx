import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Check,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  Layers,
  Moon,
  Palette,
  Pencil,
  RotateCcw,
  Settings,
  Spline,
  Sun,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SettingsRouteSection } from '../../store/chat-store'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import {
  currentDesignArtifactVersion,
  designArtifactVersionLabel,
  designArtifactVersionNumber,
  isFileDesignArtifactKind,
  type DesignArtifact,
  type DesignDocument
} from '../../design/design-types'
import { collectAgentDrawingArtifactIds, groupDesignArtifacts } from '../../design/design-artifact-actions'
import { findDesignBoardArtifact } from '../../design/design-board'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { embeddedArtifactOf, isArtifactFrame, isHtmlFrame, shapeBounds } from '../../design/canvas/canvas-types'
import { useCanvasViewportStore } from '../../design/canvas/canvas-viewport-store'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { CanvasLayersPanel } from './canvas/CanvasLayersPanel'

type Props = {
  onCodeOpen: () => void
  onWriteOpen: () => void
  onDesignOpen: () => void
  onCollaborationOpen: () => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleTheme: () => void
}

export function getDesignSidebarVisibleArtifacts(artifacts: readonly DesignArtifact[]): DesignArtifact[] {
  return artifacts.filter((artifact) => artifact.node?.boardHidden !== true)
}

export function getDesignSidebarDocumentScreenCount(doc: Pick<DesignDocument, 'artifacts'>): number {
  return getDesignSidebarVisibleArtifacts(doc.artifacts).filter((artifact) => artifact.kind === 'html').length
}

/** Visible first-class HTML/SVG artifacts; excludes the implementation board. */
export function getDesignSidebarDocumentArtifactCount(doc: Pick<DesignDocument, 'artifacts'>): number {
  return getDesignSidebarVisibleArtifacts(doc.artifacts).filter((artifact) => isFileDesignArtifactKind(artifact.kind)).length
}

export function getDesignSidebarDocumentLabel(doc: Pick<DesignDocument, 'id'>): string {
  return doc.id
}

export function getDesignSidebarArtifactVersionBadge(artifact: DesignArtifact): string | null {
  const current = currentDesignArtifactVersion(artifact)
  const versionNumber = current ? designArtifactVersionNumber(current) : null
  if ((versionNumber ?? artifact.versions.length) <= 1 && artifact.versions.length <= 1) return null
  return designArtifactVersionLabel(current, Math.max(1, artifact.versions.length))
}

/**
 * Design-mode left sidebar: mode tabs + a 设计稿 (design document) tree. Each
 * 设计稿 is a top-level container; its 画布 (artifacts) show nested under the
 * active one.
 */
export function DesignSidebar({
  onCodeOpen,
  onWriteOpen,
  onDesignOpen,
  onCollaborationOpen,
  onOpenSettings,
  onToggleTheme
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [isDarkMode, setIsDarkMode] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const documents = useDesignWorkspaceStore((s) => s.documents)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const setActiveArtifact = useDesignWorkspaceStore((s) => s.setActiveArtifact)
  const removeArtifact = useDesignWorkspaceStore((s) => s.removeArtifact)
  const renameArtifact = useDesignWorkspaceStore((s) => s.renameArtifact)
  const createDocument = useDesignWorkspaceStore((s) => s.createDocument)
  const renameDocument = useDesignWorkspaceStore((s) => s.renameDocument)
  const removeDocument = useDesignWorkspaceStore((s) => s.removeDocument)
  const switchActiveDocument = useDesignWorkspaceStore((s) => s.switchActiveDocument)
  const designSystemHash = useDesignWorkspaceStore((s) => s.designSystemHash)
  const closeImplementPanel = useDesignWorkspaceStore((s) => s.closeImplementPanel)
  const setDesignIntentMode = useDesignWorkspaceStore((s) => s.setDesignIntentMode)
  const setCanvasAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)
  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId) ?? null

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const committingRef = useRef(false)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [docDraft, setDocDraft] = useState('')
  const committingDocRef = useRef(false)
  const [agentDrawingsOpen, setAgentDrawingsOpen] = useState(true)

  const canvasDocument = useCanvasShapeStore((s) => s.document)
  const canvasObjects = canvasDocument.objects
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const visibleArtifacts = useMemo(() => getDesignSidebarVisibleArtifacts(artifacts), [artifacts])
  const screenLinkedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of Object.keys(canvasObjects)) {
      const shape = canvasObjects[id]
      if (shape && isHtmlFrame(shape) && shape.htmlArtifactId) ids.add(shape.htmlArtifactId)
    }
    return ids
  }, [canvasObjects])
  const selectedHtmlArtifactId = useMemo(() => {
    for (const id of selectedIds) {
      const shape = canvasObjects[id]
      if (shape && isHtmlFrame(shape) && shape.htmlArtifactId) return shape.htmlArtifactId
    }
    return null
  }, [canvasObjects, selectedIds])
  const selectedEmbeddedArtifactId = useMemo(() => {
    for (const id of selectedIds) {
      const shape = canvasObjects[id]
      const reference = shape ? embeddedArtifactOf(shape) : null
      if (reference) return reference.id
    }
    return null
  }, [canvasObjects, selectedIds])
  const grouped = useMemo(
    () => groupDesignArtifacts(visibleArtifacts, screenLinkedIds),
    [screenLinkedIds, visibleArtifacts]
  )
  const agentDrawingArtifactIds = useMemo(() => {
    return collectAgentDrawingArtifactIds(visibleArtifacts, grouped, screenLinkedIds)
  }, [grouped, screenLinkedIds, visibleArtifacts])
  const agentDrawingArtifacts = useMemo(
    () => visibleArtifacts.filter((artifact) => artifact.kind === 'html' && agentDrawingArtifactIds.has(artifact.id)),
    [agentDrawingArtifactIds, visibleArtifacts]
  )
  const sortedDocuments = useMemo(
    () => [...documents].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [documents]
  )

  const focusComposer = (): void => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-design-rail-composer] textarea')?.focus()
    })
  }

  const beginRename = (artifactId: string, title: string): void => {
    committingRef.current = false
    setDraft(title)
    setEditingId(artifactId)
  }
  const commitRename = (artifactId: string): void => {
    if (committingRef.current) return
    committingRef.current = true
    renameArtifact(artifactId, draft)
    setEditingId(null)
  }

  const beginRenameDoc = (documentId: string, title: string): void => {
    committingDocRef.current = false
    setDocDraft(title)
    setEditingDocId(documentId)
  }
  const commitRenameDoc = (documentId: string): void => {
    if (committingDocRef.current) return
    committingDocRef.current = true
    renameDocument(documentId, docDraft)
    setEditingDocId(null)
  }

  // New 设计稿: a fresh top-level container (its own canvas + conversation).
  const handleNewDocument = (): void => {
    closeImplementPanel()
    setDesignIntentMode('generate')
    setCanvasAssistantOpen(true)
    useCanvasSelectionStore.getState().clearSelection()
    createDocument()
    focusComposer()
  }

  const handleSelectDocument = (documentId: string): void => {
    if (documentId === activeDocumentId) return
    closeImplementPanel()
    useCanvasSelectionStore.getState().clearSelection()
    switchActiveDocument(documentId)
  }

  const handleSelectAgentDrawing = (artifact: DesignArtifact): void => {
    closeImplementPanel()
    const boardArtifact = findDesignBoardArtifact(useDesignWorkspaceStore.getState().artifacts)
    if (boardArtifact) setActiveArtifact(boardArtifact.id)

    const frame = Object.values(useCanvasShapeStore.getState().document.objects).find((shape) =>
      shape && isArtifactFrame(shape) && embeddedArtifactOf(shape)?.id === artifact.id
    )
    const viewportStore = useCanvasViewportStore.getState()
    viewportStore.setActiveTool('select')

    if (frame) {
      useCanvasSelectionStore.getState().select([frame.id])
      viewportStore.zoomToFit(shapeBounds(frame), 72, { maxZoom: 1, minZoom: 0.18 })
      return
    }

    useCanvasSelectionStore.getState().clearSelection()
    if (boardArtifact && artifact.kind === 'html' && artifact.node?.boardHidden) {
      useDesignWorkspaceStore.getState().updateArtifactNode(artifact.id, { boardHidden: false })
    }
    if (artifact.node) {
      viewportStore.zoomToFit(
        {
          x: artifact.node.x,
          y: artifact.node.y,
          width: artifact.node.width,
          height: artifact.node.height
        },
        72,
        { maxZoom: 1, minZoom: 0.18 }
      )
    }
    if (!boardArtifact) setActiveArtifact(artifact.id)
  }

  const renderArtifactStatus = (artifact: DesignArtifact): ReactElement | null => {
    const implemented = Boolean(artifact.implementedAt)
    if (!implemented) return null
    const drift = (artifact.implementedAt ?? '') < artifact.updatedAt
    const codeDrift =
      !drift &&
      Boolean(artifact.implementedDesignSystemHash) &&
      Boolean(designSystemHash) &&
      artifact.implementedDesignSystemHash !== designSystemHash
    const title = drift ? t('designDrift') : codeDrift ? t('designCodeDrift') : t('designImplemented')
    const Icon = drift ? RotateCcw : codeDrift ? TriangleAlert : Check
    return (
      <span
        title={title}
        aria-label={title}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${
          drift ? 'text-[#c98a3a]' : codeDrift ? 'text-[#c0392b]' : 'text-[#2e9e6b]'
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </span>
    )
  }

  const renderArtifactRows = (items: DesignArtifact[]): ReactElement => (
    <ul className="space-y-1">
      {items.map((artifact) => {
        const active = artifact.id === activeArtifactId || artifact.id === selectedEmbeddedArtifactId
        const status = renderArtifactStatus(artifact)
        const versionBadge = getDesignSidebarArtifactVersionBadge(artifact)
        return (
          <li key={artifact.id}>
            {editingId === artifact.id ? (
              <div className="flex min-h-[34px] items-center rounded-[8px] bg-[var(--ds-sidebar-row-active)] px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(artifact.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(artifact.id)
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="h-7 min-w-0 flex-1 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-field-focus)] px-2 text-[13px] text-[#1f2733] outline-none focus:border-[#3b82d8] dark:text-white"
                />
              </div>
            ) : (
              <SidebarTreeRow
                active={active}
                onClick={() => artifact.kind === 'svg'
                  ? handleSelectAgentDrawing(artifact)
                  : setActiveArtifact(artifact.id)}
                onDoubleClick={() => beginRename(artifact.id, artifact.title)}
                title={artifact.title}
                className="min-h-[34px]"
                buttonClassName="items-center gap-2 px-2.5 py-2"
                trailing={
                  <>
                    {versionBadge ? (
                      <span className="text-[11.5px] text-ds-faint">{versionBadge}</span>
                    ) : null}
                    {status}
                  </>
                }
                actions={
                  <SidebarIconButton
                    onClick={() => removeArtifact(artifact.id)}
                    title={t('designDeleteArtifact')}
                    ariaLabel={t('designDeleteArtifact')}
                    tone="danger"
                    stopPropagation
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </SidebarIconButton>
                }
              >
                {artifact.kind === 'canvas' ? (
                  <Layers className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
                ) : artifact.kind === 'svg' ? (
                  <Spline className="h-3.5 w-3.5 shrink-0 text-[#6557ff]" strokeWidth={1.9} />
                ) : (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
                )}
                <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
              </SidebarTreeRow>
            )}
          </li>
        )
      })}
    </ul>
  )

  const renderAgentDrawingRows = (items: DesignArtifact[]): ReactElement => {
    const scrollable = items.length > 5
    return (
      <div className={scrollable ? 'max-h-[190px] overflow-y-auto pr-1' : undefined}>
        <ul className="space-y-1">
          {items.map((artifact) => {
            const active = artifact.id === activeArtifactId || artifact.id === selectedHtmlArtifactId
            const status = renderArtifactStatus(artifact)
            const versionBadge = getDesignSidebarArtifactVersionBadge(artifact)
            return (
              <li key={artifact.id}>
                {editingId === artifact.id ? (
                  <div className="flex min-h-[34px] items-center rounded-[8px] bg-[var(--ds-sidebar-row-active)] px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(artifact.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(artifact.id)
                        else if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="h-7 min-w-0 flex-1 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-field-focus)] px-2 text-[13px] text-[#1f2733] outline-none focus:border-[#3b82d8] dark:text-white"
                    />
                  </div>
                ) : (
                  <SidebarTreeRow
                    active={active}
                    onClick={() => handleSelectAgentDrawing(artifact)}
                    onDoubleClick={() => beginRename(artifact.id, artifact.title)}
                    title={artifact.title}
                    className="min-h-[34px]"
                    buttonClassName="items-center gap-2 px-2.5 py-2"
                    trailing={
                      <>
                        {versionBadge ? (
                          <span className="text-[11.5px] text-ds-faint">{versionBadge}</span>
                        ) : null}
                        {status}
                      </>
                    }
                    actions={
                      <SidebarIconButton
                        onClick={() => removeArtifact(artifact.id)}
                        title={t('designDeleteArtifact')}
                        ariaLabel={t('designDeleteArtifact')}
                        tone="danger"
                        stopPropagation
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </SidebarIconButton>
                    }
                  >
                    <Palette className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
                  </SidebarTreeRow>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const renderAgentDrawingsSection = (items: DesignArtifact[]): ReactElement => {
    const toggleLabel = t(agentDrawingsOpen ? 'designAgentDrawingsCollapse' : 'designAgentDrawingsExpand')
    return (
      <section>
        <button
          type="button"
          onClick={() => setAgentDrawingsOpen((open) => !open)}
          title={toggleLabel}
          aria-label={toggleLabel}
          className="flex w-full items-center gap-1 px-2.5 pb-2 pt-5 text-left text-[12px] font-normal text-[#9aa5b5] transition hover:text-ds-muted dark:text-white/35 dark:hover:text-white/55"
        >
          {agentDrawingsOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          )}
          <span className="min-w-0 flex-1 truncate">{t('designAgentDrawingsTitle')}</span>
          <span className="shrink-0 text-[11.5px] text-ds-faint">{items.length}</span>
        </button>
        {agentDrawingsOpen ? renderAgentDrawingRows(items) : null}
      </section>
    )
  }

  // The board canvas is an implementation surface, so keep the tree focused on
  // user-created drafts while exposing board layers below.
  const renderActiveDocBody = (): ReactElement => {
    const items = [
      ...grouped.html.filter((artifact) => !agentDrawingArtifactIds.has(artifact.id)),
      ...grouped.svg
    ]
    return (
      <div className="ml-3 mt-0.5 space-y-1 border-l border-[var(--ds-sidebar-row-ring)] pl-2">
        {items.length > 0 ? (
          renderArtifactRows(items)
        ) : agentDrawingArtifacts.length === 0 && activeArtifact?.kind !== 'canvas' ? (
          <div className="px-2.5 py-1.5 text-[12px] leading-5 text-ds-faint">{t('designDocEmpty')}</div>
        ) : null}
        {agentDrawingArtifacts.length > 0 ? renderAgentDrawingsSection(agentDrawingArtifacts) : null}
        {activeArtifact?.kind === 'canvas' ? (
          <section>
            <SidebarSectionHeader label={t('canvasLayersTitle')} />
            <CanvasLayersPanel />
          </section>
        ) : null}
      </div>
    )
  }

  const renderDocument = (doc: DesignDocument): ReactElement => {
    const isActive = doc.id === activeDocumentId
    const artifactCount = getDesignSidebarDocumentArtifactCount(doc)
    const documentLabel = getDesignSidebarDocumentLabel(doc)
    return (
      <li key={doc.id}>
        {editingDocId === doc.id ? (
          <div className="flex min-h-[34px] items-center rounded-[8px] bg-[var(--ds-sidebar-row-active)] px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]">
            <input
              autoFocus
              value={docDraft}
              onChange={(e) => setDocDraft(e.target.value)}
              onBlur={() => commitRenameDoc(doc.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRenameDoc(doc.id)
                else if (e.key === 'Escape') setEditingDocId(null)
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-field-focus)] px-2 text-[13px] text-[#1f2733] outline-none focus:border-[#3b82d8] dark:text-white"
            />
          </div>
        ) : (
          <SidebarTreeRow
            active={isActive}
            onClick={() => handleSelectDocument(doc.id)}
            onDoubleClick={() => beginRenameDoc(doc.id, documentLabel)}
            title={`@${documentLabel}`}
            className="min-h-[34px]"
            buttonClassName="items-center gap-2 px-2.5 py-2"
            trailing={
              artifactCount > 0 ? (
                <span className="text-[11.5px] text-ds-faint">{artifactCount}</span>
              ) : null
            }
            actions={
              <>
                <SidebarIconButton
                  onClick={() => beginRenameDoc(doc.id, documentLabel)}
                  title={t('designRenameDocument')}
                  ariaLabel={t('designRenameDocument')}
                  stopPropagation
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                </SidebarIconButton>
                <SidebarIconButton
                  onClick={() => removeDocument(doc.id)}
                  title={t('designDeleteDocument')}
                  ariaLabel={t('designDeleteDocument')}
                  tone="danger"
                  stopPropagation
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                </SidebarIconButton>
              </>
            }
          >
            {isActive ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#3b82d8]" strokeWidth={1.9} />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
            )}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="min-w-0 truncate font-mono">{documentLabel}</span>
            </span>
          </SidebarTreeRow>
        )}
        {isActive ? renderActiveDocBody() : null}
      </li>
    )
  }

  return (
    <>
      <SidebarFrame
        title={t('appName')}
        footer={
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SidebarCommandRow
                  icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
                  label={t('settings')}
                  onClick={() => onOpenSettings('design')}
                  variant="footer"
                />
              </div>
              <SidebarIconButton
                title={isDarkMode ? t('switchToLight') : t('switchToDark')}
                ariaLabel={t('toggleTheme')}
                onClick={onToggleTheme}
              >
                {isDarkMode ? (
                  <Sun className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Moon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </SidebarIconButton>
            </div>
          </div>
        }
      >
        <div className="ds-no-drag flex flex-col px-1">
          <WorkspaceModeTabs
            activeView="design"
            onCodeOpen={onCodeOpen}
            onWriteOpen={onWriteOpen}
            onDesignOpen={onDesignOpen}
            onCollaborationOpen={onCollaborationOpen}
          />
          <SidebarCommandRow
            icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.9} />}
            label={t('designNewDocument')}
            onClick={handleNewDocument}
            variant="accent"
          />
        </div>

        <div className="ds-no-drag mx-1.5 my-3" />

        <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {sortedDocuments.length === 0 ? (
              <div className="mx-2 mt-2 rounded-lg px-2 py-2">
                <p className="text-[15px] font-medium text-ds-muted">{t('designNewDocument')}</p>
                <p className="mt-1 text-[13px] leading-5 text-ds-faint">{t('designSidebarEmpty')}</p>
              </div>
            ) : (
              <ul className="space-y-0.5">{sortedDocuments.map((doc) => renderDocument(doc))}</ul>
            )}
          </div>
        </div>
      </SidebarFrame>
    </>
  )
}
