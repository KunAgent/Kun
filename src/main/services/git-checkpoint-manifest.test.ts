import { mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalCheckpointPath,
  createCheckpointManifestV1,
  validateCheckpointRestoreContext
} from './git-checkpoint-manifest'

async function tempDir(): Promise<string> {
  const path = join(tmpdir(), `kun-checkpoint-manifest-${randomUUID()}`)
  await mkdir(path, { recursive: true })
  return path
}

describe('git checkpoint manifest helpers', () => {
  it('canonicalizes paths before writing manifest identity fields', async () => {
    const root = await tempDir()
    try {
      const manifest = await createCheckpointManifestV1({
        metadata: {
          checkpointId: 'gcp_1',
          threadId: 'thread-1',
          repositoryRoot: root,
          head: 'HEAD',
          currentBranch: 'main',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        workspaceRoot: root
      })

      expect(manifest.repositoryRootCanonical).toBe(await realpath(root))
      expect(manifest.workspaceRootCanonical).toBe(await realpath(root))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts equivalent canonical workspace paths and rejects different threads', async () => {
    const root = await tempDir()
    try {
      const canonical = await canonicalCheckpointPath(root)
      const manifest = {
        version: 1 as const,
        checkpointId: 'gcp_1',
        threadId: 'thread-1',
        repositoryRootCanonical: canonical,
        workspaceRootCanonical: canonical,
        head: 'HEAD',
        currentBranch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z'
      }

      await expect(validateCheckpointRestoreContext({
        manifest,
        expected: { expectedThreadId: 'thread-1', expectedWorkspaceRoot: root }
      })).resolves.toEqual({ ok: true })

      await expect(validateCheckpointRestoreContext({
        manifest,
        expected: { expectedThreadId: 'thread-2', expectedWorkspaceRoot: root }
      })).resolves.toMatchObject({ ok: false })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
