import { create } from 'zustand'
import { CODE_PANEL_PREFERRED } from '../workbench-layout-storage'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

type RoomPresentationPreferences = {
  listWidth: number
  detailWidth: number
  workbenchWidth: number
  layout: 'bubble'
  autoLinkPreviews: boolean
  /** The conversation info board stays open while moving between conversations. */
  infoBoard: boolean
}
const KEY = 'kun.rooms.presentation.v1'
const clamp = (value: unknown, initial: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : initial
function normalize(value: Partial<RoomPresentationPreferences>): RoomPresentationPreferences {
  return { listWidth: clamp(value.listWidth, 300, 240, 520), detailWidth: clamp(value.detailWidth, 400, 360, 640),
    workbenchWidth: clamp(value.workbenchWidth, CODE_PANEL_PREFERRED, 280, Number.POSITIVE_INFINITY),
    layout: 'bubble', autoLinkPreviews: value.autoLinkPreviews !== false, infoBoard: value.infoBoard === true }
}
function initial(): RoomPresentationPreferences {
  try {
    const value = JSON.parse(readBrowserStorageItem(KEY) ?? '{}') ?? {}
    const next = normalize(value)
    if (value.layout === 'thread') writeBrowserStorageItem(KEY, JSON.stringify(next))
    return next
  } catch { return normalize({}) }
}
export const useRoomPresentationPreferences = create<RoomPresentationPreferences & {
  setPreference: (patch: Partial<RoomPresentationPreferences>) => void
}>((set, get) => ({ ...initial(), setPreference(patch) {
  const next = normalize({ ...get(), ...patch })
  writeBrowserStorageItem(KEY, JSON.stringify(next))
  set(next)
} }))
