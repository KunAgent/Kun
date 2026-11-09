import { enqueueWriteDocumentOperation } from './write-document-operations'
import { normalizeWritePath } from './write-path-normalization'
import type { WorkspaceFileWritePayload, WorkspaceFileWriteResult } from '@shared/workspace-file'

type WriteWorkspaceFile = (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>

const saveQueues = new Map<string, Promise<unknown>>()
const pendingSaveContents = new Map<string, Map<string, number>>()

function normalizedKeyPart(value: string): string {
  return normalizeWritePath(value.trim())
}

export function writeSaveQueueKey(workspaceRoot: string, path: string): string {
  return `${normalizedKeyPart(workspaceRoot)}\0${normalizedKeyPart(path)}`
}

/**
 * Serializes any read/modify/write operation with normal document saves for
 * the same workspace file. This is used by background jobs such as
 * infographic placeholder resolution, which must not race an autosave.
 */
export function enqueueWriteWorkspaceFileTask<T>(
  workspaceRoot: string,
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  return enqueueWriteDocumentOperation(workspaceRoot, path, async (currentPath) => {
    // Generic read/modify/write closures capture their source path. After a
    // rename they must be retried with a fresh context, never recreate the source.
    if (writeSaveQueueKey(workspaceRoot, currentPath) !== writeSaveQueueKey(workspaceRoot, path)) {
      throw new Error('Document moved before the queued file operation started')
    }
    return enqueueDiskWriteTask(workspaceRoot, path, operation)
  })
}

function enqueueDiskWriteTask<T>(
  workspaceRoot: string,
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = writeSaveQueueKey(workspaceRoot, path)
  const previous = saveQueues.get(key) ?? Promise.resolve()
  const task = previous
    .catch(() => undefined)
    .then(operation)
  saveQueues.set(key, task)
  void task.finally(() => {
    if (saveQueues.get(key) === task) saveQueues.delete(key)
  }).catch(() => undefined)
  return task
}

export function enqueueWriteWorkspaceSave(
  payload: WorkspaceFileWritePayload,
  writeWorkspaceFile: WriteWorkspaceFile = window.kunGui.writeWorkspaceFile
): Promise<WorkspaceFileWriteResult> {
  const key = writeSaveQueueKey(payload.workspaceRoot ?? '', payload.path)
  const contents = pendingSaveContents.get(key) ?? new Map<string, number>()
  contents.set(payload.content, (contents.get(payload.content) ?? 0) + 1)
  pendingSaveContents.set(key, contents)

  // Store saves already hold the document reservation through state settlement.
  const task = enqueueDiskWriteTask(
    payload.workspaceRoot ?? '',
    payload.path,
    () => writeWorkspaceFile(payload)
  )
  void task.finally(() => {
    const current = pendingSaveContents.get(key)
    const count = current?.get(payload.content) ?? 0
    if (!current || count <= 0) return
    if (count === 1) current.delete(payload.content)
    else current.set(payload.content, count - 1)
    if (current.size === 0) pendingSaveContents.delete(key)
  }).catch(() => undefined)
  return task
}

/**
 * Reports whether a watcher snapshot matches a local save that is queued or
 * currently in flight. Callers use this to suppress local filesystem echoes
 * without treating a genuine external edit as an assistant diff.
 */
export function isWriteWorkspaceSaveContentPending(
  workspaceRoot: string,
  path: string,
  content: string
): boolean {
  return (pendingSaveContents.get(writeSaveQueueKey(workspaceRoot, path))?.get(content) ?? 0) > 0
}

export async function flushWriteWorkspaceSaveQueue(
  workspaceRoot?: string,
  path?: string,
  includeDescendants = false
): Promise<void> {
  if (workspaceRoot !== undefined && path !== undefined) {
    const key = writeSaveQueueKey(workspaceRoot, path)
    const pending = [...saveQueues].filter(([candidate]) => candidate === key || (
      includeDescendants && candidate.startsWith(key.endsWith('/') ? key : `${key}/`)
    ))
    await Promise.all(pending.map(([, task]) => task.catch(() => undefined)))
    return
  }
  await Promise.all([...saveQueues.values()].map((task) => task.catch(() => undefined)))
}

export function clearWriteWorkspaceSaveQueueForTests(): void {
  saveQueues.clear()
  pendingSaveContents.clear()
}
