import { mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PET_SHEET_HEIGHT_V2, PET_SHEET_WIDTH, petIdForSource } from '../../shared/pets'
import { encodeRgbaPng } from './pet-image'
import { detectCodexHome, refreshPetLibraries, resolveBuiltinPetsRoot } from './pet-importer'
import { isUnsafePetRelativePath } from './pet-paths'
import { parsePetAssetUrl, readPetAsset } from './pet-protocol'
import { PetStore } from './pet-store'
import { validatePetPackage } from './pet-validator'

const roots: string[] = []
const sheet = encodeRgbaPng(PET_SHEET_WIDTH, 1872, solid(PET_SHEET_WIDTH, 1872))

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pet packages', () => {
  it('rejects traversal, absolute paths, symlinks, corrupt images, and unknown versions', async () => {
    expect(isUnsafePetRelativePath('../pet.png')).toBe(true)
    expect(isUnsafePetRelativePath('/tmp/pet.png')).toBe(true)
    expect(isUnsafePetRelativePath('C:\\pet.png')).toBe(true)
    expect(isUnsafePetRelativePath('\\\\server\\share\\pet.png')).toBe(true)
    expect(isUnsafePetRelativePath('sprites\\..\\pet.png')).toBe(true)
    const root = await temp()
    const pet = path.join(root, 'outside')
    const linked = path.join(root, 'linked')
    await mkdir(pet, { recursive: true })
    await mkdir(path.join(root, 'else'), { recursive: true })
    await writeFile(path.join(root, 'else', 'spritesheet.png'), sheet)
    await symlink(path.join(root, 'else', 'spritesheet.png'), path.join(pet, 'spritesheet.png'))
    await writeFile(path.join(pet, 'pet.json'), JSON.stringify({
      id: 'outside', displayName: 'Outside', description: 'Escapes', spritesheetPath: 'spritesheet.png'
    }))
    await expect(validatePetPackage(pet, 'outside')).rejects.toThrow(/outside/)
    await writeFile(path.join(pet, 'pet.json'), JSON.stringify({
      id: 'outside', displayName: 'Outside', description: 'Bad', spritesheetPath: 'spritesheet.png', spriteVersionNumber: 9
    }))
    await expect(validatePetPackage(pet, 'outside')).rejects.toThrow(/1 or 2/)
  })

  it('imports v1 and v2, keeps selection, and preserves the last good copy', async () => {
    const root = await temp()
    const builtin = path.join(root, 'builtin', 'kun-dot')
    const local = path.join(root, 'local', '小 猫')
    const codex = path.join(root, 'codex-home', 'pets')
    const first = path.join(codex, 'a-pet')
    const duplicate = path.join(codex, 'b-pet')
    const broken = path.join(codex, 'c-pet')
    await writePackage(builtin, 'kun-dot', sheet)
    await writePackage(local, 'local-cat', sheet)
    await writePackage(first, 'same-id', sheet)
    await writePackage(duplicate, 'same-id', sheet)
    await mkdir(broken, { recursive: true })
    await writeFile(path.join(broken, 'pet.json'), '{')
    const store = new PetStore(path.join(root, 'profile-a', 'pets'))
    await store.initialize()
    await store.selectPet(null)
    const report = await refreshPetLibraries({
      store,
      builtinRoot: path.join(root, 'builtin'),
      localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'codex-home'),
      importCodexPets: true
    })
    expect(report.failed.some((failure) => failure.sourcePath === broken)).toBe(true)
    expect(report.conflicts).toHaveLength(1)
    expect(store.listPets().map((pet) => pet.id).sort()).toEqual([
      petIdForSource('codex-custom', 'same-id'),
      petIdForSource('kun-builtin', 'kun-dot'),
      petIdForSource('kun-local', 'local-cat')
    ].sort())
    const selected = petIdForSource('codex-custom', 'same-id')
    await store.selectPet(selected)
    await store.setOverlayOpen(true)
    const v2 = encodeRgbaPng(PET_SHEET_WIDTH, PET_SHEET_HEIGHT_V2, solid(PET_SHEET_WIDTH, PET_SHEET_HEIGHT_V2))
    await writePackage(first, 'same-id', v2, 2)
    const updated = await refreshPetLibraries({
      store,
      builtinRoot: path.join(root, 'builtin'),
      localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'codex-home'),
      importCodexPets: true
    })
    expect(updated.updated.map((pet) => pet.id)).toContain(selected)
    expect(updated.selectedPetIdUnchanged).toBe(selected)
    expect(store.getManifest(selected)?.spriteVersionNumber).toBe(2)
    await rm(duplicate, { recursive: true, force: true })
    await writeFile(path.join(first, 'spritesheet.png'), Buffer.from('not an image'))
    await refreshPetLibraries({
      store,
      builtinRoot: path.join(root, 'builtin'),
      localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'codex-home'),
      importCodexPets: true
    })
    expect(store.getManifest(selected)?.spriteVersionNumber).toBe(2)
    await rm(first, { recursive: true, force: true })
    const missing = await refreshPetLibraries({
      store,
      builtinRoot: path.join(root, 'builtin'),
      localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'codex-home'),
      importCodexPets: true
    })
    expect(missing.sourceMissing.map((pet) => pet.id)).toContain(selected)
    expect(store.getSettings().selectedPetId).toBe(selected)
    const restarted = new PetStore(path.join(root, 'profile-a', 'pets'))
    await restarted.initialize()
    expect(restarted.getSettings().overlayOpen).toBe(true)
    const other = new PetStore(path.join(root, 'profile-b', 'pets'))
    await other.initialize()
    expect(other.getSettings().selectedPetId).toBeNull()
  })

  it('restores corrupt settings, serializes writes, and caps dismissals', async () => {
    const root = await temp()
    const store = new PetStore(root)
    await store.initialize()
    await writeFile(path.join(root, 'settings.json'), '{')
    const restored = new PetStore(root)
    await restored.initialize()
    expect(restored.getSettings().overlayOpen).toBe(false)
    await Promise.all([
      restored.setImportPreferences({ importCodexPets: false }),
      restored.setMascotWidth(200)
    ])
    expect(restored.getSettings()).toMatchObject({ importCodexPets: false, mascotWidthPx: 200 })
    for (let index = 0; index < 520; index += 1) await restored.dismissNotification(`key-${index}`)
    expect(restored.getSettings().dismissedNotificationKeys).toHaveLength(500)
    expect(restored.getSettings().dismissedNotificationKeys[0]).toBe('key-20')
  })

  it('serves only library images and rejects file URLs and unknown ids', async () => {
    const root = await temp()
    const store = new PetStore(root)
    await store.initialize()
    const builtin = path.join(root, 'src')
    await writePackage(path.join(builtin, 'kun-dot'), 'kun-dot', sheet)
    await refreshPetLibraries({
      store,
      builtinRoot: builtin,
      localRoot: path.join(root, 'local'),
      codexHome: path.join(root, 'missing-codex'),
      importCodexPets: false
    })
    const id = petIdForSource('kun-builtin', 'kun-dot')
    const url = `kun-pet://asset/${encodeURIComponent(id)}/spritesheet?v=1`
    expect(parsePetAssetUrl(url)?.petId).toBe(id)
    expect(parsePetAssetUrl('file:///etc/passwd')).toBeNull()
    const response = await readPetAsset(url, (petId) => store.assetPath(petId), store.libraryRoot())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect((await readPetAsset('kun-pet://asset/nope/spritesheet', () => null, store.libraryRoot())).status).toBe(404)
    expect((await readPetAsset('file:///etc/passwd', () => '/etc/passwd', store.libraryRoot())).status).toBe(404)
  })

  it('accepts every shipped built-in pet, including the Awaken set', async () => {
    const root = path.resolve('resources/pets')
    const names = (await readdir(root)).sort()
    const imported: string[] = []
    for (const name of names) {
      const dir = path.join(root, name)
      if (!(await stat(dir)).isDirectory()) continue
      const validated = await validatePetPackage(dir, name)
      expect(validated.warnings, name).toEqual([])
      imported.push(`${validated.sourceId}:v${validated.spriteVersionNumber}`)
    }
    expect(imported).toEqual([
      'alo-asuna:v1',
      'anya:v1',
      'artoria:v1',
      'dordor:v1',
      'gojo:v1',
      'goku:v1',
      'ikun:v1',
      'kawaii-bear-puppy:v1',
      'lulu-capybara:v1',
      'nezuko:v1',
      'nezukocoder:v1',
      'snowy:v1',
      'trae:v2',
      'whale-girl:v1',
      'xiao-kun:v1',
      'yi-er:v1',
      'zodiac-pig:v1'
    ])
  })

  it('loads the offline built-in pet from a packaged resource root', async () => {
    const root = await temp()
    const packaged = path.join(root, 'Resources', 'pets')
    await mkdir(packaged, { recursive: true })
    const { cp } = await import('node:fs/promises')
    for (const id of ['xiao-kun', 'ikun', 'whale-girl']) {
      await cp(path.resolve('resources/pets', id), path.join(packaged, id), { recursive: true })
    }
    const validated = await validatePetPackage(path.join(packaged, 'xiao-kun'), 'xiao-kun')
    expect(validated).toMatchObject({ sourceId: 'xiao-kun', spriteVersionNumber: 1 })
    const store = new PetStore(path.join(root, 'user', 'pets'))
    await store.initialize()
    const report = await refreshPetLibraries({
      store,
      builtinRoot: resolveBuiltinPetsRoot({ packaged: true, resourcesPath: path.join(root, 'Resources'), appPath: '/missing-source' }),
      localRoot: path.join(root, 'user', 'pets', 'local'),
      codexHome: path.join(root, 'no-codex'),
      importCodexPets: false
    })
    expect(report.imported.map((pet) => pet.sourceId)).toContain('xiao-kun')
    expect(store.listPets()).toContainEqual(expect.objectContaining({
      id: 'kun:ikun', displayName: 'iKun', source: 'kun-builtin', available: true
    }))
    expect(store.listPets()).toContainEqual(expect.objectContaining({
      id: 'kun:whale-girl', displayName: '鲸鱼娘', source: 'kun-builtin', spriteVersionNumber: 1, available: true
    }))
    await store.applyFirstRunDefault(true)
    expect(store.getSettings()).toMatchObject({ selectedPetId: 'kun:xiao-kun', overlayOpen: true })
    expect(store.assetPath(petIdForSource('kun-builtin', 'xiao-kun'))).toBeTruthy()
    expect(store.assetPath(petIdForSource('kun-builtin', 'ikun'))).toBeTruthy()
    const whaleGirlAsset = await readPetAsset(
      'kun-pet://asset/kun%3Awhale-girl/spritesheet?v=1',
      (petId) => store.assetPath(petId),
      store.libraryRoot()
    )
    expect(whaleGirlAsset.status).toBe(200)
    expect(whaleGirlAsset.headers.get('Content-Type')).toBe('image/webp')
    expect((await whaleGirlAsset.arrayBuffer()).byteLength).toBeGreaterThan(0)
    await store.selectPet('kun:whale-girl')
    const restarted = new PetStore(path.join(root, 'user', 'pets'))
    await restarted.initialize()
    await restarted.applyFirstRunDefault(true)
    expect(restarted.getSettings()).toMatchObject({ selectedPetId: 'kun:whale-girl', overlayOpen: true })
  })

  it('finds Codex pets through CODEX_HOME and packaged resource roots', () => {
    expect(detectCodexHome({ CODEX_HOME: '/tmp/中文 pets' }, '/Users/me')).toBe(path.resolve('/tmp/中文 pets'))
    expect(detectCodexHome({}, '/Users/me')).toBe(path.join('/Users/me', '.codex'))
    expect(resolveBuiltinPetsRoot({ packaged: false, resourcesPath: '/app/resources', appPath: '/src' })).toBe(path.join('/src', 'resources', 'pets'))
    expect(resolveBuiltinPetsRoot({ packaged: true, resourcesPath: '/app/resources', appPath: '/src' })).toBe(path.join('/app/resources', 'pets'))
  })
})

async function temp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'kun-pets-'))
  roots.push(root)
  return root
}

async function writePackage(dir: string, id: string, image: Buffer, version = 1): Promise<void> {
  await mkdir(dir, { recursive: true })
  const extension = version === 2 ? 'png' : 'png'
  await writeFile(path.join(dir, `spritesheet.${extension}`), image)
  await writeFile(path.join(dir, 'pet.json'), JSON.stringify({
    id,
    displayName: id,
    description: 'A test pet',
    spritesheetPath: `spritesheet.${extension}`,
    ...(version === 1 ? {} : { spriteVersionNumber: version })
  }))
}

function solid(width: number, height: number): Buffer {
  return Buffer.alloc(width * height * 4, 255)
}
