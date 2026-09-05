import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TrajectoryContentStore } from './trajectory-content-store.js'

describe('TrajectoryContentStore', () => {
  it('deduplicates prompt parts, removes credentials and binary bodies, and cascades deletion', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-trajectory-content-'))
    const store = new TrajectoryContentStore(dataDir)
    const apiKey = 'sk-private-trajectory-secret'
    const body = JSON.stringify({
      system: 'stable system prompt',
      tools: [{ name: 'read', parameters: { type: 'object' } }],
      messages: [{ role: 'user', content: 'hello' }],
      authorization: apiKey,
      image: `data:image/png;base64,${'A'.repeat(8_192)}`,
      temperature: 0
    })
    try {
      const first = await store.captureRequest({
        threadId: 'thread-a', requestId: 'request-a', bodyText: body, secretValues: [apiKey]
      })
      const second = await store.captureRequest({
        threadId: 'thread-a', requestId: 'request-b', bodyText: body, secretValues: [apiKey]
      })
      expect(first.blobs.map((blob) => blob.blobId)).toEqual(second.blobs.map((blob) => blob.blobId))
      const blobRoot = join(dataDir, 'observability', 'trajectory', 'blobs')
      expect(await readdir(blobRoot)).toHaveLength(first.blobs.length)
      expect((await stat(blobRoot)).mode & 0o777).toBe(0o700)

      const loaded = await store.loadManifestContent('thread-a', 'request-a')
      expect(JSON.stringify(loaded)).not.toContain(apiKey)
      expect(JSON.stringify(loaded)).not.toContain('A'.repeat(4_096))
      expect(JSON.stringify(loaded)).toContain('[REDACTED]')
      expect(JSON.stringify(loaded)).toContain('[BINARY OMITTED]')
      for (const name of await readdir(blobRoot)) {
        expect((await readFile(join(blobRoot, name))).toString('utf8')).not.toContain(apiKey)
      }

      await store.deleteThread('thread-a')
      expect(await readdir(blobRoot)).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
