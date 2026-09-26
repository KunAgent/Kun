import type { RoomRunItemsPage } from '@shared/rooms-api'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { roomPath, roomsRequest } from './rooms-client'

export const RUN_ITEM_TRUNCATION_MARKER = '[timeline truncated]'

/**
 * Mirrors the canonical content field that `buildItemContentPage` serves for
 * each item kind so a truncated preview can be patched back in place.
 */
export function truncatedContentField(item: CoreTurnItemJson): string | null {
  const record = item as CoreTurnItemJson & Record<string, unknown>
  const candidates =
    item.kind === 'tool_call'
      ? ['arguments']
      : item.kind === 'tool_result'
        ? ['output']
        : item.kind === 'error' && record.details !== undefined
          ? ['details']
          : ['text', 'reviewText', 'summary', 'prompt', 'message']
  for (const field of candidates) {
    const value = record[field]
    if (value === undefined || value === null) continue
    const source = typeof value === 'string' ? value : JSON.stringify(value)
    if (source.endsWith(RUN_ITEM_TRUNCATION_MARKER)) return field
  }
  return null
}

/** Pages the run content endpoint until the canonical field is fully loaded. */
export async function loadRunItemContent(
  roomId: string,
  runId: string,
  itemId: string,
  signal: AbortSignal
): Promise<{ field: string; text: string }> {
  let field = 'text'
  let text = ''
  let offset: number | undefined = 0
  while (offset !== undefined) {
    const result: RoomRunItemsPage = await roomsRequest<RoomRunItemsPage>(
      `${roomPath(roomId)}/runs/${encodeURIComponent(runId)}/items?item_id=${encodeURIComponent(itemId)}&content_offset=${offset}`,
      'GET',
      undefined,
      signal
    )
    if (signal.aborted) return { field, text }
    if (!result.content) throw new Error('run item content unavailable')
    field = result.content.field
    text += result.content.text
    offset = result.content.nextOffset
  }
  return { field, text }
}
