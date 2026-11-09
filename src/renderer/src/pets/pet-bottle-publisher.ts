import { hasKunAccountSession, type KunAccountState } from '@shared/kun-account'
import { PET_BOTTLE_BATCH_LIMIT, PET_BOTTLE_TTL_MS } from '@shared/pets-bottle'
import type { PetDesktopBridge } from '@shared/pets'
import { subscribeRoomEvents, type RoomEvent } from '../components/rooms/room-event-listeners'
import { refreshWardrobe, subscribeWardrobe, wardrobeSettings, wardrobeSnapshot } from '../components/rooms/room-wardrobe'
import { useFocusModeStore } from '../store/focus-mode-store'

/** Only live, confirmed drops animate. Reading a shelf never replays its inventory. */
export function startPetBottlePublisher(pets: Pick<PetDesktopBridge, 'notifyPetBottleDrop'>): () => void {
  if (!pets.notifyPetBottleDrop || typeof window === 'undefined') return () => undefined
  const account = window.kunGui?.kunAccount
  const seen = new Set<string>(), pending = new Map<string, number>(), displayed = new Set<string>()
  let stopped = false, reading = false, epoch = 0, accountEvents = 0
  let liveSince = Date.now(), identity: string | null | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  const send = (value: Parameters<PetDesktopBridge['notifyPetBottleDrop']>[0]): void => {
    try { pets.notifyPetBottleDrop(value) } catch { /* The optional animation must not affect wardrobe delivery. */ }
  }
  const clear = (): void => {
    epoch++; liveSince = Date.now(); clearTimeout(timer); clearTimeout(checkTimer); timer = undefined; checkTimer = undefined
    pending.clear(); displayed.clear(); send(null)
  }
  const canShow = (): boolean => {
    const state = wardrobeSnapshot(), settings = wardrobeSettings(state.wardrobe)
    return !useFocusModeStore.getState().enabled && state.loaded && state.modeKnown && !state.error &&
      state.mode !== 'guest' && Boolean(state.wardrobe) && settings.drops !== false && settings.notice !== 'quiet' &&
      (state.mode === 'local' || !account || Boolean(identity))
  }
  const schedule = (): void => {
    if (!timer && !stopped && pending.size) timer = setTimeout(() => { timer = undefined; void flush() }, 300)
  }
  const flush = async (): Promise<void> => {
    if (stopped || reading || !pending.size) return
    reading = true
    const generation = epoch, batch = new Map(pending)
    pending.clear()
    try {
      // Reuse the application's read-only wardrobe mirror, not its reward/open APIs.
      await refreshWardrobe()
      if (stopped || generation !== epoch || !canShow()) return
      const state = wardrobeSnapshot(), now = Date.now(), settings = wardrobeSettings(state.wardrobe)
      const confirmed = (state.wardrobe?.pending ?? []).filter((drop) => {
        const occurredAt = batch.get(drop.id), createdAt = Date.parse(drop.createdAt)
        return occurredAt !== undefined && now - occurredAt <= PET_BOTTLE_TTL_MS &&
          Number.isFinite(createdAt) && now - createdAt <= 60_000 && createdAt <= now + 1000 &&
          !drop.openedAt && !drop.stashedAt && !(drop.source === 'code' && settings.code === false)
      }).slice(0, PET_BOTTLE_BATCH_LIMIT)
      if (!confirmed.length) return
      displayed.clear()
      for (const drop of confirmed) displayed.add(drop.id)
      while (displayed.size > PET_BOTTLE_BATCH_LIMIT) displayed.delete(displayed.values().next().value!)
      send({ dropIds: confirmed.map((drop) => drop.id), occurredAt: Math.max(...confirmed.map((drop) => batch.get(drop.id)!)) })
    } catch { /* A missed visual cue never retries or changes the earned reward. */ }
    finally { reading = false; schedule() }
  }
  const receive = (event: RoomEvent): void => {
    if (stopped) return
    if (event.kind === 'wardrobe.updated' && displayed.size && !checkTimer) {
      checkTimer = setTimeout(() => { checkTimer = undefined; void refreshWardrobe().catch(() => undefined) }, 150)
    }
    if (event.kind !== 'wardrobe.dropped') return
    const id = event.payload?.dropId, at = Date.parse(event.createdAt ?? ''), now = Date.now()
    if (typeof id !== 'string' || !id || id.length > 128 || !Number.isFinite(at) || at < liveSince ||
      at > now + 1000 || now - at > PET_BOTTLE_TTL_MS || seen.has(id)) return
    seen.add(id)
    while (seen.size > 512) seen.delete(seen.values().next().value!)
    if (useFocusModeStore.getState().enabled || pending.size >= PET_BOTTLE_BATCH_LIMIT) return
    pending.set(id, at); schedule()
  }
  const checkPresentation = (): void => {
    if (stopped) return
    if (!canShow()) { if (pending.size || displayed.size) clear(); return }
    const waiting = new Set((wardrobeSnapshot().wardrobe?.pending ?? []).filter((drop) => !drop.openedAt && !drop.stashedAt).map((drop) => drop.id))
    if (displayed.size && ![...displayed].every((id) => waiting.has(id))) {
      displayed.clear(); send(null)
    }
  }
  const accountChanged = (state: KunAccountState): void => {
    if (stopped) return
    const next = hasKunAccountSession(state) ? state.user!.id : null
    if (next !== identity) { identity = next; clear() }
  }
  const offAccount = account?.onState?.((state) => { accountEvents++; accountChanged(state) })
  const initialAccountVersion = accountEvents
  void account?.getState?.().then((state) => {
    if (!stopped && accountEvents === initialAccountVersion) accountChanged(state)
  }).catch(() => undefined)
  const offEvents = subscribeRoomEvents(receive)
  const offWardrobe = subscribeWardrobe(checkPresentation)
  const offFocus = useFocusModeStore.subscribe((state) => { if (state.enabled) clear() })
  return () => {
    if (stopped) return
    stopped = true; epoch++; clearTimeout(timer); clearTimeout(checkTimer); pending.clear()
    offEvents(); offWardrobe(); offFocus(); offAccount?.()
    if (displayed.size) send(null)
    displayed.clear()
  }
}
