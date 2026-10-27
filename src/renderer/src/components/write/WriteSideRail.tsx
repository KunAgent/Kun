import { useMemo, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWriteEditorBridge } from '../../write/write-editor-bridge'
import { sideRailButtonClass, WorkbenchSideRailDivider, WorkbenchSideRailSurface } from '../workbench/WorkbenchSideRail'
import { RailPortal } from '../workbench/rail-slot'
import { RailCollapseButton, useRailCollapseStore } from '../workbench/rail-collapse'
import { buildResearchPool } from '../../paper/paper-research-pool'
import { formatWriteRailBadge, resolveWriteRailItems, WRITE_DOCUMENT_PANEL_IDS, type WriteRailItem } from './write-side-rail-items'
import { WriteRightPanelIcon, writeRightPanelLabelKey } from './write-right-panel-meta'
import { useWorkConversationStage } from '../../write/work-conversation-stage'

/** Papers the open session's searches surfaced (0 when nothing was searched). */
function useSessionPaperCount(): number {
  const blocks = useChatStore((state) => state.blocks)
  return useMemo(() => buildResearchPool(blocks).entries.length, [blocks])
}

/**
 * Work right rail: the work card's own right column, exactly like the Code
 * rail — it starts at the tab-strip row with the fold button, then the Work
 * tools, then the shared MCP/usage tools at the bottom. Clicking the visible
 * tool collapses the panel; folding hides the whole rail until the tab strip's
 * reopen button brings it back.
 */
export function WriteSideRail(): ReactElement | null {
  const { t } = useTranslation('common')
  const { panel, toggle, referenceCount } = useWriteWorkspaceStore(useShallow((state) => ({
    panel: state.writeRightPanel,
    toggle: state.toggleWriteRightPanel,
    referenceCount: state.quotedSelections.length
  })))
  const reviewCount = useWriteEditorBridge((state) => state.reviewChunks.length)
  const assistantRunning = useChatStore((state) => state.busy)
  const paperCount = useSessionPaperCount()
  const railCollapsed = useRailCollapseStore((state) => state.collapsed)
  const stage = useWorkConversationStage()
  if (railCollapsed) return null
  const items = resolveWriteRailItems({ reviewCount, referenceCount, assistantRunning, paperCount, documentTools: !stage })

  const renderItem = (item: WriteRailItem): ReactElement => {
    // In the centered stage the document tools fold into the assistant, and
    // 论文 sits beside the conversation rather than replacing it.
    const active = stage
      ? (WRITE_DOCUMENT_PANEL_IDS.has(panel.activeId) ? 'assistant' : panel.activeId) === item.id
      : panel.expanded && panel.activeId === item.id
    const label = t(writeRightPanelLabelKey(item.id))
    const description = item.badge
      ? t(item.id === 'review' ? 'workRailReviewCount' : item.id === 'papers' ? 'workRailPapersCount' : 'workRailReferencesCount',
        { count: item.badge.count })
      : label
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          // The centered assistant cannot collapse; a second click is a no-op.
          if (stage && active && item.id === 'assistant') return
          // In the stage, closing 论文 returns to the conversation alone.
          if (stage && active && item.id === 'papers') {
            toggle('assistant')
            return
          }
          toggle(item.id)
        }}
        className={sideRailButtonClass(active, 'relative')}
        data-tooltip={description}
        data-write-rail-item={item.id}
        aria-label={description}
        aria-pressed={active}
      >
        <WriteRightPanelIcon id={item.id} />
        {item.badge ? (
          <span
            aria-hidden="true"
            className={`write-rail-badge ${item.badge.tone === 'accent' ? 'is-accent' : 'is-neutral'}`}
          >
            {formatWriteRailBadge(item.badge.count)}
          </span>
        ) : null}
        {item.running ? <span aria-hidden="true" className="write-rail-running-dot" /> : null}
      </button>
    )
  }

  return (
    <RailPortal>
      <WorkbenchSideRailSurface role="toolbar" aria-orientation="vertical" aria-label={t('workRailLabel')}
        className="write-side-rail">
        <RailCollapseButton />
        <WorkbenchSideRailDivider />
        {items.filter((item) => item.group === 'primary').map(renderItem)}
        <span className="flex-1" aria-hidden="true" />
        <WorkbenchSideRailDivider />
        {items.filter((item) => item.group === 'secondary').map(renderItem)}
      </WorkbenchSideRailSurface>
    </RailPortal>
  )
}
