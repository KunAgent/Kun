import { realpath } from 'node:fs/promises'
import { normalize } from 'node:path'

export type GitCheckpointManifestV1 = {
  version: 1
  checkpointId: string
  threadId: string
  repositoryRootCanonical: string
  workspaceRootCanonical?: string
  head: string
  currentBranch: string | null
  createdAt: string
}

export type GitCheckpointMetadataLike = {
  checkpointId: string
  threadId: string
  repositoryRoot: string
  head: string
  currentBranch: string | null
  createdAt: string
}

export type GitCheckpointExpectedRestoreContext = {
  expectedThreadId?: string
  expectedWorkspaceRoot?: string
}

export async function canonicalCheckpointPath(path: string): Promise<string> {
  return normalize(await realpath(path))
}

export async function createCheckpointManifestV1(input: {
  metadata: GitCheckpointMetadataLike
  workspaceRoot?: string
}): Promise<GitCheckpointManifestV1> {
  return {
    version: 1,
    checkpointId: input.metadata.checkpointId,
    threadId: input.metadata.threadId,
    repositoryRootCanonical: await canonicalCheckpointPath(input.metadata.repositoryRoot),
    ...(input.workspaceRoot ? { workspaceRootCanonical: await canonicalCheckpointPath(input.workspaceRoot) } : {}),
    head: input.metadata.head,
    currentBranch: input.metadata.currentBranch,
    createdAt: input.metadata.createdAt
  }
}

export async function validateCheckpointRestoreContext(input: {
  manifest: GitCheckpointManifestV1
  expected: GitCheckpointExpectedRestoreContext
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.expected.expectedThreadId && input.expected.expectedThreadId !== input.manifest.threadId) {
    return {
      ok: false,
      message: `Checkpoint belongs to thread ${input.manifest.threadId}, not ${input.expected.expectedThreadId}.`
    }
  }
  if (input.expected.expectedWorkspaceRoot) {
    const expectedWorkspaceRoot = await canonicalCheckpointPath(input.expected.expectedWorkspaceRoot)
    const actualWorkspaceRoot = input.manifest.workspaceRootCanonical ?? input.manifest.repositoryRootCanonical
    if (expectedWorkspaceRoot !== actualWorkspaceRoot) {
      return {
        ok: false,
        message: `Checkpoint belongs to workspace ${actualWorkspaceRoot}, not ${expectedWorkspaceRoot}.`
      }
    }
  }
  return { ok: true }
}
