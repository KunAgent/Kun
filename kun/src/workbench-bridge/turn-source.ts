import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import type { WorkbenchBridge } from './bridge.js'

const im = { clientSurface: 'im', imContext: true } as const
const gui = { clientSurface: 'gui' as const }

/** A task handoff never turns an IM request into GUI authority. */
export async function workbenchTurnSource(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<
  { clientSurface: 'gui' } | { clientSurface: 'im'; imContext: true }
> {
  if (link.origin.kind === 'series') {
    const parent = await bridge.store.get<WorkbenchLink>('workbench_link', link.origin.seriesId)
    if (!parent || parent.value.origin.kind === 'series') throw new Error('The scheduled task source is unavailable')
    return workbenchTurnSource(bridge, parent.value)
  }
  if (link.origin.kind === 'user') return gui
  const origin = link.origin
  // confirmedAt is also set for auto-queued links; it is never proof of GUI authorization.
  if (origin.clientSurface) return origin.clientSurface === 'im' ? im : gui
  const run = await bridge.store.get<RoomRunRecord>('room_run', origin.runId)
  const source = run?.value.threadId ? await bridge.deps.threadStore.getMetadata?.(run.value.threadId)
    ?? await bridge.deps.threadStore.get(run.value.threadId) : null
  const turn = source?.turns.find((entry) => entry.id === origin.turnId)
  // Legacy records can recover their accepted source. Missing provenance cannot widen access.
  if (!turn) return im
  return turn.clientSurface === 'im' || turn.imContext === true ? im : gui
}
