import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPetInteractions } from '../../shared/pets-interactions'
import { refreshPetLibraries } from './pet-importer'
import { PetStore } from './pet-store'
import { validatePetPackage } from './pet-validator'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('pet interaction package updates', () => {
  it('imports recipes, fingerprints recipe-only changes and keeps the last valid package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kun-pet-recipes-')); roots.push(root)
    const dir = path.join(root, 'builtin', 'xiao-kun')
    await cp(path.resolve('resources/pets/xiao-kun'), dir, { recursive: true })
    const store = new PetStore(path.join(root, 'profile'))
    await store.initialize()
    const refresh = () => refreshPetLibraries({ store, builtinRoot: path.dirname(dir), localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'no-codex'), importCodexPets: false })
    await refresh()
    const before = store.getManifest('kun:xiao-kun')!
    expect(before.interactions?.clips.typing.state).toBe('running')
    const manifest = JSON.parse(await readFile(path.join(dir, 'pet.json'), 'utf8'))
    manifest.interactions.clips.typing.tempo = 2
    await writeFile(path.join(dir, 'pet.json'), JSON.stringify(manifest))
    expect((await refresh()).updated.map((pet) => pet.id)).toContain('kun:xiao-kun')
    expect(store.getManifest('kun:xiao-kun')?.sourceFingerprint).not.toBe(before.sourceFingerprint)
    const restarted = new PetStore(path.join(root, 'profile')); await restarted.initialize()
    expect(restarted.listPets()[0].interactions?.clips.typing.tempo).toBe(2)
    manifest.interactions.clips.typing.state = 'execute-code'
    await writeFile(path.join(dir, 'pet.json'), JSON.stringify(manifest))
    expect((await refresh()).failed).toHaveLength(1)
    expect(store.getManifest('kun:xiao-kun')?.interactions?.clips.typing.tempo).toBe(2)
    delete manifest.interactions
    await writeFile(path.join(dir, 'pet.json'), JSON.stringify(manifest))
    expect((await validatePetPackage(dir, 'xiao-kun')).interactions).toBeUndefined()
    await refresh()
    expect(store.getManifest('kun:xiao-kun')?.interactions).toBeUndefined()
    expect(defaultPetInteractions().clips.typing.state).toBe('running')
  })
})
