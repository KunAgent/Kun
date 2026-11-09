import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAnalyticsInstallation, emptyAnalyticsState } from './storage'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-installation-'))
  roots.push(root)
  return { root, userData: join(root, 'Kun'), runtime: join(root, '.kun') }
}

describe('installation detection before window creation', () => {
  it('captures a fresh installation without creating any data or enabling analytics', async () => {
    const { userData, runtime } = await fixture()
    const installation = await detectAnalyticsInstallation(userData, runtime)
    expect(installation).toBe('fresh')
    expect(emptyAnalyticsState()).toMatchObject({ installation: 'fresh', enabled: false })
    // Chromium creates this after the captured result is passed to startup.
    await mkdir(join(userData, 'Local Storage'), { recursive: true })
    expect(installation).toBe('fresh')
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('existing')
  })

  it.each(['kun-settings.json', 'deepseek-gui-settings.json', 'kun-account', 'Local Storage', 'pets'])(
    'preserves installations with %s even if the contents are invalid', async (name) => {
    const { userData, runtime } = await fixture()
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, name), '{broken')
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('existing')
    })

  it('recognizes legacy profiles, runtime data, and shared production settings', async () => {
    const { root, userData, runtime } = await fixture()
    const legacy = join(root, 'DeepSeek GUI')
    await mkdir(legacy)
    await writeFile(join(legacy, 'deepseek-gui-settings.json'), '{}')
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('existing')
    await rm(legacy, { recursive: true })
    await mkdir(runtime)
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('existing')
    await rm(runtime, { recursive: true })
    const production = join(userData, 'kun-settings.json')
    await mkdir(userData)
    await writeFile(production, '{}')
    expect(await detectAnalyticsInstallation(join(root, 'Kun DV'), runtime, [production])).toBe('existing')
    const legacyRuntime = join(root, '.deepseekgui')
    await mkdir(legacyRuntime)
    expect(await detectAnalyticsInstallation(join(root, 'Kun DV'), runtime, [legacyRuntime])).toBe('existing')
  })

  it('does not treat a dangling settings link or a read error as a new installation', async () => {
    const { root, userData, runtime } = await fixture()
    await mkdir(userData)
    await symlink(join(root, 'missing'), join(userData, 'kun-settings.json'))
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('existing')
    await rm(userData, { recursive: true })
    await writeFile(userData, 'not a directory')
    expect(await detectAnalyticsInstallation(userData, runtime)).toBe('unknown')
  })
})
