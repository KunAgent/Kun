import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listKun3dAssets, readKun3dAsset } from './kun-3d-assets'

let home: string, root: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'kun-3d-'))
  root = join(home, '3d-assets')
})
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

describe('3D asset folder', () => {
  it('creates the category folders and a readme on first listing', async () => {
    const result = await listKun3dAssets(root)
    expect(result).toMatchObject({ ok: true, entries: [], truncated: false })
    expect((await readdir(root)).sort()).toEqual(['README.txt', 'base', 'bottle', 'glasses', 'headwear', 'outfit', 'prop', 'scene'])
  })

  it('lists models by category with their three-view drawings and loose files as other', async () => {
    await listKun3dAssets(root)
    await writeFile(join(root, 'headwear', 'pilot-cap.glb'), 'glb')
    await mkdir(join(root, 'headwear', 'pilot-cap'))
    for (const name of ['front.png', 'left.PNG', 'back.webp', 'notes.txt', 'side.png']) await writeFile(join(root, 'headwear', 'pilot-cap', name), 'x')
    await writeFile(join(root, 'loose.glb'), 'glb')
    await writeFile(join(root, 'prop', 'readme.md'), 'x')
    const result = await listKun3dAssets(root)
    if (!result.ok) throw new Error(result.message)
    expect(result.entries.map((entry) => [entry.key, entry.category, entry.id])).toEqual([
      ['headwear/pilot-cap.glb', 'headwear', 'pilot-cap'], ['loose.glb', 'other', 'loose']])
    expect(result.entries[0]!.references).toEqual({ front: 'headwear/pilot-cap/front.png', left: 'headwear/pilot-cap/left.PNG', back: 'headwear/pilot-cap/back.webp' })
    expect(result.entries[0]!.bytes).toBe(3)
  })

  it('reads files inside the folder and refuses anything that leaves it', async () => {
    await listKun3dAssets(root)
    await writeFile(join(root, 'headwear', 'pilot-cap.glb'), 'glTF')
    const read = await readKun3dAsset(root, 'headwear/pilot-cap.glb')
    expect(read).toMatchObject({ ok: true, bytes: 4, mimeType: 'model/gltf-binary' })
    if (read.ok) expect(new TextDecoder().decode(read.data)).toBe('glTF')
    await writeFile(join(home, 'secret.glb'), 'secret')
    await symlink(join(home, 'secret.glb'), join(root, 'prop', 'escape.glb'))
    expect(await readKun3dAsset(root, 'prop/escape.glb')).toMatchObject({ ok: false })
    expect(await readKun3dAsset(root, '../secret.glb')).toMatchObject({ ok: false })
    expect(await readKun3dAsset(root, 'headwear/missing.glb')).toMatchObject({ ok: false })
    // Symbolic links are not listed either.
    const listed = await listKun3dAssets(root)
    expect(listed.ok && listed.entries.map((entry) => entry.key)).toEqual(['headwear/pilot-cap.glb'])
  })
})
