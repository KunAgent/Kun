import type { StorageCleanupPlan, StoragePlanItem, StoragePlanItemKind, StorageUsageCategoryId } from '@shared/storage-cleanup'

export { formatBytes } from '../lib/format-bytes'

export const STORAGE_CLEANUP_DAY_PRESETS = [7, 14, 30, 90, 180] as const

export const STORAGE_USAGE_COLORS: Record<StorageUsageCategoryId, string> = {
  worktrees: 'bg-blue-500',
  threads: 'bg-teal-600',
  agents: 'bg-violet-500',
  caches: 'bg-amber-500',
  attachments: 'bg-pink-500',
  other: 'bg-stone-400'
}

export const STORAGE_PLAN_KIND_ORDER: StoragePlanItemKind[] = ['threadSlim', 'emptyWorktree', 'trajectoryRecord']

/** Rows rendered per kind in the review dialog; the rest follow their kind's checkbox. */
export const STORAGE_REVIEW_ROWS_PER_KIND = 200

export function formatStorageDate(iso: string | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatStorageDay(iso: string | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function groupPlanItems(plan: StorageCleanupPlan): Array<{ kind: StoragePlanItemKind; items: StoragePlanItem[]; bytes: number }> {
  return STORAGE_PLAN_KIND_ORDER.map((kind) => {
    const items = plan.items.filter((item) => item.kind === kind)
    return { kind, items, bytes: items.reduce((sum, item) => sum + item.bytes, 0) }
  }).filter((group) => group.items.length > 0)
}

export function selectedBytes(plan: StorageCleanupPlan | null, selected: ReadonlySet<string>): number {
  if (!plan) return 0
  return plan.items.reduce((sum, item) => (selected.has(item.id) ? sum + item.bytes : sum), 0)
}

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes rejected invoke errors with the channel; keep the cause.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
