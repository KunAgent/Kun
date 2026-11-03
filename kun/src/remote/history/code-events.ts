import { isPublicRuntimeEvent, type RuntimeEvent } from '../../contracts/events.js'
import { type TurnItem } from '../../contracts/items.js'
import { timelineSafeItem } from '../../services/item-history-page.js'
import { relayHistoryPage } from '../code/history/relay-page.js'

export type CodePage = Record<string, any> & { id: string; turns: { id: string; items: TurnItem[]; [key: string]: any }[] }
export function boundCodePage(page: CodePage): CodePage {
  if (!Array.isArray(page.turns) || page.turns.some(turn => turn.items.some(item => item.sourceHistoryOrder)))
    throw new Error('UNSUPPORTED_HISTORY_SOURCE')
  return relayHistoryPage(page).relayed
}

/** A metadata refresh must not replace newer live items with an older disk checkpoint. */
export function reconcileCodePage(previous: CodePage, refreshed: CodePage, versions: ReadonlyMap<string, number>): CodePage {
  if (previous.historyVersion !== refreshed.historyVersion) return refreshed
  const turns = refreshed.turns.map(turn => ({ ...turn, items: [...turn.items] }))
  for (const oldTurn of previous.turns) {
    for (let index = 0; index < oldTurn.items.length; index++) {
      const old = oldTurn.items[index]!
      if ((versions.get(old.id) ?? -1) <= refreshed.latestSeq) continue
      const turn = turns.find(value => value.id === oldTurn.id)
      if (!turn) throw new Error('HISTORY_SOURCE_GAP')
      const position = turn.items.findIndex(value => value.id === old.id)
      if (position >= 0) {
        const fresh = turn.items[position]!
        if (fresh.kind !== old.kind) throw new Error('HISTORY_SOURCE_GAP')
        turn.items[position] = { ...old, status: fresh.status, finishedAt: fresh.finishedAt ?? old.finishedAt } as TurnItem
      } else {
        const following = new Set(oldTurn.items.slice(index + 1).map(value => value.id))
        const before = turn.items.findIndex(value => following.has(value.id))
        turn.items.splice(before < 0 ? turn.items.length : before, 0, old)
      }
    }
  }
  return boundCodePage({ ...refreshed, turns })
}

/** Returns null for events whose metadata/gate projections require a semantic refresh. */
export function projectCodeEvent(page: CodePage, event: RuntimeEvent): CodePage | null {
  if (!isPublicRuntimeEvent(event)) return page
  if (!('item' in event)) {
    return event.kind === 'heartbeat' ? page : null
  }
  const item = event.item
  const turn = page.turns.find(value => value.id === item.turnId)
  const previous = turn?.items.find(value => value.id === item.id) as (TurnItem & { truncated?: boolean }) | undefined
  if (!turn || !previous && event.kind !== 'item_created') return null
  let next: TurnItem = item
  if (event.kind === 'assistant_text_delta' || event.kind === 'assistant_reasoning_delta') {
    const oldText = previous && 'text' in previous ? previous.text : ''
    const fragment = 'text' in item ? item.text : ''
    if (previous?.truncated) next = previous
    else {
      if (event.deltaOffset === undefined) throw new Error('UNSUPPORTED_DELTA_OFFSET')
      const offset = event.deltaOffset
      if (offset > oldText.length) throw new Error('HISTORY_SOURCE_GAP')
      const overlap = Math.min(oldText.length - offset, fragment.length)
      if (oldText.slice(offset, offset + overlap) !== fragment.slice(0, overlap)) throw new Error('HISTORY_SOURCE_GAP')
      next = { ...item, text: oldText.slice(0, offset) + fragment + oldText.slice(offset + overlap) } as TurnItem
    }
  }
  const bounded = timelineSafeItem(next, 16 * 1024)
  next = bounded === next ? next : { ...bounded, truncated: true } as unknown as TurnItem
  const turns = page.turns.map(value => value.id !== item.turnId ? value : {
    ...value, items: previous ? value.items.map(old => old.id === item.id ? next : old) : [...value.items, next]
  })
  if (!turn) turns.push({ id: item.turnId, status: 'running', items: [next] })
  return boundCodePage({ ...page, latestSeq: Math.max(page.latestSeq ?? 0, event.seq), turns })
}
