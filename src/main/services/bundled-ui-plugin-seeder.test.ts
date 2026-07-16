import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_SHUIMO_YIJING_MANIFEST,
  ensureBundledUiPlugins
} from '../ui-plugin-bundled'
import { normalizeUiPluginManifest } from '../../shared/ui-plugin'
import {
  createBundledUiPluginSeedGuard,
  seedBundledUiPluginOnce
} from './bundled-ui-plugin-seeder'
import { loadUiPluginFigures, uiPluginsRootDir } from './ui-plugin-service'

let kunHomeDir = ''

beforeEach(async () => {
  kunHomeDir = await mkdtemp(join(tmpdir(), 'kun-bundled-ui-plugin-'))
})

afterEach(async () => {
  await rm(kunHomeDir, { recursive: true, force: true })
})

function seedInput(seed: () => Promise<{ ok: true } | { ok: false; errors: string[] }>) {
  return {
    kunHomeDir,
    pluginId: 'shuimo-yijing',
    markerVersion: 1,
    seed
  }
}

describe('seedBundledUiPluginOnce', () => {
  it('seeds once and writes an independent version marker', async () => {
    const seed = vi.fn(async () => ({ ok: true as const }))

    expect(await seedBundledUiPluginOnce(seedInput(seed))).toBe('seeded')
    expect(seed).toHaveBeenCalledTimes(1)
    expect(
      await readFile(
        join(uiPluginsRootDir(kunHomeDir), '.bundled-shuimo-yijing-v1'),
        'utf8'
      )
    ).toBe('shuimo-yijing\n')

    expect(await seedBundledUiPluginOnce(seedInput(seed))).toBe('skipped')
    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('writes no marker after a thrown seed and retries later', async () => {
    const seed = vi
      .fn<() => Promise<{ ok: true }>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({ ok: true })

    await expect(seedBundledUiPluginOnce(seedInput(seed))).rejects.toThrow('temporary failure')
    await expect(
      readFile(join(uiPluginsRootDir(kunHomeDir), '.bundled-shuimo-yijing-v1'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await seedBundledUiPluginOnce(seedInput(seed))).toBe('seeded')
    expect(seed).toHaveBeenCalledTimes(2)
  })

  it('surfaces a failed seed result without writing a marker', async () => {
    const seed = vi
      .fn<() => Promise<{ ok: true } | { ok: false; errors: string[] }>>()
      .mockResolvedValueOnce({ ok: false, errors: ['invalid manifest'] })
      .mockResolvedValue({ ok: true })

    await expect(seedBundledUiPluginOnce(seedInput(seed))).rejects.toThrow('invalid manifest')
    await expect(
      readFile(join(uiPluginsRootDir(kunHomeDir), '.bundled-shuimo-yijing-v1'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await seedBundledUiPluginOnce(seedInput(seed))).toBe('seeded')
    expect(seed).toHaveBeenCalledTimes(2)
  })

  it('does not revive a plugin deleted after a successful seed', async () => {
    const seed = vi.fn(async () => ({ ok: true as const }))
    await seedBundledUiPluginOnce(seedInput(seed))
    await rm(join(uiPluginsRootDir(kunHomeDir), 'shuimo-yijing'), {
      recursive: true,
      force: true
    })

    expect(await seedBundledUiPluginOnce(seedInput(seed))).toBe('skipped')
    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('accepts the legacy iKun marker as an alias', async () => {
    const root = uiPluginsRootDir(kunHomeDir)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, '.bundled-seed-v1'), 'ikun\n', 'utf8')
    const seed = vi.fn(async () => ({ ok: true as const }))

    expect(
      await seedBundledUiPluginOnce({
        kunHomeDir,
        pluginId: 'ikun',
        markerVersion: 1,
        legacyMarkers: ['.bundled-seed-v1'],
        seed
      })
    ).toBe('skipped')
    expect(seed).not.toHaveBeenCalled()
  })
})

describe('createBundledUiPluginSeedGuard', () => {
  it('deduplicates concurrent calls and retains a successful promise', async () => {
    let resolveSeed: (() => void) | undefined
    const seed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSeed = resolve
        })
    )
    const ensureSeeded = createBundledUiPluginSeedGuard({ seed, onError: vi.fn() })

    const first = ensureSeeded(kunHomeDir)
    const second = ensureSeeded(kunHomeDir)
    expect(second).toBe(first)
    expect(seed).toHaveBeenCalledTimes(1)
    resolveSeed?.()
    await first

    expect(ensureSeeded(kunHomeDir)).toBe(first)
    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('isolates plugin failures and retries only the failed guard', async () => {
    const failedSeed = vi
      .fn<(kunHomeDir: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined)
    const healthySeed = vi.fn(async () => undefined)
    const onError = vi.fn()
    const ensureFailed = createBundledUiPluginSeedGuard({ seed: failedSeed, onError })
    const ensureHealthy = createBundledUiPluginSeedGuard({ seed: healthySeed, onError })

    await Promise.all([ensureFailed(kunHomeDir), ensureHealthy(kunHomeDir)])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'temporary failure' }))
    expect(healthySeed).toHaveBeenCalledTimes(1)

    await Promise.all([ensureFailed(kunHomeDir), ensureHealthy(kunHomeDir)])
    expect(failedSeed).toHaveBeenCalledTimes(2)
    expect(healthySeed).toHaveBeenCalledTimes(1)
  })
})

describe('bundled shuimo yijing manifest', () => {
  it('normalizes through the declarative v1 schema with exactly 60 tokens', () => {
    const result = normalizeUiPluginManifest(BUNDLED_SHUIMO_YIJING_MANIFEST)

    expect(result.ok, result.ok ? undefined : result.errors.join('; ')).toBe(true)
    if (!result.ok) return
    expect(result.manifest.tokens?.light).toEqual(
      BUNDLED_SHUIMO_YIJING_MANIFEST.tokens.light
    )
    expect(result.manifest.tokens?.dark).toEqual(
      BUNDLED_SHUIMO_YIJING_MANIFEST.tokens.dark
    )
    expect(Object.keys(result.manifest.tokens?.light ?? {})).toHaveLength(30)
    expect(Object.keys(result.manifest.tokens?.dark ?? {})).toHaveLength(30)
    expect(
      Object.keys(result.manifest.tokens?.light ?? {}).length +
        Object.keys(result.manifest.tokens?.dark ?? {}).length
    ).toBe(60)
  })

  it('reuses one image for the approved slots and disables cameos', () => {
    expect(BUNDLED_SHUIMO_YIJING_MANIFEST.figures).toEqual({
      swim: 'img/shuimo-yijing-kun.png',
      greet: 'img/shuimo-yijing-kun.png',
      toggleIcon: 'img/shuimo-yijing-kun.png'
    })
    expect(BUNDLED_SHUIMO_YIJING_MANIFEST.features.cameos).toBe(false)
    expect(BUNDLED_SHUIMO_YIJING_MANIFEST).not.toHaveProperty('hostEffect')
  })

  it('seeds iKun and Shuimo Yijing independently through the internal path', async () => {
    await ensureBundledUiPlugins(kunHomeDir)

    const root = uiPluginsRootDir(kunHomeDir)
    expect(await readFile(join(root, '.bundled-ikun-v1'), 'utf8')).toBe('ikun\n')
    expect(await readFile(join(root, '.bundled-shuimo-yijing-v1'), 'utf8')).toBe(
      'shuimo-yijing\n'
    )

    const ikun = await loadUiPluginFigures(kunHomeDir, 'ikun')
    const shuimo = await loadUiPluginFigures(kunHomeDir, 'shuimo-yijing')
    expect(ikun.ok).toBe(true)
    expect(shuimo.ok).toBe(true)
    if (!shuimo.ok) return
    expect(Object.keys(shuimo.figures).sort()).toEqual(['greet', 'swim', 'toggleIcon'])
    expect(shuimo.figures.swim).toBe(shuimo.figures.greet)
    expect(shuimo.figures.swim).toBe(shuimo.figures.toggleIcon)
  })
})
