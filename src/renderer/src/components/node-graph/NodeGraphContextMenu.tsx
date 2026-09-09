import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crosshair, MessageSquare, Plus, Route, Share2, X } from 'lucide-react'
import {
  NODE_GRAPH_GROUP_COLORS,
  type NodeGraphGroup
} from '../../node-graph/node-graph-settings'
import type { NodeGraphNode } from '../../node-graph/node-graph-types'
import { NODE_GRAPH_KIND_COLORS } from './node-graph-theme'
import { NodeGraphKindGlyph } from './NodeGraphKindLegend'
import { useKunNodeStyle } from '../../node-graph/kun-node-style'

export type NodeGraphContextMenuState = {
  node: NodeGraphNode
  /** Viewport position in CSS pixels, ready for `position: fixed`. */
  x: number
  y: number
}

type Props = {
  state: NodeGraphContextMenuState
  groups: readonly NodeGraphGroup[]
  /** Direct connections of the node, offered as an optional extra target. */
  connectedCount: number
  onClose: () => void
  onColorNode: (color: string, includeConnected: boolean) => void
  onAssignGroup: (groupId: string, includeConnected: boolean) => void
  onCreateGroup: (includeConnected: boolean) => void
  onClearGroup: (includeConnected: boolean) => void
  onFocusNode: () => void
  onPathStart: () => void
  onPathEnd: () => void
  /** True when this node is already the path source, so the menu can say so. */
  pathStartActive: boolean
  onOpenThread?: () => void
}

const MENU_WIDTH = 232
const MENU_MAX_HEIGHT = 420

function MenuRow({
  icon,
  label,
  selected,
  danger,
  onClick
}: {
  icon: ReactElement
  label: string
  selected?: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-ds-hover ${
        danger ? 'text-ds-danger' : 'text-ds-ink'
      }`}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={2} /> : null}
    </button>
  )
}

export function NodeGraphContextMenu({
  state,
  groups,
  connectedCount,
  onClose,
  onColorNode,
  onAssignGroup,
  onCreateGroup,
  onClearGroup,
  onFocusNode,
  onPathStart,
  onPathEnd,
  pathStartActive,
  onOpenThread
}: Props): ReactElement {
  const { t } = useTranslation('common')
  // Under Kun style a node wears artwork, not a colour, so the swatches and the
  // group rows are withheld — assigning either would change nothing on screen.
  const kunStyle = useKunNodeStyle()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [includeConnected, setIncludeConnected] = useState(false)
  const currentGroup = groups.find((group) => group.nodeIds.includes(state.node.id)) ?? null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    menuRef.current?.focus({ preventScroll: true })
  }, [])

  // Flip the menu back inside the viewport when opened near an edge. The
  // viewport is measured in CSS pixels to match the `fixed` coordinate space
  // under the shell's `body { zoom }` UI scale.
  const viewportWidth = typeof document !== 'undefined'
    ? document.documentElement.clientWidth
    : MENU_WIDTH
  const viewportHeight = typeof document !== 'undefined'
    ? document.documentElement.clientHeight
    : MENU_MAX_HEIGHT
  const left = Math.max(8, Math.min(state.x, viewportWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(state.y, Math.max(8, viewportHeight - MENU_MAX_HEIGHT - 8)))

  const run = (action: () => void) => (): void => {
    onClose()
    action()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        aria-label={state.node.label}
        className="ds-no-drag fixed z-50 flex max-h-[420px] flex-col overflow-y-auto rounded-[14px] border border-ds-border bg-ds-card p-1.5 text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] outline-none"
        style={{ left, top, width: MENU_WIDTH }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
          {kunStyle ? (
            <NodeGraphKindGlyph kind={state.node.kind} size={14} />
          ) : (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: currentGroup?.color ?? NODE_GRAPH_KIND_COLORS[state.node.kind]
              }}
            />
          )}
          <span className="min-w-0 truncate text-[12.5px] font-medium">{state.node.label}</span>
        </div>

        {kunStyle ? null : (
          <>
            <div className="px-2 pb-1 text-[10.5px] uppercase tracking-wide text-ds-faint">
              {t('nodeGraphMenuColor')}
            </div>
            <div className="grid grid-cols-8 gap-1 px-1.5 pb-1.5">
              {NODE_GRAPH_GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-label={color}
                  onClick={run(() => onColorNode(color, includeConnected))}
                  className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                    currentGroup?.color === color ? 'border-ds-ink' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            {connectedCount > 0 ? (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={includeConnected}
                onClick={() => setIncludeConnected((current) => !current)}
                className="mx-1.5 mb-1.5 flex items-center gap-2 rounded-control px-1 py-1 text-left text-[12px] text-ds-muted transition-colors hover:bg-ds-hover"
              >
                <Share2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">
                  {t('nodeGraphMenuIncludeConnected', { count: connectedCount })}
                </span>
                <span
                  aria-hidden
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ${
                    includeConnected ? 'border-accent bg-accent text-white' : 'border-ds-border'
                  }`}
                >
                  {includeConnected ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                </span>
              </button>
            ) : null}

            <div className="my-1 h-px bg-ds-border-muted" />
            <div className="px-2 pb-1 text-[10.5px] uppercase tracking-wide text-ds-faint">
              {t('nodeGraphGroups')}
            </div>
            {groups.map((group) => (
              <MenuRow
                key={group.id}
                icon={
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                }
                label={group.name.trim() || group.query.trim() || t('nodeGraphGroupUnnamed')}
                selected={currentGroup?.id === group.id}
                onClick={run(() => onAssignGroup(group.id, includeConnected))}
              />
            ))}
            <MenuRow
              icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
              label={t('nodeGraphMenuNewGroup')}
              onClick={run(() => onCreateGroup(includeConnected))}
            />
            {currentGroup ? (
              <MenuRow
                icon={<X className="h-3.5 w-3.5" strokeWidth={1.9} />}
                label={t('nodeGraphMenuClearGroup')}
                onClick={run(() => onClearGroup(includeConnected))}
              />
            ) : null}
          </>
        )}

        <div className="my-1 h-px bg-ds-border-muted" />
        {state.node.threadId && onOpenThread ? (
          <MenuRow
            icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={1.9} />}
            label={t('nodeGraphOpenThread')}
            onClick={run(onOpenThread)}
          />
        ) : null}
        <MenuRow
          icon={<Crosshair className="h-3.5 w-3.5" strokeWidth={1.9} />}
          label={t('nodeGraphFocusLocal')}
          onClick={run(onFocusNode)}
        />
        <MenuRow
          icon={<Route className="h-3.5 w-3.5" strokeWidth={1.9} />}
          label={t('nodeGraphMenuPathStart')}
          selected={pathStartActive}
          onClick={run(onPathStart)}
        />
        <MenuRow
          icon={<Route className="h-3.5 w-3.5" strokeWidth={1.9} />}
          label={t('nodeGraphMenuPathEnd')}
          onClick={run(onPathEnd)}
        />
      </div>
    </>
  )
}
