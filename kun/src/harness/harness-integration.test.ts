import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import { harnessIntegrationInfo, resolveHarnessIntegrationTarget } from './harness-integration.js'
import { APPLICATION_HARNESSES } from './application-harnesses.js'
import { HarnessDetector } from './harness-detector.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const home = await mkdtemp(join(tmpdir(), 'kun-app-integration-')); roots.push(home); return home }
const base = APPLICATION_HARNESSES.find((definition) => definition.id === 'cursor-local')!

it('distinguishes configuration presence from installation and never invokes a GUI version probe', async () => {
  const home = await fixture()
  await mkdir(join(home, '.cursor'), { recursive: true }); await writeFile(join(home, '.cursor', 'cli-config.json'), '{}')
  const definition = { ...base, application: { ...base.application!, locations: [] } }
  const info = await harnessIntegrationInfo(definition, { home, platform: 'darwin', env: {} })
  expect(info.application).toBeUndefined()
  expect(info.configurations.some((target) => target.exists)).toBe(true)
  const spawnCaptured = vi.fn()
  const detector = new HarnessDetector({ definitions: () => [definition], overrides: () => ({}), spawnCaptured,
    probeLogin: vi.fn(async () => 'not-required' as const), resolveExecutable: vi.fn(async () => undefined), nowMs: Date.now, nowIso: () => new Date().toISOString() })
  expect(await detector.status(definition.id)).toMatchObject({ installed: 'no', login: 'not-required' })
  expect(spawnCaptured).not.toHaveBeenCalled()
})

it('opens only the exact installed product and retains static configuration indices', async () => {
  const home = await fixture(), path = join(home, 'Applications', 'Cursor.app')
  const local = { ...base, application: { ...base.application!, locations: [{ platform: 'darwin' as const, root: 'home' as const, path: 'Applications/Cursor.app' }] } }
  const dir = join(path, 'Contents/Resources/app'); await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'product.json'), JSON.stringify({ nameShort: 'Cursor' }))
  expect((await harnessIntegrationInfo(local, { home, platform: 'darwin', env: {} })).application).toBeUndefined()
  await writeFile(join(dir, 'product.json'), JSON.stringify({ nameShort: 'Cursor Private Inference' }))
  expect((await harnessIntegrationInfo(local, { home, platform: 'darwin', env: {} })).application?.path).toBe(path)
  expect(await resolveHarnessIntegrationTarget(local, { harnessId: base.id, action: 'application' }, { home, platform: 'darwin', env: {} })).toMatchObject({ path, exists: true })
  expect(await resolveHarnessIntegrationTarget(local, { harnessId: base.id, action: 'configuration', index: 15 }, { home, platform: 'darwin', env: {} })).toBeUndefined()
})

it('rejects paths outside declared roots and opens unknown config formats as directories', async () => {
  for (const path of ['../outside', '/absolute', '\\outside', 'C:/outside', 'a/../../outside']) {
    expect(HarnessDefinitionSchema.safeParse({ ...base, application: { ...base.application!, locations: [{ platform: 'any', root: 'home', path }] } }).success).toBe(false)
  }
  const home = await fixture(); await writeFile(join(home, 'settings.db'), 'native database')
  const definition = { ...base, application: { ...base.application!, locations: [], configLocations: [{ platform: 'any' as const, root: 'home' as const, path: 'settings.db' }] } }
  expect(await resolveHarnessIntegrationTarget(definition, { harnessId: base.id, action: 'configuration' }, { home, env: {} }))
    .toMatchObject({ path: home, kind: 'directory', exists: true })
})
