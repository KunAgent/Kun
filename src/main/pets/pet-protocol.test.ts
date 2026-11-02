import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Protocol } from 'electron'
import { bindPetAssetReader, registerPetAssetProtocol } from './pet-protocol'

const roots: string[] = []

afterEach(async () => {
  bindPetAssetReader(null)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('installs kun-pet before a reader is bound and then serves the spritesheet', async () => {
  const handle = vi.fn()
  registerPetAssetProtocol({ handle } as unknown as Pick<Protocol, 'handle'>)
  const handler = handle.mock.calls[0][1] as (request: Request) => Promise<Response>
  const url = 'kun-pet://asset/kun%3Adot/spritesheet?v=abc'
  expect(handle.mock.calls[0][0]).toBe('kun-pet')
  expect((await handler(new Request(url))).status).toBe(404)

  const root = await mkdtemp(path.join(tmpdir(), 'kun-pet-protocol-'))
  roots.push(root)
  const asset = path.join(root, 'spritesheet.webp')
  await writeFile(asset, Buffer.from([1, 2, 3]))
  bindPetAssetReader({ lookup: (id) => id === 'kun:dot' ? asset : null, libraryRoot: root })

  const response = await handler(new Request(url))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])

  bindPetAssetReader(null)
  expect((await handler(new Request(url))).status).toBe(404)
})
