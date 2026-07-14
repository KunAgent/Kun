import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectJsonlTail, repairJsonlTail } from '../src/services/thread-store-repair.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('JSONL tail repair', () => {
  it('repairs only a malformed final record after the backup callback succeeds', async () => {
    const path = await makeFile('{"seq":1}\n{"seq":2}\n{"seq":')
    const snapshots: string[] = []

    const inspected = await inspectJsonlTail(path)
    expect(inspected).toMatchObject({ status: 'truncated', removedBytes: 7 })
    const repaired = await repairJsonlTail(path, {
      backup: async (snapshot) => { snapshots.push(snapshot.contents) }
    })

    expect(repaired).toMatchObject({ status: 'repaired', removedBytes: 7 })
    expect(await readFile(path, 'utf8')).toBe('{"seq":1}\n{"seq":2}\n')
    expect(snapshots).toEqual(['{"seq":1}\n{"seq":2}\n{"seq":'])
  })

  it('fails closed when a backup is not supplied or fails', async () => {
    const path = await makeFile('{"seq":1}\n{"seq":')
    await expect(repairJsonlTail(path, { backup: undefined as never })).rejects.toThrow('backup_required')
    await expect(repairJsonlTail(path, { backup: async () => { throw new Error('backup_failed') } })).rejects.toThrow('backup_failed')
    expect(await readFile(path, 'utf8')).toBe('{"seq":1}\n{"seq":')
  })

  it('does not overwrite a file changed while the backup callback runs', async () => {
    const path = await makeFile('{"seq":1}\n{"seq":')
    const result = await repairJsonlTail(path, {
      backup: async () => { await writeFile(path, '{"seq":9}\n', 'utf8') }
    })
    expect(result).toMatchObject({ status: 'changed', reason: 'changed_before_write' })
    expect(await readFile(path, 'utf8')).toBe('{"seq":9}\n')
  })

  it('does not rewrite interior corruption, a fully valid file, or an oversized file', async () => {
    const interior = await makeFile('{bad}\n{"seq":1}\n')
    const valid = await makeFile('{"seq":1}\n')
    const oversized = await makeFile('{"seq":1}\n')
    expect(await repairJsonlTail(interior, { backup: async () => undefined })).toMatchObject({ status: 'invalid' })
    expect(await repairJsonlTail(valid, { backup: async () => undefined })).toMatchObject({ status: 'ok', bytes: 10 })
    expect(await repairJsonlTail(oversized, { maxBytes: 4, backup: async () => undefined })).toMatchObject({ status: 'too_large' })
    expect(await readFile(interior, 'utf8')).toBe('{bad}\n{"seq":1}\n')
  })

  it('refuses a final malformed record when no valid prefix exists', async () => {
    const path = await makeFile('{"seq":')
    expect(await repairJsonlTail(path, { backup: async () => undefined })).toMatchObject({ status: 'invalid' })
    expect(await readFile(path, 'utf8')).toBe('{"seq":')
  })
})

async function makeFile(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-repair-'))
  roots.push(root)
  const path = join(root, 'events.jsonl')
  await writeFile(path, contents, 'utf8')
  return path
}
