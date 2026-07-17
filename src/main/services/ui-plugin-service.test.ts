import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID } from '../../shared/ui-plugin'
import {
  installUiPluginFromDirectory,
  listUiPlugins,
  loadUiPluginFigures,
  removeUiPlugin,
  seedUiPlugin,
  uiPluginsRootDir
} from './ui-plugin-service'

/** 1x1 transparent PNG */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let userDataDir = ''
let sourceDir = ''

async function writeSourcePlugin(manifest: unknown, figures: string[] = ['img/swim.png']): Promise<void> {
  await mkdir(join(sourceDir, 'img'), { recursive: true })
  await writeFile(join(sourceDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  for (const figure of figures) {
    await mkdir(join(sourceDir, figure, '..'), { recursive: true })
    await writeFile(join(sourceDir, ...figure.split('/')), PNG_BYTES)
  }
}

const manifest = {
  id: 'starlight',
  name: '星夜',
  version: '1.0.0',
  figures: { swim: 'img/swim.png' }
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'kun-ui-plugin-data-'))
  sourceDir = await mkdtemp(join(tmpdir(), 'kun-ui-plugin-src-'))
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
  await rm(sourceDir, { recursive: true, force: true })
})

describe('installUiPluginFromDirectory', () => {
  it('installs a valid plugin by allowlist copy and lists it', async () => {
    await writeSourcePlugin(manifest)
    // 源目录里混入不该被复制的文件
    await writeFile(join(sourceDir, 'evil.js'), 'process.exit(1)', 'utf8')
    await writeFile(join(sourceDir, 'img', 'unreferenced.png'), PNG_BYTES)

    const result = await installUiPluginFromDirectory(userDataDir, sourceDir)
    expect(result.ok).toBe(true)

    const installedFiles = await readdir(join(uiPluginsRootDir(userDataDir), 'starlight'), {
      recursive: true
    })
    const flat = installedFiles.map(String).sort()
    expect(flat).toContain('manifest.json')
    expect(flat).toContain(join('img', 'swim.png'))
    expect(flat).not.toContain('evil.js')
    expect(flat.some((f) => f.includes('unreferenced'))).toBe(false)

    const plugins = await listUiPlugins(userDataDir)
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.manifest.id).toBe('starlight')
    expect(plugins[0]?.previewDataUrl?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('rejects manifests with missing figures or invalid content', async () => {
    await writeSourcePlugin({ ...manifest, figures: { swim: 'img/missing.png' } }, [])
    const missing = await installUiPluginFromDirectory(userDataDir, sourceDir)
    expect(missing.ok).toBe(false)

    await writeFile(join(sourceDir, 'manifest.json'), '{ not json', 'utf8')
    const invalid = await installUiPluginFromDirectory(userDataDir, sourceDir)
    expect(invalid.ok).toBe(false)
  })

  it('rejects the trusted bundled id without overwriting its existing directory', async () => {
    const bundled = await seedUiPlugin(
      userDataDir,
      {
        ...manifest,
        id: UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
        name: 'Bundled Shuimo Yijing'
      },
      { swim: PNG_BYTES }
    )
    expect(bundled.ok).toBe(true)

    await writeSourcePlugin({
      ...manifest,
      id: UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
      name: 'Impersonating plugin'
    })
    const result = await installUiPluginFromDirectory(userDataDir, sourceDir)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('; ')).toMatch(/bundled|预装/u)

    const loaded = await loadUiPluginFigures(
      userDataDir,
      UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID
    )
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.manifest.name).toBe('Bundled Shuimo Yijing')
  })
})

describe('loadUiPluginFigures', () => {
  it('returns data URLs for installed figures', async () => {
    await writeSourcePlugin(manifest)
    await installUiPluginFromDirectory(userDataDir, sourceDir)

    const result = await loadUiPluginFigures(userDataDir, 'starlight')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.figures.swim?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('refuses ids that escape the plugins root', async () => {
    const result = await loadUiPluginFigures(userDataDir, '../outside')
    expect(result.ok).toBe(false)
  })
})

describe('removeUiPlugin', () => {
  it('removes an installed plugin and refuses traversal ids', async () => {
    await writeSourcePlugin(manifest)
    await installUiPluginFromDirectory(userDataDir, sourceDir)

    expect(await removeUiPlugin(userDataDir, '../escape')).toBe(false)
    expect(await removeUiPlugin(userDataDir, 'starlight')).toBe(true)
    expect(await listUiPlugins(userDataDir)).toHaveLength(0)
  })
})

describe('seedUiPlugin (bundled plugins like ikun)', () => {
  it('allows the trusted host-effect plugin through the internal seed path', async () => {
    const result = await seedUiPlugin(
      userDataDir,
      {
        ...manifest,
        id: UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID,
        name: 'Bundled Shuimo Yijing'
      },
      { swim: PNG_BYTES }
    )

    expect(result.ok).toBe(true)
    const loaded = await loadUiPluginFigures(
      userDataDir,
      UI_PLUGIN_BUNDLED_SHUIMO_YIJING_ID
    )
    expect(loaded.ok).toBe(true)
  })

  it('seeds a plugin from in-memory bytes and it lists/loads like any other', async () => {
    const result = await seedUiPlugin(
      userDataDir,
      {
        id: 'ikun',
        name: 'iKun 模式',
        version: '1.0.0',
        figures: { swim: 'img/dribble.png', greet: 'img/wave.png' },
        features: { cameos: true }
      },
      { swim: PNG_BYTES, greet: PNG_BYTES }
    )
    expect(result.ok, JSON.stringify(result)).toBe(true)

    const plugins = await listUiPlugins(userDataDir)
    expect(plugins.map((p) => p.manifest.id)).toContain('ikun')

    const loaded = await loadUiPluginFigures(userDataDir, 'ikun')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.figures.swim?.startsWith('data:image/png;base64,')).toBe(true)
    expect(loaded.manifest.features?.cameos).toBe(true)
  })

  it('rejects seeding when figure bytes are missing', async () => {
    const result = await seedUiPlugin(
      userDataDir,
      { id: 'ikun', name: 'x', version: '1.0.0', figures: { swim: 'img/a.png' } },
      {}
    )
    expect(result.ok).toBe(false)
  })
})

describe('bundled starlight example', () => {
  it('installs and loads end to end', async () => {
    const exampleDir = join(process.cwd(), 'examples', 'ui-plugins', 'starlight')
    const installed = await installUiPluginFromDirectory(userDataDir, exampleDir)
    expect(installed.ok, JSON.stringify(installed)).toBe(true)

    const loaded = await loadUiPluginFigures(userDataDir, 'starlight')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.manifest.name).toBe('星夜 Kun')
    expect(loaded.figures.swim?.startsWith('data:image/png;base64,')).toBe(true)
    expect(loaded.manifest.features?.cameos).toBe(true)
    expect(loaded.manifest.tokens?.light?.['--ds-accent']).toBe('#7a5fd0')
  })
})

describe('listUiPlugins', () => {
  it('skips directories whose name does not match manifest id', async () => {
    await writeSourcePlugin(manifest)
    await installUiPluginFromDirectory(userDataDir, sourceDir)
    // 手工伪造一个目录名与 id 不一致的插件
    const fakeDir = join(uiPluginsRootDir(userDataDir), 'impostor')
    await mkdir(join(fakeDir, 'img'), { recursive: true })
    await writeFile(join(fakeDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    await writeFile(join(fakeDir, 'img', 'swim.png'), PNG_BYTES)

    const plugins = await listUiPlugins(userDataDir)
    expect(plugins.map((p) => p.manifest.id)).toEqual(['starlight'])
  })
})
