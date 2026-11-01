import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Columns2, Copy, FolderOpen, X } from 'lucide-react'
import { KunContextMenu, type KunContextMenuEntry, type KunContextMenuPoint } from '../context-menu/KunContextMenu'

export type WorkTabMenuAction =
  | 'close' | 'closeOthers' | 'closeRight' | 'closeAll'
  | 'moveLeft' | 'moveRight' | 'openBeside'
  | 'copyPath' | 'reveal' | 'copyTitle'

/** What the right-clicked tab allows; a missing count or flag disables that row. */
export type WorkTabMenuState = {
  kind: 'session' | 'document'
  /** False for the draft session, which the strip always keeps. */
  canClose: boolean
  othersCount: number
  rightCount: number
  allCount: number
  canMoveLeft: boolean
  canMoveRight: boolean
  canOpenBeside: boolean
  /** Workspace-relative file path; whiteboards and paper views have none. */
  path: string | null
}

const ICON = { strokeWidth: 1.9, 'aria-hidden': true } as const

/** Right-click menu of one Work strip tab. */
export function WorkTabContextMenu({ point, state, onAction, onDismiss }: {
  point: KunContextMenuPoint
  state: WorkTabMenuState
  onAction: (action: WorkTabMenuAction) => void
  onDismiss: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const item = (id: WorkTabMenuAction, label: string, extra: Partial<Exclude<KunContextMenuEntry, 'separator'>> = {}): KunContextMenuEntry =>
    ({ id, label, onSelect: () => onAction(id), ...extra })
  const entries: KunContextMenuEntry[] = [
    item('close', t('workTabMenuClose'), { icon: <X {...ICON} />, disabled: !state.canClose }),
    item('closeOthers', t('workTabMenuCloseOthers'), { count: state.othersCount, disabled: !state.othersCount }),
    item('closeRight', t('workTabMenuCloseRight'), { count: state.rightCount, disabled: !state.rightCount }),
    item('closeAll', t('workTabMenuCloseAll'), { count: state.allCount, disabled: !state.allCount }),
    'separator',
    item('moveLeft', t('workTabMenuMoveLeft'), { icon: <ChevronLeft {...ICON} />, disabled: !state.canMoveLeft }),
    item('moveRight', t('workTabMenuMoveRight'), { icon: <ChevronRight {...ICON} />, disabled: !state.canMoveRight }),
    ...(state.kind === 'document'
      ? [item('openBeside', t('workTabMenuOpenBeside'), { icon: <Columns2 {...ICON} />, disabled: !state.canOpenBeside })]
      : []),
    'separator',
    ...(state.path
      ? [
          item('copyPath', t('workTabMenuCopyPath'), { icon: <Copy {...ICON} /> }),
          item('reveal', t('workTabMenuReveal'), { icon: <FolderOpen {...ICON} /> })
        ]
      : [item('copyTitle', t('workTabMenuCopyTitle'), { icon: <Copy {...ICON} /> })])
  ]
  return <KunContextMenu point={point} label={t('workTabMenuLabel')} entries={entries} onDismiss={onDismiss} width={236} />
}
