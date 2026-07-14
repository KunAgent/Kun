import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAtomicBackup, restoreAtomicBackup } from './atomic-backup-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'kun-backup-'))
  roots.push(root)
  return root
}

describe('atomic backup service', () => {
  it('writes atomically and restores a checksum-validated backup', async () => {
    const directory = await tempRoot()
    const record = await createAtomicBackup(
      { contents: '{"ok":true}\n', sensitivity: 'non-sensitive' },
      { directory, id: 'settings', now: () => new Date('2026-07-14T00:00:00.000Z') }
    )

    expect(record.bytes).toBe(12)
    expect(await restoreAtomicBackup(record, { directory })).toBe('{"ok":true}\n')
    expect(await readdir(directory)).toEqual([expect.stringMatching(/^settings-.*\.backup$/)])
  })

  it('rotates only its own backups within count and byte limits', async () => {
    const directory = await tempRoot()
    for (let index = 0; index < 3; index += 1) {
      await createAtomicBackup(
        { contents: `v${index}`, sensitivity: 'non-sensitive' },
        {
          directory,
          id: 'migration',
          maxBackups: 2,
          maxTotalBytes: 4,
          now: () => new Date(`2026-07-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`)
        }
      )
    }
    const files = await readdir(directory)
    expect(files).toHaveLength(2)
    expect(files.every((file) => file.startsWith('migration-'))).toBe(true)
    expect(await readFile(join(directory, files[1]), 'utf8')).toMatch(/^v[12]$/)
  })

  it('rejects sensitive or oversized payloads and detects tampering', async () => {
    const directory = await tempRoot()
    await expect(createAtomicBackup(
      { contents: 'undeclared' } as never,
      { directory, id: 'undeclared' }
    )).rejects.toThrow(/sensitive/)
    await expect(createAtomicBackup(
      { contents: 'token=secret', sensitivity: 'sensitive' as never },
      { directory, id: 'secrets' }
    )).rejects.toThrow(/sensitive/)
    await expect(createAtomicBackup(
      { contents: '12345', sensitivity: 'non-sensitive' },
      { directory, id: 'small', maxBytesPerBackup: 4 }
    )).rejects.toThrow(/size limit/)

    const record = await createAtomicBackup({ contents: 'stable', sensitivity: 'non-sensitive' }, { directory, id: 'config' })
    await writeFile(record.path, 'stablx')
    await expect(restoreAtomicBackup(record, { directory })).rejects.toThrow(/checksum/)
    const bounded = await createAtomicBackup({ contents: '1234', sensitivity: 'non-sensitive' }, { directory, id: 'bounded' })
    await expect(restoreAtomicBackup(bounded, { directory, maxBytes: 3 })).rejects.toThrow(/size/)
    await expect(restoreAtomicBackup(record, { directory: join(directory, 'other') })).rejects.toThrow(/outside/)
  })
})
