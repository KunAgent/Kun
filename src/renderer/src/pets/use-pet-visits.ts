import { useEffect, useRef, useState } from 'react'
import type { PetActivitySnapshot, PetOverlayBootstrap, PetOverlayBridge } from '@shared/pets'
import type { PetPresenceSnapshot } from '@shared/pets-interactions'
import { defaultPetVisits, PET_VISIT_REQUEST_TTL_MS, type PetVisit, type PetVisitRequest } from '@shared/pets-visits'
import { petForModel } from './pet-reactions'
import { PetVisitDirector, type PetVisitContext } from './pet-visit-director'

export function usePetVisits(input: {
  bridge: Pick<PetOverlayBridge, 'onVisitRequested' | 'acknowledgeVisitRequest'>; bootstrap: PetOverlayBootstrap | null; presence: PetPresenceSnapshot
  work: PetActivitySnapshot | null; blocked: boolean
}) {
  const [visit, setVisit] = useState<PetVisit | null>(null)
  const director = useRef<PetVisitDirector | null>(null)
  if (!director.current) director.current = new PetVisitDirector()
  const pendingRequest = useRef<PetVisitRequest | null>(null)
  const seenRequests = useRef(new Set<string>())
  const latest = useRef(input)
  latest.current = input
  const context = (): PetVisitContext => {
    const value = latest.current, now = Date.now()
    const pets = value.bootstrap?.ensemblePets ?? []
    const work = value.work?.items ?? []
    return {
      primaryId: value.bootstrap?.petId ?? null, pets,
      preferences: value.bootstrap?.visits ?? defaultPetVisits(),
      visible: !document.hidden && Boolean(value.bootstrap?.spritesheetUrl && value.bootstrap.isOpen),
      reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      blocked: value.blocked,
      working: work.some((item) => item.status === 'running' || item.status === 'waiting' ||
        (item.status === 'failed' && now - item.updatedAtMs < 15_000)),
      inputActive: Boolean(value.presence.input && value.presence.input.expiresAt > now),
      modelPetId: petForModel(value.presence.model, pets)?.id ?? null,
      modelChangedAt: value.presence.modelChangedAt,
      completedKeys: work.filter((item) => item.status === 'review' && now - item.updatedAtMs < 20_000).map((item) => item.key)
    }
  }
  const contextRef = useRef(context)
  contextRef.current = context
  const deliver = (value: PetVisitRequest): void => {
    if (seenRequests.current.has(value.id)) return
    pendingRequest.current = value
    const current = contextRef.current(), now = Date.now()
    if (value.kind === 'invite' && (!current.visible || (value.primaryId && value.primaryId !== current.primaryId)) &&
      now - value.createdAt < PET_VISIT_REQUEST_TTL_MS) return
    pendingRequest.current = null
    seenRequests.current.add(value.id)
    if (seenRequests.current.size > 64) seenRequests.current.delete(seenRequests.current.values().next().value!)
    director.current!.update(current, now)
    setVisit(director.current!.request(value, current, now))
    input.bridge.acknowledgeVisitRequest?.(value.id)
  }
  const deliverRef = useRef(deliver)
  deliverRef.current = deliver
  useEffect(() => {
    const update = (): void => {
      setVisit(director.current!.update(contextRef.current(), Date.now()))
      if (pendingRequest.current) deliverRef.current(pendingRequest.current)
    }
    const stop = input.bridge.onVisitRequested?.((value) => deliverRef.current(value))
    const timer = setInterval(update, 250)
    document.addEventListener('visibilitychange', update)
    update()
    return () => { clearInterval(timer); stop?.(); document.removeEventListener('visibilitychange', update) }
  }, [input.bridge])
  useEffect(() => {
    setVisit(director.current!.update(contextRef.current(), Date.now()))
    const request = input.bootstrap?.visitRequest
    if (request) deliverRef.current(request)
  }, [input.bootstrap, input.presence, input.work, input.blocked])
  return visit
}
