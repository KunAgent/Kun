import { kunMemoryRecordPath } from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import type { CoreMemoryHistoryJson, CoreMemoryRecordJson } from './kun-contract'
import { rendererRuntimeClient } from './runtime-client'

export type MemoryLifecycleAction = {
  action: 'disable' | 'restore' | 'forget' | 'erase' | 'rollback'
  targetRevision?: number
  confirmation?: { memoryId: string; irreversible: true }
}
export async function applyMemoryLifecycle(record: CoreMemoryRecordJson, action: MemoryLifecycleAction): Promise<{
  memory?: CoreMemoryRecordJson; erased: boolean; affectedIds: string[]
}> {
  const query = new URLSearchParams()
  if (record.workspace) query.set('workspace', record.workspace)
  if (record.project) query.set('project', record.project)
  const response = await rendererRuntimeClient.runtimeRequest(kunMemoryRecordPath(record.id) + '/lifecycle' +
    (query.size ? '?' + query.toString() : ''), 'POST', JSON.stringify({ ...action, expectedRevision: record.revision ?? 1 }))
  if (!response.ok) throw runtimeErrorToError(parseRuntimeErrorBody(response.body, 'Memory changed. Reload before trying again.'))
  return JSON.parse(response.body)
}

export async function loadMemoryHistory(record: CoreMemoryRecordJson): Promise<CoreMemoryHistoryJson[]> {
  const query = new URLSearchParams()
  if (record.workspace) query.set('workspace', record.workspace)
  if (record.project) query.set('project', record.project)
  const response = await rendererRuntimeClient.runtimeRequest(kunMemoryRecordPath(record.id) + '/history' +
    (query.size ? '?' + query.toString() : ''), 'GET')
  if (!response.ok) throw runtimeErrorToError(parseRuntimeErrorBody(response.body, 'Memory history is unavailable.'))
  return (JSON.parse(response.body) as { history: CoreMemoryHistoryJson[] }).history
}
