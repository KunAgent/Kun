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
