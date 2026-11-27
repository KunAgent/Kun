import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveKuroCatContour } from '../../shared/pets-kurocat'
import { decodePetImage } from './pet-image'
import { refreshPetLibraries } from './pet-importer'
import {
  detectKurocatDataDir,
  readKurocatBlackOverride,
  readKurocatUserPrefs
} from './pet-kurocat-importer'
import { PetStore } from './pet-store'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('KuroCat local user data & plugin importer', () => {
  it('resolves KuroCat app-data paths across macOS, Windows, Linux, and KUROCAT_HOME override', () => {
    expect(detectKurocatDataDir({}, 'darwin', '/Users/alice')).toBe(
      path.join('/Users/alice', 'Library', 'Application Support', 'kuro-cat-pet')
    )
    expect(detectKurocatDataDir({ APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }, 'win32', 'C:\\Users\\alice')).toBe(
      path.join('C:\\Users\\alice\\AppData\\Roaming', 'kuro-cat-pet')
    )
    expect(detectKurocatDataDir({ XDG_CONFIG_HOME: '/home/alice/.cfg' }, 'linux', '/home/alice')).toBe(
      path.join('/home/alice/.cfg', 'kuro-cat-pet')
    )
    expect(detectKurocatDataDir({ KUROCAT_HOME: '/custom/kuro-dir' }, 'darwin', '/Users/alice')).toBe(
      path.resolve('/custom/kuro-dir')
    )
  })

  it('imports cats.json, companion breeds, plugin subfolders, Kun local JSON plugins, user settings.json, and black override', async () => {
    const root = await makeTempDir('kun-kurocat-test-')
    const userData = path.join(root, 'kun-data', 'pets')
    const builtinRoot = path.join(root, 'builtin')
    const localRoot = path.join(root, 'kun-data', 'local')
    const codexHome = path.join(root, 'codex')
    const kurocatHome = path.join(root, 'kuro-cat-pet')

    await fs.mkdir(builtinRoot, { recursive: true })
    await fs.mkdir(localRoot, { recursive: true })
    await fs.mkdir(path.join(kurocatHome, 'plugins', 'cyber-neko'), { recursive: true })

    // 1. User's kuro-cat-pet/cats.json with overridden black, customized ragdoll, and MCP snake_case Tibetan fox
    await fs.writeFile(path.join(kurocatHome, 'cats.json'), JSON.stringify([
      {
        id: 'black',
        name: '夜礼服小黑',
        builtin: true,
        pattern: 'tuxedo',
        furColor: '#12121a',
        bellyBibColor: '#f8fafc',
        eyeColorTop: '#fde047',
        noseColor: '#fb7185',
        accentColor: '#38bdf8'
      },
      {
        id: 'ragdoll',
        name: '焦糖布偶',
        builtin: true,
        pattern: 'siamese',
        furColor: '#fdf8f3',
        maskColor: '#5c4033',
        eyeColorTop: '#60a5fa',
        noseColor: '#f4a4b4',
        accentColor: '#7ac7ff'
      },
      {
        id: 'tibetan-fox',
        name: '藏狐大王',
        pattern: 'bicolor',
        coat_color: '#c9995a',
        marking_color: '#8f6331',
        belly_color: '#f5efe6',
        eye_color: '#eab308',
        nose_color: '#3f2e21',
        accent_color: '#f59e0b',
        face_shape: 'fox',
        face_width: 1.30,
        eye_size: 0.72,
        pupil_shape: 'star',
        spots: [{ part: 'head', x: 0.1, y: -0.3, rx: 10, ry: 6, color: '#784c20' }]
      }
    ]), 'utf8')

    // 2. Standalone KuroCat plugin pack inside kuro-cat-pet/plugins/cyber-neko/skin.json
    await fs.writeFile(path.join(kurocatHome, 'plugins', 'cyber-neko', 'skin.json'), JSON.stringify({
      skin: {
        id: 'neon-cyber-cat',
        name: '赛博霓虹喵',
        pattern: 'tabby',
        furColor: '#1e1b4b',
        stripeColor: '#22d3ee',
        eyeColorTop: '#f43f5e',
        pupilShape: 'star',
        tailFluffy: true
      }
    }), 'utf8')

    // 3. Malformed JSON in kuro-cat-pet/plugins/broken.json should be isolated in report.failed
    await fs.writeFile(path.join(kurocatHome, 'plugins', 'broken.json'), '{ invalid json', 'utf8')

    // 4. KuroCat settings.json (snake_case & camelCase mixed)
    await fs.writeFile(path.join(kurocatHome, 'settings.json'), JSON.stringify({
      keyboard_layout: '108',
      keyboard_orientation: 'user',
      tail_key_mode: 'custom',
      tail_key_ids: ['space', 'enter'],
      show_key_bubbles: true,
      collar_color: 'pink',
      headphone_mode: 'on',
      opacity: 0.92
    }), 'utf8')

    // 5. Drop a KuroCat skin JSON directly into Kun's own pets/local/ folder too
    await fs.writeFile(path.join(localRoot, 'sakura-mochi.json'), JSON.stringify({
      id: 'sakura-mochi',
      name: '樱花麻薯喵',
      pattern: 'solid',
      furColor: '#ffe4e6',
      eyeColorTop: '#ec4899',
      pupilShape: 'round'
    }), 'utf8')

    const store = new PetStore(userData)
    await store.initialize()

    const report = await refreshPetLibraries({
      store,
      builtinRoot,
      localRoot,
      codexHome,
      importCodexPets: false,
      kurocatHome,
      importKurocatPets: true
    })

    expect(report.sourceStates.kurocat).toBe('ok')
    expect(report.failed.some((f) => f.sourcePath.endsWith('broken.json'))).toBe(true)

    const summaries = store.listPets()
    const ids = summaries.map((s) => s.id)
    // Built-in KuroCat companion breeds + custom cats + plugin pack + Kun local JSON plugin
    expect(ids).toContain('kurocat:ragdoll')
    expect(ids).toContain('kurocat:orange-tabby')
    expect(ids).toContain('kurocat:calico')
    expect(ids).toContain('kurocat:tuxedo')
    expect(ids).toContain('kurocat:siamese')
    expect(ids).toContain('kurocat:tibetan-fox')
    expect(ids).toContain('kurocat:neon-cyber-cat')
    expect(ids).toContain('kun-local:sakura-mochi')

    const fox = summaries.find((s) => s.id === 'kurocat:tibetan-fox')!
    expect(fox.displayName).toBe('藏狐大王')
    const contour = resolveKuroCatContour(fox.kurocatSkin)
    expect(contour.faceShape).toBe('fox')
    expect(contour.headWidth).toBeCloseTo(1.30)
    expect(contour.pupilShape).toBe('star')
    expect(fox.kurocatSkin?.spots).toHaveLength(1)

    const ragdoll = summaries.find((s) => s.id === 'kurocat:ragdoll')!
    expect(ragdoll.displayName).toBe('焦糖布偶')

    // Preview spritesheet PNG generated for imported KuroCat skin is valid 1536x1872 RGBA
    const sheetPath = store.assetPath('kurocat:tibetan-fox')
    expect(sheetPath).toBeTruthy()
    const pngBytes = await fs.readFile(sheetPath!)
    const decoded = await decodePetImage(pngBytes)
    expect(decoded.width).toBe(1536)
    expect(decoded.height).toBe(1872)

    // User preferences & black override read cleanly
    const prefs = await readKurocatUserPrefs(kurocatHome)
    expect(prefs).toMatchObject({
      keyboardLayout: '108',
      keyboardOrientation: 'viewer',
      tailKeyMode: 'custom',
      tailKeyIds: ['space', 'enter'],
      collarColor: 'pink',
      headphoneMode: 'on',
      opacity: 0.92
    })
    const blackOverride = await readKurocatBlackOverride(kurocatHome)
    expect(blackOverride?.name).toBe('夜礼服小黑')
    expect(blackOverride?.pattern).toBe('tuxedo')

    // Toggling importKurocatPets off hides kurocat-custom pets while keeping kun-local JSON plugins
    await store.setImportPreferences({ importKurocatPets: false })
    const filtered = store.listPets()
    expect(filtered.some((s) => s.source === 'kurocat-custom')).toBe(false)
    expect(filtered.some((s) => s.id === 'kun-local:sakura-mochi')).toBe(true)
  })
})
