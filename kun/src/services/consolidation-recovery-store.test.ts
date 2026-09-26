import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsolidationRecoveryStore } from './consolidation-recovery-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ConsolidationRecoveryStore', () => {
  it('captures and verifies a recovery copy, detects tampering, and removes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-consolidation-recovery-'))
    roots.push(root)
    const threadDir = join(root, 'threads', 'thread_1')
    await mkdir(threadDir, { recursive: true })
    await writeFile(join(threadDir, 'messages.jsonl'), 'session payload')

    const store = new ConsolidationRecoveryStore(root)
    await store.capture({ jobId: 'cj_1', threadId: 'thread_1' })
    expect(await store.verify('cj_1', 'thread_1')).toBe(true)
    expect(await store.list()).toEqual(['cj_1'])

    await writeFile(join(root, 'consolidation-recovery', 'cj_1', 'messages.jsonl'), 'tampered')
    expect(await store.verify('cj_1', 'thread_1')).toBe(false)

    await store.remove('cj_1')
    expect(await store.verify('cj_1', 'thread_1')).toBe(false)
    expect(await readFile(join(root, 'consolidation-recovery', 'cj_1', 'manifest.json')).catch(() => null)).toBeNull()
  })
})
