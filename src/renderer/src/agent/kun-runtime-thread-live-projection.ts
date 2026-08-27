import type { CoreTurnItemJson } from './kun-contract-runtime'
import type { ThreadLiveProjection } from './provider-types'

export function restoredThreadLiveProjection(
  items: CoreTurnItemJson[],
  latestTurnId: string | undefined,
  latestTurnStatus: string | undefined
): { liveProjection?: ThreadLiveProjection; liveItemIds: Set<string> } {
  const liveItemIds = new Set<string>()
  if (!latestTurnId || latestTurnStatus !== 'running') return { liveItemIds }

  const projection: ThreadLiveProjection = {}
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (
      item.turnId !== latestTurnId ||
      item.status !== 'running' ||
      !item.text
    ) continue
    const target = item.kind === 'assistant_text'
      ? 'assistant'
      : item.kind === 'assistant_reasoning'
        ? 'reasoning'
        : null
    if (!target || projection[target]) continue
    projection[target] = {
      text: item.text,
      itemId: item.id,
      turnId: item.turnId,
      ...(item.createdAt ? { createdAt: item.createdAt } : {})
    }
    liveItemIds.add(item.id)
  }

  return Object.keys(projection).length > 0
    ? { liveProjection: projection, liveItemIds }
    : { liveItemIds }
}
