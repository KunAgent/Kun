import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backgroundShellActiveMarkerPath,
  enforceBackgroundShellOutputRetention
} from '../src/services/background-shell-output-retention.js'
import { resolveBackgroundShellOutputPaths } from '../src/services/background-shell-output.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('background shell output retention', () => {
  it('enforces per-thread and aggregate file limits while preserving newest outputs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shell-retention-'))
    roots.push(dataDir)
    const paths = [
      await output(dataDir, 'thread-1', 'a', 1),
      await output(dataDir, 'thread-1', 'b', 2),
      await output(dataDir, 'thread-1', 'c', 3),
      await output(dataDir, 'thread-2', 'd', 4),
      await output(dataDir, 'thread-2', 'e', 5)
    ]

    await enforceBackgroundShellOutputRetention(dataDir, paths[4], {
      maxFilesPerThread: 2,
      maxBytesPerThread: 1_000,
      maxTotalFiles: 3,
      maxTotalBytes: 1_000,
      maxAgeMs: 1_000_000,
      now: () => 10_000
    })

    await expect(exists(paths[0])).resolves.toBe(false)
    await expect(exists(paths[1])).resolves.toBe(false)
    await expect(exists(paths[2])).resolves.toBe(true)
    await expect(exists(paths[3])).resolves.toBe(true)
    await expect(exists(paths[4])).resolves.toBe(true)
  })

  it('does not delete output with a live cross-process marker', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shell-retention-'))
    roots.push(dataDir)
    const active = await output(dataDir, 'thread-1', 'active', 1)
    const settled = await output(dataDir, 'thread-2', 'settled', 2)
    await writeFile(backgroundShellActiveMarkerPath(active), JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString()
    }))

    await enforceBackgroundShellOutputRetention(dataDir, settled, {
      maxFilesPerThread: 1,
      maxBytesPerThread: 1_000,
      maxTotalFiles: 1,
      maxTotalBytes: 1_000,
      maxAgeMs: 1_000_000,
      now: () => 10_000
    })

    await expect(exists(active)).resolves.toBe(true)
    await expect(exists(settled)).resolves.toBe(true)
  })
})

async function output(
  dataDir: string,
  threadId: string,
  sessionId: string,
  seconds: number
): Promise<string> {
  const paths = resolveBackgroundShellOutputPaths(dataDir, threadId, sessionId)
  await mkdir(paths.outputDir, { recursive: true })
  await writeFile(paths.outputFilePath, sessionId.repeat(8))
  await utimes(paths.outputFilePath, seconds, seconds)
  return paths.outputFilePath
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
