import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPetSettings } from '../../shared/pets'
import { DEFAULT_BUILTIN_PET_ID, PetStore } from './pet-store'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(settings?: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'kun-pet-first-run-'))
  roots.push(root)
  if (settings !== undefined) await writeFile(path.join(root, 'settings.json'), settings)
  const store = new PetStore(root)
  await store.initialize()
  return { root, store }
}

async function importPet(store: PetStore, sourceId = 'xiao-kun') {
  const sourcePath = path.resolve('resources/pets/xiao-kun')
  await store.importOrUpdate({
    source: 'kun-builtin', sourceId, displayName: sourceId, description: 'Test pet',
    spriteVersionNumber: 1, sourcePath,
    spritesheetSourcePath: path.join(sourcePath, 'spritesheet.webp')
  })
}

describe('first-run desktop pet defaults', () => {
  it('persists one available default and leaves its first greeting unconsumed', async () => {
    const { root, store } = await fixture()
    await importPet(store)
    await store.applyFirstRunDefault(true)
    const expected = { selectedPetId: DEFAULT_BUILTIN_PET_ID, overlayOpen: true, welcomedPetIds: [] }
    expect(store.getSettings()).toMatchObject(expected)
    expect(JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8'))).toMatchObject(expected)
    const restarted = new PetStore(root)
    await restarted.initialize()
    expect(restarted.getSettings()).toMatchObject(expected)
  })

  it('does not choose a pet for an existing installation with no pet preferences', async () => {
    const { store } = await fixture()
    await importPet(store)
    await store.applyFirstRunDefault(false)
    expect(store.getSettings()).toEqual(defaultPetSettings())
  })

  it.each([JSON.stringify(defaultPetSettings()), '{broken', 'null'])(
    'preserves existing or damaged preferences: %s', async (settings) => {
    const { store } = await fixture(settings)
    await importPet(store)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings()).toMatchObject({ selectedPetId: null, overlayOpen: false })
    })

  it('does not enable a pet when the settings path is unreadable as a file', async () => {
    const { root } = await fixture()
    await mkdir(path.join(root, 'settings.json'))
    const store = new PetStore(root)
    await store.initialize()
    await importPet(store)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings().overlayOpen).toBe(false)
  })

  it('keeps another selected pet and an explicit empty selection', async () => {
    const { store } = await fixture()
    await importPet(store)
    await importPet(store, 'another')
    await store.selectPet('kun:another')
    await store.setOverlayOpen(true)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings()).toMatchObject({ selectedPetId: 'kun:another', overlayOpen: true })
    await store.selectPet(null)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings()).toMatchObject({ selectedPetId: null, overlayOpen: false })
  })

  it('preserves a dangling settings link instead of replacing it with first-run defaults', async () => {
    const { root } = await fixture()
    await symlink(path.join(root, 'missing.json'), path.join(root, 'settings.json'))
    const store = new PetStore(root)
    await store.initialize()
    await importPet(store)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings().overlayOpen).toBe(false)
  })

  it('respects a user write queued while the first import is finishing', async () => {
    const { store } = await fixture()
    await importPet(store)
    await Promise.all([store.selectPet(null), store.applyFirstRunDefault(true)])
    expect(store.getSettings()).toMatchObject({ selectedPetId: null, overlayOpen: false })
  })

  it('keeps a closed pet closed on refresh and restart, even with a stale first-run flag', async () => {
    const { root, store } = await fixture()
    await importPet(store)
    await store.applyFirstRunDefault(true)
    await store.setOverlayOpen(false)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings().overlayOpen).toBe(false)
    const restarted = new PetStore(root)
    await restarted.initialize()
    await restarted.applyFirstRunDefault(true)
    expect(restarted.getSettings()).toMatchObject({ selectedPetId: DEFAULT_BUILTIN_PET_ID, overlayOpen: false })
  })

  it('never opens an unavailable or missing-source default', async () => {
    const { store } = await fixture()
    await store.applyFirstRunDefault(true)
    expect(store.getSettings().overlayOpen).toBe(false)
    await importPet(store)
    await store.markSourceMissing(DEFAULT_BUILTIN_PET_ID)
    await store.applyFirstRunDefault(true)
    expect(store.getSettings()).toMatchObject({ selectedPetId: null, overlayOpen: false })
  })
})
