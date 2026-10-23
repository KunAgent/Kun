import type { ReactElement } from 'react'
import { UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActivityRow } from '@shared/activity-row'
import { selectWorkerRowsForParent } from '../../../store/activity-selectors'
import { useActivityStore } from '../../../store/activity-store'
import { useChatStore } from '../../../store/chat-store'
import { TrayAvatar } from './tray-primitives'
import { buildWorkersTrayRows, workerAvatarColor, workerAvatarGlyph } from './workers-tray-model'

/*
 * Owner label at the end of a todo row: avatar + worker / thread name, with
 * the raw thread id (and a neutral person avatar) as the fallback. A worker
 * owner keeps the glyph and color its Workers segment and sheet use. The
 * label gives up its width before the step text does: the name truncates
 * down to the avatar alone (the tooltip keeps the full name).
 */

function findOwnerRow(rows: Record<string, ActivityRow>, ownerThreadId: string): ActivityRow | null {
  for (const row of Object.values(rows)) {
    if (row.threadId === ownerThreadId) return row
  }
  return null
}

/**
 * The avatar color the Workers segment and sheet paint for this owner, read
 * from the Workers row model itself with the owner's team, so both trays
 * follow one color rule (team-wide assignment included). Owners the Workers
 * tray does not list keep their own hue.
 */
function todoOwnerAvatarColor(rows: Record<string, ActivityRow>, row: ActivityRow | null, ownerThreadId: string): string {
  if (row?.kind === 'worker' && row.parentThreadId) {
    const team = selectWorkerRowsForParent(rows, row.parentThreadId)
    // Colors never depend on the clock; a fixed one keeps this store selector pure.
    const member = buildWorkersTrayRows(team, { now: 0, feedError: false }).find((entry) => entry.id === row.unitId)
    if (member) return member.color
  }
  return workerAvatarColor(row?.unitId || ownerThreadId)
}

export function TodoOwnerLabel({
  ownerThreadId,
  compact,
  className
}: {
  ownerThreadId: string
  compact: boolean
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  // The store's own row object, so the selection stays referentially stable.
  const workerRow = useActivityStore((state) => findOwnerRow(state.rows, ownerThreadId))
  const color = useActivityStore((state) =>
    todoOwnerAvatarColor(state.rows, findOwnerRow(state.rows, ownerThreadId), ownerThreadId))
  const threadTitle = useChatStore((state) => state.threads.find((thread) => thread.id === ownerThreadId)?.title ?? null)
  const name = (workerRow?.title ?? threadTitle ?? '').trim()
  const text = name || ownerThreadId
  const label = t('composerTrayTodo.ownerTitle', { name: text })
  return (
    <span
      // An explicit minimum (the avatar), so the name can shrink to nothing.
      className={`inline-flex min-w-[18px] shrink-[1000] items-center gap-1.5 self-center overflow-hidden text-[12px] font-normal text-ds-faint ${className ?? ''}`.trim()}
      title={label}
      data-todo-owner={ownerThreadId}
    >
      {name ? (
        <TrayAvatar label={workerAvatarGlyph(name, workerRow?.harnessId)} color={color} />
      ) : (
        <TrayAvatar icon={<UserRound className="h-3 w-3" strokeWidth={2.2} />} />
      )}
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="sr-only">{t('executionTaskOwner')}: </span>
          <span className="min-w-0 max-w-[120px] truncate">{text}</span>
        </>
      )}
    </span>
  )
}
