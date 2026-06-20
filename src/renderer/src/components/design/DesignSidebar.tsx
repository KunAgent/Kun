import { useRef, useState, type ReactElement } from 'react'
import { Check, Code2, FileCode2, FilePlus2, Layers, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignArtifact } from '../../design/design-types'
import { canImplementDesignArtifact, groupDesignArtifacts } from '../../design/design-artifact-actions'
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
  /** Hand the artifact to the coding agent (design → code spine). */
  onImplement: (artifact: DesignArtifact) => void
  /** Create a new SVG design canvas artifact. */
  onNewCanvas: () => void
  /** Collapse the left sidebar (rendered as the titlebar toggle inside SidebarFrame). */
  onToggleLeftSidebar?: () => void
}

/** Design-mode left sidebar: mode tabs + artifact list with implement/provenance. */
export function DesignSidebar({
  onCodeOpen,
  onWriteOpen,
  onDesignOpen,
  onImplement,
  onNewCanvas,
  onToggleLeftSidebar
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const setActiveArtifact = useDesignWorkspaceStore((s) => s.setActiveArtifact)
  const removeArtifact = useDesignWorkspaceStore((s) => s.removeArtifact)
  const renameArtifact = useDesignWorkspaceStore((s) => s.renameArtifact)
  const designSystemHash = useDesignWorkspaceStore((s) => s.designSystemHash)
  const closeImplementPanel = useDesignWorkspaceStore((s) => s.closeImplementPanel)
  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId) ?? null
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const committingRef = useRef(false)
  const grouped = groupDesignArtifacts(artifacts)

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
  const startNewDesign = (): void => {
    closeImplementPanel()
    setActiveArtifact(null)
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('[data-design-composer-textarea]')
        ?.focus()
    })
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
        const active = artifact.id === activeArtifactId
        const status = renderArtifactStatus(artifact)
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
                onClick={() => setActiveArtifact(artifact.id)}
                onDoubleClick={() => beginRename(artifact.id, artifact.title)}
                title={artifact.title}
                className="min-h-[34px]"
                buttonClassName="items-center gap-2 px-2.5 py-2"
                trailing={
                  <>
                    {artifact.versions.length > 1 ? (
                      <span className="text-[11.5px] text-ds-faint">
                        v{artifact.versions.length}
                      </span>
                    ) : null}
                    {status}
                  </>
                }
                actions={
                  <>
                    {canImplementDesignArtifact(artifact) ? (
                      <SidebarIconButton
                        onClick={() => onImplement(artifact)}
                        title={t('designImplement')}
                        ariaLabel={t('designImplement')}
                        tone="accent"
                        stopPropagation
                      >
                        <Code2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </SidebarIconButton>
                    ) : null}
                    <SidebarIconButton
                      onClick={() => removeArtifact(artifact.id)}
                      title={t('designDeleteArtifact')}
                      ariaLabel={t('designDeleteArtifact')}
                      tone="danger"
                      stopPropagation
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                  </>
                }
              >
                {artifact.kind === 'canvas' ? (
                  <Layers className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
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

  const renderSection = (title: string, items: DesignArtifact[], empty: string): ReactElement => (
    <section>
      <SidebarSectionHeader label={title} />
      {items.length > 0 ? renderArtifactRows(items) : (
        <div className="px-2.5 pb-2 text-[12px] leading-5 text-ds-faint">
          {empty}
        </div>
      )}
    </section>
  )

  return (
    <SidebarFrame title={t('appName')} onCollapse={onToggleLeftSidebar}>
      <div className="ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView="design"
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
          onDesignOpen={onDesignOpen}
        />
        <SidebarCommandRow
          icon={<FilePlus2 className="h-4 w-4" strokeWidth={1.9} />}
          label={t('designNewArtifact')}
          onClick={startNewDesign}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<Layers className="h-4 w-4" strokeWidth={1.9} />}
          label={t('designNewCanvas')}
          onClick={onNewCanvas}
        />
      </div>

      <div className="ds-no-drag mx-1.5 my-3" />

      <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {artifacts.length === 0 ? (
            <div className="mx-2 mt-2 rounded-lg px-2 py-2">
              <p className="text-[15px] font-medium text-ds-muted">{t('designNewArtifact')}</p>
              <p className="mt-1 text-[13px] leading-5 text-ds-faint">{t('designSidebarEmpty')}</p>
            </div>
          ) : (
            <>
              {renderSection(t('designDraftsSection'), grouped.html, t('designDraftsEmpty'))}
              {renderSection(t('designCanvasDesignSection'), grouped.canvas, t('designCanvasDesignEmpty'))}
            </>
          )}
          {activeArtifact?.kind === 'canvas' ? (
            <section>
              <SidebarSectionHeader label={t('canvasLayersTitle')} />
              <CanvasLayersPanel />
            </section>
          ) : null}
        </div>
      </div>
    </SidebarFrame>
  )
}
