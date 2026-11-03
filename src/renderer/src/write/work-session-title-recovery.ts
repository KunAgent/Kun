import { kunThreadWorkTitleRecoverPath } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../agent/runtime-client'

export type RecoveredWorkTitle = { title: string; titleAuto?: boolean; agentSurface?: 'write' }

/** The runtime derives and conditionally persists a title from the session's own history. */
export async function recoverWorkTitle(threadId: string): Promise<RecoveredWorkTitle | null> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunThreadWorkTitleRecoverPath(threadId), 'POST', undefined, { priority: 'background' }
  )
  if (!response.ok) throw new Error(`Work title recovery failed (HTTP ${response.status})`)
  const result: unknown = JSON.parse(response.body)
  if (!result || typeof result !== 'object') return null
  const value = result as { title?: unknown; titleAuto?: unknown; agentSurface?: unknown }
  if (typeof value.title !== 'string' || !value.title.trim() ||
    (value.agentSurface !== undefined && value.agentSurface !== 'write')) return null
  return {
    title: value.title.trim(),
    ...(typeof value.titleAuto === 'boolean' ? { titleAuto: value.titleAuto } : {}),
    ...(value.agentSurface === 'write' ? { agentSurface: 'write' as const } : {})
  }
}
