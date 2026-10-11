import type { AppSettingsV1 } from '../shared/app-settings'
import { normalizeAppSettings } from '../shared/app-settings'
import {
  AdeProjectDefaultsMutationSchema,
  AdeProjectDefaultsQuerySchema,
  mutateAdeProjectDefaults,
  type AdeProjectDefaults,
  type AdeProjectDefaultsMutation,
  type AdeProjectDefaultsMutationResult,
  type AdeProjectDefaultsQuery,
  type AdeProjectDefaultsSnapshot,
  type AdeProjectIdentity
} from '../shared/ade-project-defaults'
import { canonicalAdeProjectIdentity } from './ade-project-identity'
import { adeProjectDefaultsRevision } from '../../kun/src/shared/project-identity.js'

type Store = {
  load: () => Promise<AppSettingsV1>
  update: (mutation: (current: AppSettingsV1) => AppSettingsV1) => Promise<AppSettingsV1>
}

function snapshot(settings: AppSettingsV1, project: AdeProjectIdentity): AdeProjectDefaultsSnapshot {
  const value = settings.agents.kun.ade.projectDefaults[project.key] ?? {}
  const revision = adeProjectDefaultsRevision(project.key, value)
  return { project, value, revision }
}

/** CAS one canonical project's local defaults within the existing SettingsStore. */
export function createAdeProjectDefaultsService(options: {
  store: Store
  serializePersistence: <T>(operation: () => Promise<T>) => Promise<T>
  onCommitted: (previous: AppSettingsV1, saved: AppSettingsV1) => number
  resolveProject?: (path: string) => Promise<AdeProjectIdentity>
}): {
  get: (request: AdeProjectDefaultsQuery) => Promise<AdeProjectDefaultsSnapshot>
  save: (request: AdeProjectDefaultsMutation) => Promise<AdeProjectDefaultsMutationResult>
} {
  const { store, serializePersistence, onCommitted } = options
  const resolveProject = options.resolveProject ?? canonicalAdeProjectIdentity
  return {
    get: async (raw) => {
      const request = AdeProjectDefaultsQuerySchema.parse(raw)
      const project = await resolveProject(request.projectPath)
      return snapshot(await store.load(), project)
    },
    save: async (raw) => {
      const request = AdeProjectDefaultsMutationSchema.parse(raw)
      const project = await resolveProject(request.projectPath)
      return serializePersistence(async () => {
        let previous: AppSettingsV1 | undefined
        let conflict: AdeProjectDefaultsSnapshot | undefined
        const saved = await store.update((current) => {
          const observed = snapshot(current, project)
          if (observed.revision !== request.expectedRevision) {
            conflict = observed
            return current
          }
          conflict = undefined
          const value: AdeProjectDefaults = mutateAdeProjectDefaults(observed.value, request)
          const projectDefaults = { ...current.agents.kun.ade.projectDefaults }
          if (Object.keys(value).length > 0) projectDefaults[project.key] = value
          else delete projectDefaults[project.key]
          previous = current
          return normalizeAppSettings({
            ...current,
            agents: {
              ...current.agents,
              kun: {
                ...current.agents.kun,
                ade: { ...current.agents.kun.ade, projectDefaults }
              }
            }
          })
        })
        if (conflict) return { ok: false, kind: 'conflict', ...conflict }
        if (!previous) throw new Error('Project defaults persistence had no source snapshot.')
        return { ok: true, ...snapshot(saved, project), generation: onCommitted(previous, saved) }
      })
    }
  }
}
