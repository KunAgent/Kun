import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ArtifactReviewer } from './artifact-apply'

describe('ArtifactReviewer', () => {
  it('previews without mutation and applies only after an explicit call', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-delivery-workspace-'))
    const target = join(workspace, 'README.md')
    try {
      await writeFile(target, 'before', 'utf8')
      const before = await hash(target)
      const reviewer = new ArtifactReviewer(workspace, {
        deliveryId: 'delivery-1',
        files: [{ path: 'README.md', bytes: 5, sha256: createHash('sha256').update('after').digest('hex') }]
      }, new Map([['README.md', Buffer.from('after')]]))

      await expect(reviewer.preview()).resolves.toEqual([
        expect.objectContaining({ path: 'README.md', kind: 'modified' })
      ])
      expect(await hash(target)).toBe(before)
      await reviewer.apply()
      expect(await readFile(target, 'utf8')).toBe('after')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects traversal and Windows reserved names before preview or apply', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-delivery-workspace-'))
    try {
      expect(() => new ArtifactReviewer(workspace, {
        deliveryId: 'delivery-2', files: [{ path: '../escape.txt', bytes: 1, sha256: 'a'.repeat(64) }]
      }, new Map())).toThrowError(expect.objectContaining({ code: 'artifact_path_invalid' }))
      expect(() => new ArtifactReviewer(workspace, {
        deliveryId: 'delivery-3', files: [{ path: 'CON.txt', bytes: 1, sha256: 'a'.repeat(64) }]
      }, new Map())).toThrowError(expect.objectContaining({ code: 'artifact_path_invalid' }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function hash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
