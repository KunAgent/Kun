import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWriteEditorBridge } from '../../write/write-editor-bridge'
import { sideRailButtonClass, WorkbenchSideRailSurface } from '../workbench/WorkbenchSideRail'
import { formatWriteRailBadge, resolveWriteRailItems, type WriteRailItem } from './write-side-rail-items'
import { WriteRightPanelIcon, writeRightPanelLabelKey } from './write-right-panel-meta'

/**
 * Work right rail: the same 48px surface and 32px buttons as the Code rail.
 * Clicking the visible tool collapses the panel; the rail itself stays.
 */
export function WriteSideRail(): ReactElement {
  const { t } = useTranslation('common')
  const { panel, toggle, referenceCount } = useWriteWorkspaceStore(useShallow((state) => ({
    panel: state.writeRightPanel,
    toggle: state.toggleWriteRightPanel,
    referenceCount: state.quotedSelections.length
  })))
  const reviewCount = useWriteEditorBridge((state) => state.reviewChunks.length)
  const assistantRunning = useChatStore((state) => state.busy)
  const items = resolveWriteRailItems({ reviewCount, referenceCount, assistantRunning })

  const renderItem = (item: WriteRailItem): ReactElement => {
    const active = panel.expanded && panel.activeId === item.id
    const label = t(writeRightPanelLabelKey(item.id))
    const description = item.badge
      ? t(item.id === 'review' ? 'workRailReviewCount' : 'workRailReferencesCount', { count: item.badge.count })
      : label
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => toggle(item.id)}
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
    <WorkbenchSideRailSurface role="toolbar" aria-orientation="vertical" aria-label={t('workRailLabel')}
      className="write-side-rail">
      {items.filter((item) => item.group === 'primary').map(renderItem)}
      <div className="mt-auto flex shrink-0 flex-col items-center gap-1.5 border-t border-ds-border-muted pt-2">
        {items.filter((item) => item.group === 'secondary').map(renderItem)}
      </div>
    </WorkbenchSideRailSurface>
  )
}
