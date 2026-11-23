import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireToolchainDirectory } from './ppt-pptx-validation.js'

vi.mock('../../cli/npm-distribution.js', () => ({ isNpmDistribution: () => true }))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('npm optional toolchain profile', () => {
  it('does not infer a repository toolchain from the user workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-npm-resource-'))
    roots.push(root)
    await mkdir(join(root, 'resources', 'ppt-toolchain'), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    vi.stubEnv('KUN_PPT_TOOLCHAIN_DIR', '')
    await expect(requireToolchainDirectory({})).rejects.toThrow('not bundled with the npm distribution')
  })

  it('accepts a user-configured optional toolchain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-npm-explicit-resource-'))
    roots.push(root)
    vi.stubEnv('KUN_PPT_TOOLCHAIN_DIR', root)
    expect(await requireToolchainDirectory({})).toBe(root)
  })
})
