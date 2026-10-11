import type { AdeTaskSettingsMutation, AdeTaskSettingsResponse } from '@shared/ade-task-settings'
import { kunThreadExecutionConfigPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

async function request(threadId: string, mutation?: AdeTaskSettingsMutation): Promise<AdeTaskSettingsResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunThreadExecutionConfigPath(threadId), mutation ? 'PATCH' : 'GET',
    mutation ? JSON.stringify(mutation) : undefined
  )
  if (!response.ok) {
    const error = runtimeErrorToError(readRuntimeError(response.body, 'Task settings are unavailable.'))
    throw Object.assign(error, { status: response.status })
  }
  return readRuntimeJson<AdeTaskSettingsResponse>(response.body, 'Invalid task settings response.')
}

export const getTaskSettings = (threadId: string): Promise<AdeTaskSettingsResponse> => request(threadId)
export const saveTaskSettings = (threadId: string, mutation: AdeTaskSettingsMutation): Promise<AdeTaskSettingsResponse> =>
  request(threadId, mutation)
