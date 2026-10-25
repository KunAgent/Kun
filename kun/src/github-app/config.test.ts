import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { GitHubAppConfigSchema } from './config.js'
import { CONFIG } from './github-app.test-support.js'

const { prepareGitHubAppResource } = createRequire(import.meta.url)('../../../scripts/prepare-github-app-resource.cjs')
describe('GitHub publisher configuration', () => {
  it('accepts only the fixed Kun app and callback, rejecting private keys and arbitrary destinations', () => {
    expect(GitHubAppConfigSchema.parse(CONFIG).callbackUrl).toBe(CONFIG.callbackUrl)
    for (const patch of [{ privateKey: 'never-distribute' }, { clientId: 'another-app' },
      { callbackUrl: 'https://attacker.test/callback' }, { slug: 'another-app' }]) {
      expect(GitHubAppConfigSchema.safeParse({ ...CONFIG, ...patch }).success).toBe(false)
    }
  })
  it('packages publisher configuration from outside Git and removes stale credentials from disabled builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-github-package-'))
    const projectDir = join(root, 'project'), sourcePath = join(root, 'private-client.json')
    await mkdir(projectDir); await writeFile(sourcePath, JSON.stringify(CONFIG))
    const input = { projectDir, sourcePath, enabled: '1' }
    const loadSchema = async () => GitHubAppConfigSchema
    const resource = join(projectDir, 'kun/dist/resources/github-app-client.json')
    try {
      expect(await prepareGitHubAppResource(input, { loadSchema })).toMatchObject({ enabled: true })
      expect(JSON.parse(await readFile(resource, 'utf8'))).toEqual(CONFIG)
      await prepareGitHubAppResource({ ...input, enabled: '0' }, { loadSchema })
      await expect(readFile(resource)).rejects.toMatchObject({ code: 'ENOENT' })
      const unsafe = join(projectDir, 'client.json'); await writeFile(unsafe, JSON.stringify(CONFIG))
      await expect(prepareGitHubAppResource({ ...input, sourcePath: unsafe }, { loadSchema })).rejects.toThrow('outside Git')
      await writeFile(sourcePath, JSON.stringify({ ...CONFIG, privateKey: 'fixture-private-key' }))
      await expect(prepareGitHubAppResource(input, { loadSchema })).rejects.toThrow('configuration failed')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
