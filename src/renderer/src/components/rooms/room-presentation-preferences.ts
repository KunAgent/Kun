import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

type RoomPresentationPreferences = {
  listWidth: number
  detailWidth: number
  layout: 'thread' | 'bubble'
  autoLinkPreviews: boolean
}
const KEY = 'kun.rooms.presentation.v1'
const clamp = (value: unknown, initial: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : initial
function normalize(value: Partial<RoomPresentationPreferences>): RoomPresentationPreferences {
  return { listWidth: clamp(value.listWidth, 320, 240, 520), detailWidth: clamp(value.detailWidth, 400, 360, 640),
    layout: value.layout === 'bubble' ? 'bubble' : 'thread', autoLinkPreviews: value.autoLinkPreviews !== false }
}
function initial(): RoomPresentationPreferences {
  try { return normalize(JSON.parse(readBrowserStorageItem(KEY) ?? '{}') ?? {}) } catch { return normalize({}) }
}
export const useRoomPresentationPreferences = create<RoomPresentationPreferences & {
  setPreference: (patch: Partial<RoomPresentationPreferences>) => void
}>((set, get) => ({ ...initial(), setPreference(patch) {
  const next = normalize({ ...get(), ...patch })
  writeBrowserStorageItem(KEY, JSON.stringify(next))
  set(next)
} }))
