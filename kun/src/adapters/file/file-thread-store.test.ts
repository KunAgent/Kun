import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonl } from './file-thread-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempFile(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-read-jsonl-'))
  roots.push(root)
  return join(root, name)
}

describe('readJsonl', () => {
  it('returns an empty array only when the file is missing', async () => {
    const path = await tempFile('missing.jsonl')
    await expect(readJsonl(path)).resolves.toEqual([])
  })

  it('throws wrapped permission errors with the original code', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const path = await tempFile('blocked.jsonl')
    await writeFile(path, '{"ok":true}\n')
    await chmod(path, 0o000)
    try {
      await expect(readJsonl(path)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(path, 0o600)
    }
  })

  it('keeps tolerant parsing for small metadata logs but reports the line', async () => {
    const path = await tempFile('metadata.jsonl')
    await writeFile(path, '{"ok":1}\nnot-json\n{"ok":2}\n')
    await expect(readJsonl<{ ok: number }>(path)).resolves.toEqual([{ ok: 1 }, { ok: 2 }])
  })
})
