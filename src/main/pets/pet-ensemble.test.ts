import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PET_IPC, type PetSource } from '../../shared/pets'
import { defaultPetEnsemble } from '../../shared/pets-ensemble'
import { refreshPetLibraries } from './pet-importer'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'
import { PetStore } from './pet-store'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'kun-ensemble-'))
  roots.push(root)
  const store = new PetStore(root)
  await store.initialize()
  return { store, root }
}
async function importPet(store: PetStore, sourceId: string, source: PetSource = 'kun-builtin') {
  const sourcePath = path.resolve('resources/pets/xiao-kun')
  await store.importOrUpdate({ source, sourceId, displayName: sourceId, description: 'Fixture',
    spriteVersionNumber: 1, sourcePath, spritesheetSourcePath: path.join(sourcePath, 'spritesheet.webp') })
}

describe('built-in pet collection upgrades', () => {
  it.each([true, false])('moves a retired AI selection to DS without changing visibility (%s)', async (open) => {
    const { store, root } = await fixture()
    await importPet(store, 'gpt-girl')
    await importPet(store, 'gpt-girl', 'kun-local')
    await store.selectPet('kun:gpt-girl'); await store.setOverlayOpen(open)
    const refresh = async (target: PetStore) => refreshPetLibraries({ store: target,
      builtinRoot: path.resolve('resources/pets'), localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'no-codex'), importCodexPets: false })
    await refresh(store)
    expect(store.getSettings()).toMatchObject({ selectedPetId: 'kun:whale-girl', overlayOpen: open })
    expect(store.listPets().filter((pet) => pet.source === 'kun-builtin').map((pet) => pet.sourceId).sort()).toEqual(['ikun', 'whale-girl', 'xiao-kun'])
    expect(store.getManifest('kun:gpt-girl')).toBeNull()
    expect(store.getManifest('kun-local:gpt-girl')).not.toBeNull()
    const restarted = new PetStore(root); await restarted.initialize(); await refresh(restarted)
    expect(restarted.getSettings().selectedPetId).toBe('kun:whale-girl')
    expect(restarted.getManifest('kun:gpt-girl')).toBeNull()
  })

  it.each([true, false])('retires cached built-ins and retains overlay visibility (%s), imports and saved files', async (open) => {
    const { store, root } = await fixture()
    await importPet(store, 'anya')
    await importPet(store, 'unknown-old-builtin')
    await importPet(store, 'anya', 'kun-local')
    await importPet(store, 'anya', 'codex-custom')
    const cached = store.assetPath('kun:anya')!
    await store.selectPet('kun:anya')
    await store.setOverlayOpen(open)
    const refresh = async (target: PetStore) => refreshPetLibraries({ store: target,
      builtinRoot: path.resolve('resources/pets'), localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'no-codex'), importCodexPets: false })
    await refresh(store)
    expect(store.listPets().filter((pet) => pet.source === 'kun-builtin')).toHaveLength(3)
    expect(store.getSettings()).toMatchObject({ selectedPetId: 'kun:xiao-kun', overlayOpen: open })
    expect(store.getManifest('kun:anya')).toBeNull()
    expect(store.getManifest('kun:unknown-old-builtin')).toBeNull()
    expect(store.getManifest('kun-local:anya')).not.toBeNull()
    expect(store.getManifest('codex-custom:anya')).not.toBeNull()
    expect((await readFile(cached)).byteLength).toBeGreaterThan(0)
    const restarted = new PetStore(root)
    await restarted.initialize()
    await refresh(restarted)
    expect(restarted.getManifest('kun:anya')).toBeNull()
    expect(restarted.getSettings().selectedPetId).toBe('kun:xiao-kun')
  })

  it('keeps a custom selection and does not enable the overlay during migration', async () => {
    const { store } = await fixture()
    await importPet(store, 'anya')
    await importPet(store, 'anya', 'kun-local')
    await store.selectPet('kun-local:anya')
    await store.retireBuiltinPets()
    expect(store.getSettings()).toMatchObject({ selectedPetId: 'kun-local:anya', overlayOpen: false })
  })
})

describe('ensemble persistence and IPC', () => {
  it('retains legacy scene preferences but never restores permanent parties', async () => {
    const { store, root } = await fixture()
    const ensemble = { ...defaultPetEnsemble(), enabled: true, scene: 'orchestra' as const, paused: true, autoplay: true }
    await expect(store.setPetEnsemble(ensemble)).rejects.toThrow('unavailable')
    for (const id of ensemble.members) await importPet(store, id)
    await store.setPetEnsemble(ensemble)
    const restarted = new PetStore(root)
    await restarted.initialize()
    expect(restarted.getSettings().ensemble).toEqual({ ...ensemble, enabled: false, paused: false, autoplay: false })
    const copy = restarted.getSettings()
    copy.ensemble?.members.pop()
    expect(restarted.getSettings().ensemble?.members).toHaveLength(3)
  })

  it('accepts valid workbench and overlay requests, and rejects subframes and malformed casts', async () => {
    const api = { setPetEnsemble: vi.fn(async () => ({})),
      allows: (event: { isMainFrame: boolean; senderKind: string }, kinds: string[]) => event.isMainFrame && kinds.includes(event.senderKind) }
    const handler = petIpcHandlers(api as unknown as PetIpcApi)[PET_IPC.setPetEnsemble]
    const overlay = { senderId: 1, isMainFrame: true, senderKind: 'overlay' as const }
    await handler(overlay, defaultPetEnsemble())
    await handler({ ...overlay, senderKind: 'main' }, defaultPetEnsemble())
    await expect(handler({ ...overlay, senderKind: 'other' }, defaultPetEnsemble())).rejects.toThrow('limited')
    await expect(handler({ ...overlay, isMainFrame: false }, defaultPetEnsemble())).rejects.toThrow('limited')
    await expect(handler(overlay, { ...defaultPetEnsemble(), members: ['gpt-girl'] })).rejects.toThrow('invalid')
    expect(api.setPetEnsemble).toHaveBeenCalledTimes(2)
  })
})
