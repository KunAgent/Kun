import type { CoreTurnItemJson } from '../../agent/kun-contract'

export type RoomRunEntry = { kind: 'item'; item: CoreTurnItemJson } | {
  kind: 'tool'; callId: string; call?: CoreTurnItemJson; result?: CoreTurnItemJson
}
export function groupRoomRunItems(items: CoreTurnItemJson[]): RoomRunEntry[] {
  const entries: RoomRunEntry[] = [], tools = new Map<string, Extract<RoomRunEntry, { kind: 'tool' }>>()
  for (const item of items) {
    if ((item.kind === 'tool_call' || item.kind === 'tool_result') && item.callId) {
      let entry = tools.get(item.callId)
      if (!entry) { entry = { kind: 'tool', callId: item.callId }; tools.set(item.callId, entry); entries.push(entry) }
      if (item.kind === 'tool_call') entry.call = item
      else entry.result = item
    } else entries.push({ kind: 'item', item })
  }
  return entries
}
export function roomToolArgumentSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const args = value as Record<string, unknown>
  return ['command', 'cmd', 'path', 'file_path', 'query', 'pattern', 'url', 'title']
    .filter((key) => typeof args[key] === 'string').slice(0, 2)
    .map((key) => String(args[key]).replace(/\s+/g, ' ').slice(0, 160)).join(' · ')
}
export function roomRunEntryMatches(entry: RoomRunEntry, filter: string, query: string): boolean {
  if (filter === 'tools' && entry.kind !== 'tool') return false
  const items = entry.kind === 'item' ? [entry.item] : [entry.call, entry.result].filter((item): item is CoreTurnItemJson => Boolean(item))
  if (filter === 'errors' && !items.some((item) => item.kind === 'error' || item.isError || item.status === 'failed' ||
    (['approval', 'user_input'].includes(item.kind) && item.status === 'pending'))) return false
  if (!query.trim()) return true
  const needle = query.trim().toLocaleLowerCase()
  return items.some((item) => JSON.stringify(item).toLocaleLowerCase().includes(needle))
}
