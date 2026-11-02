import type { ActivityRow } from '@shared/activity-row'
import {
  PET_NOTIFICATION_TTL_MS,
  type PetActivityItem,
  type PetActivitySnapshot,
  type PetSessionStatus
} from '@shared/pets'

export type PetThreadSupplement = {
  threadId: string
  title: string
  status?: string
  latestTurnId?: string
  latestTurnStatus?: string
  updatedAt?: string
  archived?: boolean
  roomId?: string
}

const STATUS_PRIORITY: PetActivityItem['status'][] = ['waiting', 'failed', 'review', 'running']

export function projectPetActivity(input: {
  generation: number
  profileKey: string
  rows: readonly ActivityRow[]
  supplements: readonly PetThreadSupplement[]
  nowMs: number
  bubbleAllowed?: (item: { threadId: string; status: PetActivityItem['status']; stalled: boolean }) => boolean
}): PetActivitySnapshot {
  const covered = new Set<string>()
  const items: PetActivityItem[] = []
  for (const row of input.rows) {
    const projected = projectRow(row, input)
    if (!projected) continue
    covered.add(row.threadId)
    items.push(projected)
  }
  for (const supplement of input.supplements) {
    if (covered.has(supplement.threadId) || supplement.archived) continue
    const projected = projectSupplement(supplement, input)
    if (projected) items.push(projected)
  }
  return {
    generation: input.generation,
    profileKey: input.profileKey,
    items: dedupeItems(items),
    emittedAtMs: input.nowMs
  }
}

export function semanticSnapshotKey(snapshot: PetActivitySnapshot): string {
  return JSON.stringify([snapshot.profileKey, snapshot.generation, snapshot.items.map((item) => [
    item.unitId, item.threadId, item.turnId, item.status, item.stateSince, item.stalled, item.bubbleAllowed,
    item.title, item.subtitle, item.ownerThreadId, item.roomId, item.navigable
  ])])
}

export function petNotificationExpiresAtMs(item: PetActivityItem): number {
  return transitionMs(item) + PET_NOTIFICATION_TTL_MS[item.status]
}

export function earliestPetNotificationExpiry(items: readonly PetActivityItem[]): number | null {
  let earliest: number | null = null
  for (const item of items) {
    const expires = petNotificationExpiresAtMs(item)
    if (earliest === null || expires < earliest) earliest = expires
  }
  return earliest
}

export function visiblePetNotifications(snapshot: PetActivitySnapshot, dismissed: ReadonlySet<string>, nowMs: number): PetActivityItem[] {
  return snapshot.items
    .filter((item) => item.bubbleAllowed && !dismissed.has(item.key) && nowMs <= petNotificationExpiresAtMs(item))
    .sort((a, b) => {
      const priority = STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
      if (priority) return priority
      return transitionMs(b) - transitionMs(a)
    })
}

export function acceptPetSnapshot(current: PetActivitySnapshot | null, next: PetActivitySnapshot): PetActivitySnapshot | null {
  if (current && next.generation < current.generation) return current
  return next
}

export function highestPetStatus(items: readonly PetActivityItem[]): PetSessionStatus {
  for (const status of STATUS_PRIORITY) {
    if (items.some((item) => item.status === status)) return status
  }
  return 'idle'
}

function projectRow(row: ActivityRow, input: Parameters<typeof projectPetActivity>[0]): PetActivityItem | null {
  if (row.metadataPending || row.restoredUnconfirmed || row.visibility !== 'active') return null
  if (row.state === 'idle' || row.state === 'closed') return null
  if (row.state === 'done' && row.lastOutcome === 'cancelled') return null
  const mapped = mapRowStatus(row)
  if (!mapped) return null
  return finishItem({
    generation: input.generation,
    profileKey: input.profileKey,
    status: mapped.status,
    threadId: row.threadId,
    unitId: row.unitId,
    ownerThreadId: row.parentThreadId,
    roomId: row.roomId,
    turnId: row.turnId ?? null,
    stateSince: row.stateSince,
    title: row.title || 'Task',
    subtitle: mapped.subtitle ?? row.progressNote ?? row.lastMessagePreview,
    stalled: mapped.stalled,
    updatedAtMs: Date.parse(row.updatedAt) || input.nowMs
  }, input.bubbleAllowed)
}

function projectSupplement(thread: PetThreadSupplement, input: Parameters<typeof projectPetActivity>[0]): PetActivityItem | null {
  const status = mapSupplementStatus(thread)
  if (!status) return null
  const stateSince = thread.updatedAt || new Date(input.nowMs).toISOString()
  return finishItem({
    generation: input.generation,
    profileKey: input.profileKey,
    status,
    threadId: thread.threadId,
    unitId: thread.threadId,
    roomId: thread.roomId,
    turnId: thread.latestTurnId ?? null,
    stateSince,
    title: thread.title || 'Chat',
    stalled: false,
    updatedAtMs: Date.parse(thread.updatedAt ?? '') || input.nowMs
  }, input.bubbleAllowed)
}

function finishItem(
  item: Omit<PetActivityItem, 'key' | 'navigable' | 'bubbleAllowed'> & { profileKey: string },
  bubbleAllowed?: (item: { threadId: string; status: PetActivityItem['status']; stalled: boolean }) => boolean
): PetActivityItem {
  const { profileKey, ...rest } = item
  const key = `${profileKey}:${item.unitId}:${item.turnId ?? ''}:${item.stateSince}:${item.status}`
  return {
    ...rest,
    key,
    navigable: true,
    bubbleAllowed: bubbleAllowed ? bubbleAllowed(item) : true
  }
}

function mapRowStatus(row: ActivityRow): { status: PetActivityItem['status']; stalled: boolean; subtitle?: string } | null {
  if (row.stalled) return { status: 'failed', stalled: true, subtitle: 'Stalled' }
  if (row.state === 'initializing' || row.state === 'working') return { status: 'running', stalled: false }
  if (row.state === 'waiting') return { status: 'waiting', stalled: false }
  if (row.state === 'failed') return { status: 'failed', stalled: false }
  if (row.state === 'done') return { status: 'review', stalled: false }
  return null
}

function mapSupplementStatus(thread: PetThreadSupplement): PetActivityItem['status'] | null {
  const status = `${thread.latestTurnStatus ?? ''} ${thread.status ?? ''}`.toLowerCase()
  if (/(waiting|question|approval|input)/.test(status)) return 'waiting'
  if (/(fail|error)/.test(status)) return 'failed'
  if (/(cancel|archived|idle|closed)/.test(status)) return null
  if (/(done|complete|finish|review)/.test(status)) return 'review'
  if (/(run|working|streaming|pending)/.test(status)) return 'running'
  return null
}

function dedupeItems(items: PetActivityItem[]): PetActivityItem[] {
  const byIdentity = new Map<string, PetActivityItem>()
  for (const item of items) {
    const identity = `${item.threadId}:${item.turnId ?? ''}:${item.status}:${item.stateSince}`
    const current = byIdentity.get(identity)
    if (!current || (item.ownerThreadId && !current.ownerThreadId)) byIdentity.set(identity, item)
  }
  return [...byIdentity.values()]
}

function transitionMs(item: PetActivityItem): number {
  const parsed = Date.parse(item.stateSince)
  return Number.isFinite(parsed) ? parsed : item.updatedAtMs
}
