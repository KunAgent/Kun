import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupUnusedGitCheckpoints } from './git-checkpoint-service'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile) }
})

let dataDir = ''
const threadReads = () => vi.mocked(readFile).mock.calls.filter(([path]) => String(path).includes(`${join(dataDir, 'threads')}`)).length

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-checkpoint-scan-'))
  await mkdir(join(dataDir, 'threads', 'thread-a'), { recursive: true })
  await writeFile(join(dataDir, 'threads', 'thread-a', 'messages.jsonl'),
    `${JSON.stringify({ kind: 'user_message', workspaceCheckpointId: 'gcp_1000_referenced' })}\n`)
  vi.mocked(readFile).mockClear()
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

async function checkpoint(id: string, ageMs: number): Promise<void> {
  const dir = join(dataDir, 'git-checkpoints', id)
  await mkdir(dir, { recursive: true })
  const when = new Date(Date.now() - ageMs)
  await utimes(dir, when, when)
}

it('does not read thread history when there is no checkpoint to clean', async () => {
  const result = await cleanupUnusedGitCheckpoints({ dataDir })
  expect(result).toMatchObject({ scanned: 0, deleted: 0 })
  expect(threadReads()).toBe(0)
})

it('does not read thread history while every checkpoint is inside its grace period', async () => {
  await checkpoint(`gcp_${Date.now()}_fresh`, 0)
  const result = await cleanupUnusedGitCheckpoints({ dataDir, graceMs: 10 * 60 * 1000 })
  expect(result).toMatchObject({ scanned: 1, kept: 1, deleted: 0 })
  expect(threadReads()).toBe(0)
})

it('reads thread history once to keep referenced checkpoints and delete the rest', async () => {
  await checkpoint('gcp_1000_referenced', 60 * 60 * 1000)
  await checkpoint('gcp_1000_orphan-a', 60 * 60 * 1000)
  await checkpoint('gcp_1000_orphan-b', 60 * 60 * 1000)
  const result = await cleanupUnusedGitCheckpoints({ dataDir, graceMs: 10 * 60 * 1000 })
  expect(result.deletedIds.sort()).toEqual(['gcp_1000_orphan-a', 'gcp_1000_orphan-b'])
  expect(result.kept).toBe(1)
  expect(threadReads()).toBe(1)
  await expect(stat(join(dataDir, 'git-checkpoints', 'gcp_1000_referenced'))).resolves.toBeTruthy()
})
