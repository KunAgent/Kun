import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import {
  MAX_NODE_GRAPH_GROUPS,
  NODE_GRAPH_GROUP_COLORS,
  type NodeGraphGroup
} from '../../node-graph/node-graph-settings'

type Props = {
  groups: readonly NodeGraphGroup[]
  onAddGroup: () => void
  onUpdateGroup: (id: string, patch: Partial<Omit<NodeGraphGroup, 'id'>>) => void
  onRemoveGroup: (id: string) => void
}

/**
 * Group editor. Each group carries a name, a freely chosen colour, an optional
 * query, and however many nodes were assigned to it by right-clicking, so the
 * panel has to surface all four without turning into a form.
 */
export function NodeGraphGroupsSection({
  groups,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup
}: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group, position) => (
        <div
          key={group.id}
          className="flex flex-col gap-1.5 rounded-control border border-ds-border-muted bg-ds-main p-1.5"
        >
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={group.color}
              aria-label={t('nodeGraphGroupColor')}
              onChange={(event) => onUpdateGroup(group.id, { color: event.target.value })}
              className="h-6 w-6 shrink-0 cursor-pointer rounded-control border border-ds-border-muted bg-transparent p-0"
            />
            <input
              type="text"
              value={group.name}
              placeholder={t('nodeGraphGroupNamePlaceholder', { position: position + 1 })}
              aria-label={t('nodeGraphGroupNamePlaceholder', { position: position + 1 })}
              onChange={(event) => onUpdateGroup(group.id, { name: event.target.value })}
              className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] font-medium text-ds-ink outline-none placeholder:font-normal placeholder:text-ds-faint hover:border-ds-border-muted focus:border-accent"
            />
            <button
              type="button"
              onClick={() => onRemoveGroup(group.id)}
              title={t('nodeGraphRemoveGroup')}
              aria-label={t('nodeGraphRemoveGroup')}
              className="shrink-0 rounded-control p-1 text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-danger"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex flex-wrap gap-1 px-0.5">
            {NODE_GRAPH_GROUP_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={color}
                onClick={() => onUpdateGroup(group.id, { color })}
                className={`h-3.5 w-3.5 rounded-full border transition-transform hover:scale-125 ${
                  group.color === color ? 'border-ds-ink' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <input
            type="text"
            value={group.query}
            placeholder={t('nodeGraphGroupQueryPlaceholder')}
            aria-label={t('nodeGraphGroupQueryPlaceholder')}
            onChange={(event) => onUpdateGroup(group.id, { query: event.target.value })}
            className="w-full rounded-control border border-ds-border-muted bg-ds-card px-1.5 py-1 font-mono text-[11.5px] text-ds-ink outline-none placeholder:font-sans placeholder:text-ds-faint focus:border-accent"
          />

          <p className="px-0.5 text-[11px] text-ds-faint">
            {group.nodeIds.length > 0
              ? t('nodeGraphGroupAssigned', { count: group.nodeIds.length })
              : t('nodeGraphGroupAssignHint')}
          </p>
        </div>
      ))}

      <button
        type="button"
        onClick={onAddGroup}
        disabled={groups.length >= MAX_NODE_GRAPH_GROUPS}
        className="flex items-center gap-1.5 self-start rounded-control border border-dashed border-ds-border-muted px-2 py-1 text-[12px] text-ds-muted transition-colors hover:border-accent hover:text-ds-ink disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t('nodeGraphNewGroup')}
      </button>
      <p className="text-[11px] leading-4 text-ds-faint">{t('nodeGraphGroupsHint')}</p>
    </div>
  )
}
