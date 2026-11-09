import type { PetDesktopBridge } from '@shared/pets'
import { useChatStore } from '../store/chat-store'
import { publishPetModel, startPetTypingPresence } from './pet-presence-client'

export function startPetPresencePublisher(pets: PetDesktopBridge): () => void {
  if (!pets.updatePetPresence || typeof document === 'undefined') return () => undefined
  let key: string | null = null
  let previousModel: string | null = null
  const publish = (announce = true): void => {
    const state = useChatStore.getState()
    const model = state.composerModel ?? ''
    const group = state.composerModelGroups?.find((candidate) => candidate.providerId === state.composerProviderId)
    const provider = group?.presetSource || group?.nativeHarnessId || state.composerProviderId || ''
    const next = `${model}:${provider}`
    if (next === key) return
    publishPetModel(model, provider, announce && key !== null && Boolean(previousModel) && previousModel !== model)
    key = next
    previousModel = model
  }
  const refresh = (): void => { key = null; publish(false) }
  const stopTyping = startPetTypingPresence(document)
  const stopChat = useChatStore.subscribe(() => publish())
  const stopCatalog = pets.onPetCatalogChanged(refresh)
  publish(false)
  return () => { stopTyping(); stopChat(); stopCatalog() }
}
