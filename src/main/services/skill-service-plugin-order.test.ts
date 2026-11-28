import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { guiSkillRootsForRuntime, isCodexPluginCacheRoot } from './skill-service'

const fixture = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => fixture.home || actual.homedir() }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

it('keeps plugin root precedence stable when parallel directory reads finish in reverse order', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const home = await mkdtemp(join(tmpdir(), 'kun-plugin-order-'))
  fixture.home = home
  const cache = join(home, '.codex', 'plugins', 'cache')
  const alpha = join(cache, 'alpha', '1', 'skills')
  const beta = join(cache, 'beta', '1', 'skills')
  let releaseAlpha!: () => void
  let sawBeta!: () => void
  const alphaGate = new Promise<void>(resolve => { releaseAlpha = resolve })
  const betaRead = new Promise<void>(resolve => { sawBeta = resolve })
  try {
    for (const root of [alpha, beta]) {
      await mkdir(join(root, 'demo'), { recursive: true })
      await writeFile(join(root, 'demo', 'SKILL.md'), '---\nname: demo\n---\nFixture.\n')
    }
    vi.mocked(readdir).mockImplementation(async (...args: Parameters<typeof actual.readdir>) => {
      if (String(args[0]) === join(cache, 'alpha')) await alphaGate
      const entries = await actual.readdir(...args)
      if (String(args[0]) === join(cache, 'beta', '1')) sawBeta()
      return entries
    })
    const settings = normalizeAppSettings({} as AppSettingsV1)
    const pending = guiSkillRootsForRuntime(settings, join(home, 'workspace'))
    await betaRead
    await new Promise<void>(resolve => setImmediate(resolve))
    releaseAlpha()
    const roots = (await pending).map(root => root.path).filter(isCodexPluginCacheRoot)
    expect(roots).toEqual([alpha, beta])
  } finally {
    releaseAlpha()
    vi.mocked(readdir).mockImplementation(actual.readdir)
    fixture.home = ''
    await rm(home, { recursive: true, force: true })
  }
})
