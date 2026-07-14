import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanStorageUsage } from './storage-usage-report'

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'kun-storage-usage-'))
}

describe('scanStorageUsage', () => {
  it('reports category sizes, files, directories, and latest modification', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'one.txt'), '1234')
    await writeFile(join(root, 'nested', 'two.txt'), '12')

    const report = await scanStorageUsage({
      roots: { threads: root },
      now: () => new Date('2026-07-14T00:00:00.000Z')
    })
    const threads = report.entries.find((entry) => entry.category === 'threads')!

    expect(threads).toMatchObject({ bytes: 6, files: 2, directories: 2, truncated: false })
    expect(threads).not.toHaveProperty('error')
    expect(threads.lastModifiedAt).toEqual(expect.any(String))
    expect(report.totalBytes).toBe(6)
    expect(report.totalFiles).toBe(2)
    expect(report.generatedAt).toBe('2026-07-14T00:00:00.000Z')
  })

  it('does not follow symlinks and treats missing roots as empty', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'linked')).catch(() => undefined)

    const report = await scanStorageUsage({
      roots: { attachments: root, logs: join(root, 'missing') }
    })
    const attachments = report.entries.find((entry) => entry.category === 'attachments')!
    const logs = report.entries.find((entry) => entry.category === 'logs')!

    expect(attachments.files).toBe(0)
    expect(attachments.bytes).toBe(0)
    expect(logs).toMatchObject({ bytes: 0, files: 0, directories: 0 })
    expect(logs).not.toHaveProperty('error')
  })

  it('stops at the per-category entry budget and rejects invalid limits', async () => {
    const root = await tempRoot()
    await Promise.all(Array.from({ length: 5 }, (_, index) => writeFile(join(root, `file-${index}`), '123')))

    const report = await scanStorageUsage({ roots: { models: root }, maxEntriesPerCategory: 2 })
    const models = report.entries.find((entry) => entry.category === 'models')!
    expect(models.truncated).toBe(true)
    expect(report.truncated).toBe(true)
    await expect(scanStorageUsage({ roots: {}, maxEntriesPerCategory: 0 })).rejects.toThrow(/between 1 and/)
    await expect(scanStorageUsage({ roots: {}, maxEntriesPerCategory: 50_001 })).rejects.toThrow(/between 1 and/)
  })
})
