import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { getTaskSettings, saveTaskSettings } from '../../agent/kun-task-settings-client'

/** A confirmed Agent handoff and collaboration opt-in are one task mutation. */
export async function enableKunCollaboration(threadId: string, selection: {
  model: string
  providerId: string
}) {
  const snapshot = await getTaskSettings(threadId)
  const settings = getKunRuntimeSettings(await rendererRuntimeClient.getSettings())
  const model = selection.model.trim() || settings.model
  const providerId = selection.providerId.trim() || settings.providerId
  return saveTaskSettings(threadId, {
    expectedRevision: snapshot.revision,
    set: {
      route: { harnessId: 'kun', model, ...(providerId ? { providerId, credentialMode: 'provider' as const } : {}) },
      collaborationEnabled: true
    }
  })
}
