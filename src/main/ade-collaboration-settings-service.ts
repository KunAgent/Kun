import { createHash } from 'node:crypto'
import {
  getKunRuntimeSettings,
  type AppSettingsV1,
  type KunAdeSettingsV1
} from '../shared/app-settings'
import { defaultKunAdeSettings } from '../shared/app-settings-kun-harness'
import type {
  AdeCollaborationSettingsMutation,
  AdeCollaborationSettingsMutationResult,
  AdeCollaborationSettingsSnapshot,
  AdeCollaborationSettingsValue
} from '../shared/ade-collaboration-settings'
import { applySettingsPatchToSnapshot } from './settings-store-foundation'
import { validateRuntimeSettingsForApply } from './main-runtime-settings-validate'

function valueFromAde(ade: KunAdeSettingsV1): AdeCollaborationSettingsValue {
  return {
    enabled: ade.enabled,
    ...(ade.managerModel ? { managerModel: { ...ade.managerModel } } : {}),
    managerMayApprove: ade.managerMayApprove,
    allowUnattendedFullAccess: ade.allowUnattendedFullAccess,
    limits: { ...ade.limits },
    ...(ade.budget ? { budget: { ...ade.budget } } : {}),
    hibernation: { ...ade.hibernation },
    stall: { ...ade.stall }
  }
}

export function adeCollaborationSnapshot(settings: AppSettingsV1): AdeCollaborationSettingsSnapshot {
  const value = valueFromAde(getKunRuntimeSettings(settings).ade ?? defaultKunAdeSettings())
  // Projection fixes key order and excludes notifications/internal routing.
  const revision = `ade-collaboration-v1:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
  return { value, revision }
}

type Store = {
  load: () => Promise<AppSettingsV1>
  update: (mutation: (current: AppSettingsV1) => AppSettingsV1) => Promise<AppSettingsV1>
}

export function createAdeCollaborationSettingsService(options: {
  store: Store
  serializePersistence: <T>(operation: () => Promise<T>) => Promise<T>
  onCommitted: (previous: AppSettingsV1, saved: AppSettingsV1) => number
}): {
  get: () => Promise<AdeCollaborationSettingsSnapshot>
  save: (request: AdeCollaborationSettingsMutation) => Promise<AdeCollaborationSettingsMutationResult>
} {
  const { store, serializePersistence, onCommitted } = options
  return {
    get: async () => adeCollaborationSnapshot(await store.load()),
    save: (request) => serializePersistence(async () => {
      let previous: AppSettingsV1 | undefined
      let conflict: AdeCollaborationSettingsSnapshot | undefined
      const saved = await store.update((current) => {
        const snapshot = adeCollaborationSnapshot(current)
        if (snapshot.revision !== request.expectedRevision) {
          conflict = snapshot
          return current
        }
        conflict = undefined
        const managerModel = request.value.managerModel
        if (managerModel && !current.provider.providers.some((provider) => provider.id === managerModel.providerId) &&
          managerModel.providerId !== snapshot.value.managerModel?.providerId) {
          throw new Error('The selected manager model source is no longer configured.')
        }
        const next = applySettingsPatchToSnapshot(current, {
          agents: { kun: { ade: {
            enabled: request.value.enabled,
            managerModel: managerModel ?? { providerId: '', model: '' },
            managerMayApprove: request.value.managerMayApprove,
            allowUnattendedFullAccess: request.value.allowUnattendedFullAccess,
            limits: request.value.limits,
            budget: request.value.budget ?? null,
            hibernation: request.value.hibernation,
            stall: request.value.stall
          } } }
        })
        const validationError = validateRuntimeSettingsForApply(next)
        if (validationError) throw new Error(`Invalid runtime settings: ${validationError}`)
        previous = current
        return next
      })
      if (conflict) return { ok: false, kind: 'conflict', ...conflict }
      if (!previous) throw new Error('Collaboration settings persistence had no source snapshot.')
      const generation = onCommitted(previous, saved)
      return { ok: true, ...adeCollaborationSnapshot(saved), generation }
    })
  }
}
