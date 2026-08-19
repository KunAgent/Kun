import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, MessageSquare, Plus, RotateCcw } from 'lucide-react'
import {
  type NodeGraphGroup,
  type NodeGraphSettings
} from '../../node-graph/node-graph-settings'
import type {
  NodeGraphNodeKind,
  NodeGraphProjection
} from '../../node-graph/node-graph-types'
import { NodeGraphGroupsSection } from './NodeGraphGroupsSection'
import { NodeGraphKindLegend } from './NodeGraphKindLegend'
import { useKunNodeStyle } from '../../node-graph/kun-node-style'
import { ControlSection, SliderRow, ToggleRow } from './node-graph-control-primitives'

type Props = {
  settings: NodeGraphSettings
  counts: NodeGraphProjection['counts']
  focusedLabel: string | null
  onPatch: (patch: Partial<NodeGraphSettings>) => void
  onToggleKind: (kind: NodeGraphNodeKind) => void
  onAddGroup: () => void
  onUpdateGroup: (id: string, patch: Partial<Omit<NodeGraphGroup, 'id'>>) => void
  onRemoveGroup: (id: string) => void
  onReset: () => void
  onExitLocalGraph: () => void
}

/**
 * The left control rail.
 *
 * Ordered by how often a control is reached for: filters, then groups, then the
 * appearance and physics dials, with the node-kind legend pinned to the bottom
 * so the key to the canvas is always on screen no matter which section is open.
 *
 * Under Kun style the nodes carry artwork instead of a colour, so the group
 * editor is withheld rather than disabled: every control in it would edit a
 * colour nothing paints. The note in its place names the switch that brings it
 * back, because a section that silently vanishes reads as a bug.
 */
export function NodeGraphControls({
  settings,
  counts,
  focusedLabel,
  onPatch,
  onToggleKind,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onReset,
  onExitLocalGraph
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const kunStyle = useKunNodeStyle()
  const [groupQuery, setGroupQuery] = useState('')
  const visibleGroups = groupQuery.trim()
    ? settings.groups.filter((group) =>
        `${group.name} ${group.query}`.toLocaleLowerCase().includes(groupQuery.trim().toLocaleLowerCase()))
    : settings.groups

  return (
    <aside className="flex h-full min-h-0 w-[286px] shrink-0 flex-col border-r border-ds-border-muted bg-ds-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border-muted px-2.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
          {t('nodeGraphControls')}
        </h2>
        <button
          type="button"
          onClick={onReset}
          title={t('nodeGraphReset')}
          aria-label={t('nodeGraphReset')}
          className="rounded-control p-1 text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ControlSection title={t('nodeGraphFilters')} defaultOpen>
          <ToggleRow
            label={t('nodeGraphKindWorkspace')}
            icon={<Layers className="h-3.5 w-3.5" strokeWidth={1.8} />}
            checked={settings.kinds.workspace !== false}
            onChange={() => onToggleKind('workspace')}
            count={counts.workspace ?? 0}
          />
          <ToggleRow
            label={t('nodeGraphKindThread')}
            icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />}
            checked={settings.kinds.thread !== false}
            onChange={() => onToggleKind('thread')}
            count={counts.thread ?? 0}
          />
          <SliderRow
            label={t('nodeGraphMinDegree')}
            value={settings.minDegree}
            settingKey="minDegree"
            format={(value) => String(Math.round(value))}
            onChange={(value) => onPatch({ minDegree: Math.round(value) })}
          />
          <ToggleRow
            label={t('nodeGraphShowOrphans')}
            checked={settings.showOrphans}
            onChange={(value) => onPatch({ showOrphans: value })}
          />
          <ToggleRow
            label={t('nodeGraphIncludeChangedFiles')}
            hint={t('nodeGraphIncludeChangedFilesHint')}
            checked={settings.includeChangedFiles}
            onChange={(value) => onPatch({ includeChangedFiles: value })}
          />
          <p className="text-[10.5px] leading-4 text-ds-faint">{t('nodeGraphSearchHint')}</p>
        </ControlSection>

        {kunStyle ? (
          <p className="border-b border-ds-border-muted px-2.5 py-2 text-[11px] leading-4 text-ds-faint">
            {t('nodeGraphKunStyleNote')}
          </p>
        ) : (
          <ControlSection
            title={t('nodeGraphGroups')}
            action={
              <button
                type="button"
                onClick={onAddGroup}
                title={t('nodeGraphNewGroup')}
                aria-label={t('nodeGraphNewGroup')}
                className="rounded-control p-1 text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            }
          >
            {settings.groups.length > 2 ? (
              <input
                type="search"
                value={groupQuery}
                onChange={(event) => setGroupQuery(event.target.value)}
                placeholder={t('nodeGraphGroupSearch')}
                aria-label={t('nodeGraphGroupSearch')}
                className="w-full rounded-control border border-ds-border-muted bg-ds-main px-2 py-1 text-[12px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-accent"
              />
            ) : null}
            <NodeGraphGroupsSection
              groups={visibleGroups}
              onAddGroup={onAddGroup}
              onUpdateGroup={onUpdateGroup}
              onRemoveGroup={onRemoveGroup}
            />
          </ControlSection>
        )}

        <ControlSection title={t('nodeGraphDisplay')}>
          <ToggleRow
            label={t('nodeGraphArrows')}
            checked={settings.showArrows}
            onChange={(value) => onPatch({ showArrows: value })}
          />
          <ToggleRow
            label={t('nodeGraphEdgeLabels')}
            checked={settings.showEdgeLabels}
            onChange={(value) => onPatch({ showEdgeLabels: value })}
          />
          <ToggleRow
            label={t('nodeGraphMinimapToggle')}
            checked={settings.showMinimap}
            onChange={(value) => onPatch({ showMinimap: value })}
          />
          <SliderRow
            label={t('nodeGraphTextFade')}
            value={settings.textFadeThreshold}
            settingKey="textFadeThreshold"
            onChange={(value) => onPatch({ textFadeThreshold: value })}
          />
          <SliderRow
            label={t('nodeGraphNodeSize')}
            value={settings.nodeSize}
            settingKey="nodeSize"
            onChange={(value) => onPatch({ nodeSize: value })}
          />
          <SliderRow
            label={t('nodeGraphLinkThickness')}
            value={settings.linkThickness}
            settingKey="linkThickness"
            onChange={(value) => onPatch({ linkThickness: value })}
          />
        </ControlSection>

        <ControlSection title={t('nodeGraphForces')}>
          <SliderRow
            label={t('nodeGraphCenterForce')}
            value={settings.centerForce}
            settingKey="centerForce"
            onChange={(value) => onPatch({ centerForce: value })}
          />
          <SliderRow
            label={t('nodeGraphRepelForce')}
            value={settings.repelForce}
            settingKey="repelForce"
            onChange={(value) => onPatch({ repelForce: value })}
          />
          <SliderRow
            label={t('nodeGraphLinkForce')}
            value={settings.linkForce}
            settingKey="linkForce"
            onChange={(value) => onPatch({ linkForce: value })}
          />
          <SliderRow
            label={t('nodeGraphLinkDistance')}
            value={settings.linkDistance}
            settingKey="linkDistance"
            format={(value) => String(Math.round(value))}
            onChange={(value) => onPatch({ linkDistance: value })}
          />
        </ControlSection>

        <ControlSection title={t('nodeGraphLocalGraph')} defaultOpen={Boolean(focusedLabel)}>
          <SliderRow
            label={t('nodeGraphDepth')}
            value={settings.localDepth}
            settingKey="localDepth"
            format={(value) => String(Math.round(value))}
            onChange={(value) => onPatch({ localDepth: Math.round(value) })}
          />
          {focusedLabel ? (
            <>
              <p className="truncate text-[11.5px] text-ds-muted">
                {t('nodeGraphFocusedOn', { label: focusedLabel })}
              </p>
              <button
                type="button"
                onClick={onExitLocalGraph}
                className="self-start rounded-control border border-ds-border-muted px-2 py-1 text-[11.5px] text-ds-muted transition-colors hover:border-accent hover:text-ds-ink"
              >
                {t('nodeGraphExitLocal')}
              </button>
            </>
          ) : (
            <p className="text-[11.5px] text-ds-faint">{t('nodeGraphGlobalGraph')}</p>
          )}
        </ControlSection>

      </div>

      <div className="shrink-0 border-t border-ds-border-muted p-2">
        <NodeGraphKindLegend
          counts={counts}
          kinds={settings.kinds}
          onToggleKind={onToggleKind}
        />
      </div>
    </aside>
  )
}
