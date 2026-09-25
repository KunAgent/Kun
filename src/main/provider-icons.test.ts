import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/default/userData' }
}))

import {
  importProviderIcon,
  providerIconDataUrl,
  providerIconsDir,
  pruneProviderIcons
} from './provider-icons'
import { normalizeAppSettings } from '../shared/app-settings'

let userData: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'kun-icons-'))
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'

describe('importProviderIcon', () => {
  it('stores a content-addressed icon and returns its iconId', async () => {
    const result = await importProviderIcon(
      { mime: 'image/png', dataBase64: png.toString('base64') },
      userData
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.iconId).toMatch(/^[0-9a-f]{32}\.png$/)
    const dataUrl = await providerIconDataUrl(result.iconId, userData)
    expect(dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('rejects unsupported mime types and oversized payloads', async () => {
    expect((await importProviderIcon({ mime: 'image/gif', dataBase64: 'AA==' }, userData)).ok).toBe(false)
    const big = Buffer.alloc(1024 * 1024 + 1, 1).toString('base64')
    expect((await importProviderIcon({ mime: 'image/png', dataBase64: big }, userData)).ok).toBe(false)
    expect((await importProviderIcon({ mime: 'image/png', dataBase64: '' }, userData)).ok).toBe(false)
  })

  it('sniffs SVG markup and rejects renamed binaries', async () => {
    const good = await importProviderIcon(
      { mime: 'image/svg+xml', dataBase64: Buffer.from(svg).toString('base64') },
      userData
    )
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.iconId).toMatch(/\.svg$/)

    const bad = await importProviderIcon(
      { mime: 'image/svg+xml', dataBase64: png.toString('base64') },
      userData
    )
    expect(bad.ok).toBe(false)
  })
})

describe('providerIconDataUrl', () => {
  it('rejects malformed icon ids (path traversal safe)', async () => {
    expect(await providerIconDataUrl('../etc/passwd', userData)).toBeNull()
    expect(await providerIconDataUrl('abc.png', userData)).toBeNull()
    expect(await providerIconDataUrl('deadbeef'.repeat(4) + '.gif', userData)).toBeNull()
  })
})

describe('pruneProviderIcons', () => {
  const settingsWithIcon = (iconId: string) =>
    normalizeAppSettings({ provider: { providers: [{ id: 'p1', iconId }] } } as never)

  it('keeps referenced and fresh icons, deletes stale unreferenced ones', async () => {
    const referenced = await importProviderIcon(
      { mime: 'image/png', dataBase64: png.toString('base64') },
      userData
    )
    if (!referenced.ok) throw new Error('icon import failed')
    const orphan = 'a'.repeat(32) + '.png'
    const dir = providerIconsDir(userData)
    await writeFile(join(dir, orphan), 'x')

    const now = Date.now()
    // Within the grace period nothing unreferenced is removed.
    await pruneProviderIcons(normalizeAppSettings({} as never), userData, now)
    expect(await providerIconDataUrl(orphan, userData)).not.toBeNull()

    // After the TTL, only the unreferenced icon is pruned.
    await pruneProviderIcons(settingsWithIcon(referenced.iconId), userData, now + 2 * 60 * 60 * 1_000)
    expect(await providerIconDataUrl(orphan, userData)).toBeNull()
    expect(await providerIconDataUrl(referenced.iconId, userData)).not.toBeNull()
  })
})
