import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_OFFICE_VERSIONS_PER_FILE } from '../../shared/office-version'
import { createOfficeVersionStore } from './office-version-service'

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

describe('office version store', () => {
  let root: string
  let file: string
  let tick: number

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'office-versions-'))
    file = join(root, 'workspace', 'deck.pptx')
    tick = Date.UTC(2026, 9, 22, 12, 0, 0)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const store = () => createOfficeVersionStore(join(root, 'store'), () => new Date(tick++))

  async function writeDeck(content: string): Promise<void> {
    await mkdir(join(root, 'workspace'), { recursive: true })
    await writeFile(file, content)
  }

  it('records a snapshot once and reads it back', async () => {
    const versions = store()
    const before = Buffer.from('before')
    const recorded = await versions.record({ absolutePath: file, data: before, sha256: sha(before), replacedBySha256: sha('after'), label: 'Make the bars wider' })
    expect(recorded.ok).toBe(true)
    const again = await versions.record({ absolutePath: file, data: before, sha256: sha(before), replacedBySha256: sha('after'), label: 'Make the bars wider' })
    expect(again.ok && recorded.ok && again.entry.id).toBe(recorded.ok && recorded.entry.id)
    const listed = await versions.list(file)
    expect(listed.ok && listed.entries.map((entry) => entry.label)).toEqual(['Make the bars wider'])
    const read = recorded.ok ? await versions.read(file, recorded.entry.id) : null
    expect(read?.ok && Buffer.from(read.dataBase64, 'base64').toString()).toBe('before')
  })

  it('rejects snapshots whose bytes do not match the claimed hash', async () => {
    const result = await store().record({ absolutePath: file, data: Buffer.from('x'), sha256: sha('y'), label: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('keeps only the newest snapshots per file', async () => {
    const versions = store()
    for (let index = 0; index < MAX_OFFICE_VERSIONS_PER_FILE + 3; index += 1) {
      const data = Buffer.from(`v${index}`)
      await versions.record({ absolutePath: file, data, sha256: sha(data), label: `edit ${index}` })
    }
    const listed = await versions.list(file)
    expect(listed.ok && listed.entries).toHaveLength(MAX_OFFICE_VERSIONS_PER_FILE)
    expect(listed.ok && listed.entries[0]?.label).toBe(`edit ${MAX_OFFICE_VERSIONS_PER_FILE + 2}`)
  })

  it('restores only over the expected content and keeps the replaced content', async () => {
    await writeDeck('after')
    if (process.platform !== 'win32') await chmod(file, 0o644)
    const versions = store()
    const before = Buffer.from('before')
    const recorded = await versions.record({ absolutePath: file, data: before, sha256: sha(before), replacedBySha256: sha('after'), label: 'Edit' })
    if (!recorded.ok) throw new Error(recorded.message)

    const stale = await versions.restore(file, recorded.entry.id, sha('something else'))
    expect(stale).toMatchObject({ ok: false, code: 'changed' })
    expect(await readFile(file, 'utf8')).toBe('after')

    const restored = await versions.restore(file, recorded.entry.id, sha('after'))
    expect(restored).toMatchObject({ ok: true, sha256: sha('before') })
    expect(await readFile(file, 'utf8')).toBe('before')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o644)

    // The replaced content is now a version too, so the undo can be undone.
    if (!restored.ok) throw new Error(restored.message)
    expect(restored.backup).toMatchObject({ reason: 'restore', sha256: sha('after') })
    const redo = await versions.restore(file, restored.backup.id, sha('before'))
    expect(redo.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('after')
  })

  it('reports a missing version', async () => {
    await writeDeck('after')
    expect(await store().restore(file, 'nope', sha('after'))).toMatchObject({ ok: false, code: 'missing' })
  })
})
