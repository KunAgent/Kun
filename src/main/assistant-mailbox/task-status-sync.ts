import type { DeviceIdentity } from '@kun/remote-protocol'
import { AGENT_VERSION } from '@kun/assistant-agent'
import type { AssistantTaskStore } from './task-store'

type Dependencies = {
  origin: string
  fetch: typeof fetch
  accessToken(): Promise<string | null>
  stillCurrent(): Promise<boolean>
  identity: DeviceIdentity
  tasks: AssistantTaskStore
}

/** Publish only status metadata. A failed upload leaves its durable revisions pending. */
export async function syncTaskStatus(deps: Dependencies, assistantIds: readonly string[]): Promise<void> {
  for (const assistantId of assistantIds) {
    const rows = await deps.tasks.statusChanges(assistantId)
    for (let offset = 0; offset < rows.length; offset += 100) {
      if (!await deps.stillCurrent()) throw new Error('ACCOUNT_CHANGED')
      const token = await deps.accessToken()
      if (!token || !await deps.stillCurrent()) throw new Error('ACCOUNT_CHANGED')
      const chunk = rows.slice(offset, offset + 100)
      const response = await deps.fetch(`${deps.origin}/api/assistants/v1/host/assistants/${assistantId}/task-status`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, 'X-Kun-Device': deps.identity.id,
          'X-Kun-Device-Credential': deps.identity.credential, 'X-Kun-Agent-Version': AGENT_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: chunk })
      })
      if (!response.ok) throw new Error(`TASK_STATUS_HTTP_${response.status}`)
      const body = await response.text()
      if (body.length > 65536) throw new Error('TASK_STATUS_UNCONFIRMED')
      const result = JSON.parse(body) as { ok?: unknown; count?: unknown; revisions?: unknown }
      if (result.ok !== true || result.count !== chunk.length || !Array.isArray(result.revisions)
          || result.revisions.length !== chunk.length || !await deps.stillCurrent()) throw new Error('TASK_STATUS_UNCONFIRMED')
      const confirmed: typeof chunk = []
      for (let index = 0; index < chunk.length; index++) {
        const row = result.revisions[index] as { taskId?: unknown; revision?: unknown; matches?: unknown }
        const sent = chunk[index]
        if (row?.taskId !== sent.taskId || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1
            || typeof row.matches !== 'boolean') throw new Error('TASK_STATUS_UNCONFIRMED')
        if (row.revision === sent.revision && row.matches) confirmed.push(sent)
        else await deps.tasks.rebaseStatusRevision(sent.taskId, sent.revision, row.revision as number)
      }
      await deps.tasks.markStatusReported(confirmed)
    }
  }
}
