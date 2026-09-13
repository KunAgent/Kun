import { stat } from 'node:fs/promises'

/** Missing sources may still be discussed, but an execution workspace must actually exist. */
export async function assertHistoryReferenceWorkspace(thread: { historyRefId?: string; workspace: string }): Promise<void> {
  if (!thread.historyRefId) return
  const directory = await stat(thread.workspace).catch(() => null)
  if (!directory?.isDirectory()) {
    throw new Error('The workspace for this Codex branch is unavailable. Select an existing workspace before sending a message.')
  }
}
