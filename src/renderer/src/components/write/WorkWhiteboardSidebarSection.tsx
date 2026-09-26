import type { ReactElement } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  PencilLine,
  Plus,
  Shapes,
  Trash2
} from 'lucide-react'
import type { WorkWhiteboard } from '../../write/write-workspace-store'
import { workWhiteboardResolvedEngine } from '../../write/work-whiteboard'
import { SidebarActivityIndicator, type SidebarActivity } from '../sidebar/SidebarActivityIndicator'
import { SidebarIconButton, SidebarTreeRow } from '../sidebar/SidebarPrimitives'

type Props = {
  whiteboards: WorkWhiteboard[]
  activeWhiteboardId: string | null
  expanded: boolean
  openMenuId: string | null
  label: string
  createLabel: string
  moreActionsLabel: string
  renameLabel: string
  deleteLabel: string
  runningLabel?: string
  failedLabel?: string
  unreadLabel?: string
  awaitingInputLabel?: string
  activityForBoard?: (board: WorkWhiteboard) => SidebarActivity
  onToggle: () => void
  onCreate: () => void
  onOpen: (boardId: string) => void
  onToggleMenu: (boardId: string) => void
  onRename: (board: WorkWhiteboard) => void
  onDelete: (board: WorkWhiteboard) => void
}

function phaseIndicator(phase: WorkWhiteboard['phase']): ReactElement | null {
  if (phase === 'blank') return null
  return (
    <span className={`h-2 w-2 rounded-full ${
      phase === 'complete' ? 'bg-emerald-500' : 'bg-amber-500'
    }`} />
  )
}

function groupActivity(
  whiteboards: readonly WorkWhiteboard[],
  activityForBoard: (board: WorkWhiteboard) => SidebarActivity
): SidebarActivity {
  const priority: Record<SidebarActivity, number> = {
    idle: 0,
    unread: 1,
    failed: 2,
    running: 3,
    'awaiting-input': 4
  }
  return whiteboards.reduce<SidebarActivity>((current, board) => {
    const next = activityForBoard(board)
    return priority[next] > priority[current] ? next : current
  }, 'idle')
}

export function WorkWhiteboardSidebarSection({
  whiteboards,
  activeWhiteboardId,
  expanded,
  openMenuId,
  label,
  createLabel,
  moreActionsLabel,
  renameLabel,
  deleteLabel,
  runningLabel = 'Running',
  failedLabel = 'Failed',
  unreadLabel = 'Unread',
  awaitingInputLabel = 'Awaiting input',
  activityForBoard = () => 'idle',
  onToggle,
  onCreate,
  onOpen,
  onToggleMenu,
  onRename,
  onDelete
}: Props): ReactElement {
  return (
    <div className="mb-1" data-work-whiteboard-folder="true">
      <SidebarTreeRow
        title={label}
        ariaLabel={label}
        onClick={onToggle}
        className="min-h-[34px]"
        buttonStyle={{ paddingLeft: 10 }}
        trailing={(
          <SidebarActivityIndicator
            activity={groupActivity(whiteboards, activityForBoard)}
            runningLabel={runningLabel}
            failedLabel={failedLabel}
            unreadLabel={unreadLabel}
            awaitingInputLabel={awaitingInputLabel}
          />
        )}
        actions={(
          <SidebarIconButton
            title={createLabel}
            ariaLabel={createLabel}
            onClick={onCreate}
            tone="accent"
            stopPropagation
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </SidebarIconButton>
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
        <Shapes className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </SidebarTreeRow>

      {expanded ? (
        <div className="mt-0.5">
          {[...whiteboards]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map((board) => {
              const Icon = workWhiteboardResolvedEngine(board) === 'excalidraw' ? PencilLine : Shapes
              const activity = activityForBoard(board)
              return (
              <div key={board.id} className="relative" data-work-whiteboard-item={board.id}>
                <SidebarTreeRow
                  active={activeWhiteboardId === board.id}
                  title={board.title}
                  onClick={() => onOpen(board.id)}
                  className="min-h-[34px]"
                  buttonStyle={{ paddingLeft: 24 }}
                  trailing={activity === 'idle' ? phaseIndicator(board.phase) : (
                    <SidebarActivityIndicator
                      activity={activity}
                      runningLabel={runningLabel}
                      failedLabel={failedLabel}
                      unreadLabel={unreadLabel}
                      awaitingInputLabel={awaitingInputLabel}
                    />
                  )}
                  actions={(
                    <SidebarIconButton
                      title={moreActionsLabel}
                      ariaLabel={moreActionsLabel}
                      onClick={() => onToggleMenu(board.id)}
                      stopPropagation
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </SidebarIconButton>
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{board.title}</span>
                </SidebarTreeRow>
                {openMenuId === board.id ? (
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-xl">
                    <button
                      type="button"
                      className="write-tabbar-menu-item"
                      onClick={() => onRename(board)}
                    >
                      <PencilLine className="h-3.5 w-3.5" />{renameLabel}
                    </button>
                    <button
                      type="button"
                      className="write-tabbar-menu-item text-red-600 dark:text-red-300"
                      onClick={() => onDelete(board)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />{deleteLabel}
                    </button>
                  </div>
                ) : null}
              </div>
              )
            })}
        </div>
      ) : null}
    </div>
  )
}
