import { stat } from 'node:fs/promises'
import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry
} from '../../shared/workspace-file'
import { listWorkspaceDirectory as listWorkspaceDirectoryWithoutMetadata } from './workspace-files'

async function withEntryMetadata(entry: WorkspaceEntry): Promise<WorkspaceEntry> {
  try {
    const info = await stat(entry.path)
    return {
      ...entry,
      mtimeMs: info.mtimeMs,
      size: info.isFile() ? info.size : 0
    }
  } catch {
    return entry
  }
}

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  const result = await listWorkspaceDirectoryWithoutMetadata(payload)
  if (!result.ok) return result
  return {
    ...result,
    entries: await Promise.all(result.entries.map(withEntryMetadata))
  }
}
