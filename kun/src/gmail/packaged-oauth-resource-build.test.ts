import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDownloadedGmailOAuthClient, parsePackagedGmailOAuthClient } from './oauth-client-config.js'
import { KUN_GMAIL_CLIENT_ID } from './ports.js'

const require = createRequire(import.meta.url)
const { prepareGmailNativeResource, RESOURCE_PATH } = require('../../../scripts/prepare-gmail-native-resource.cjs') as {
  RESOURCE_PATH: string[];
  prepareGmailNativeResource: (input: { projectDir: string; platform: string; enabled?: string; sourcePath?: string },
    dependencies: { loadSchemas: () => Promise<{ parseDownloadedGmailOAuthClient: typeof parseDownloadedGmailOAuthClient;
      parsePackagedGmailOAuthClient: typeof parsePackagedGmailOAuthClient }> }) => Promise<{ enabled: boolean; clientId?: string }>
}
const schemas = { loadSchemas: async () => ({ parseDownloadedGmailOAuthClient, parsePackagedGmailOAuthClient }) }
const SOURCE = { installed: { client_id: KUN_GMAIL_CLIENT_ID, client_secret: 'fake-publisher-build-credential' } }

describe('publisher-owned Gmail package build hook', () => {
  it('generates only the fixed native resource for an explicitly enabled macOS package', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-gmail-package-build-'))
    const projectDir = join(directory, 'checkout')
    const sourcePath = join(directory, 'private-desktop-client.json')
    try {
      await mkdir(projectDir)
      await writeFile(sourcePath, JSON.stringify(SOURCE))
      expect(await prepareGmailNativeResource({ projectDir, platform: 'darwin', enabled: '1', sourcePath }, schemas))
        .toEqual({ enabled: true, clientId: KUN_GMAIL_CLIENT_ID })
      const resource = JSON.parse(await readFile(join(projectDir, ...RESOURCE_PATH), 'utf8'))
      if (process.platform !== 'win32') expect((await stat(join(projectDir, ...RESOURCE_PATH))).mode & 0o444).toBe(0o444)
      expect(resource).toEqual({ schemaVersion: 1, distribution: 'kun-desktop-macos',
        clientId: KUN_GMAIL_CLIENT_ID, clientSecret: SOURCE.installed.client_secret })
      expect(await readFile(sourcePath, 'utf8')).toBe(JSON.stringify(SOURCE))
      expect(await prepareGmailNativeResource({ projectDir, platform: 'darwin' }, schemas)).toEqual({ enabled: false })
      await expect(readFile(join(projectDir, ...RESOURCE_PATH))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects absent, wrong-client, oversize, linked, in-repo and non-macOS inputs with credential-safe errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-gmail-package-build-invalid-'))
    const projectDir = join(directory, 'checkout')
    const sourcePath = join(directory, 'private-client.json')
    try {
      await mkdir(projectDir)
      const valid = { projectDir, platform: 'darwin', enabled: '1', sourcePath }
      for (const value of [{}, { web: SOURCE.installed }, { installed: { ...SOURCE.installed, client_id: 'OTHER_CLIENT' } }]) {
        await writeFile(sourcePath, JSON.stringify(value))
        const failure = await prepareGmailNativeResource(valid, schemas).catch((error: unknown) => error)
        expect(String(failure)).toContain('Gmail package configuration failed')
        expect(String(failure)).not.toContain(SOURCE.installed.client_secret)
        expect(String(failure)).not.toContain(sourcePath)
      }
      await writeFile(sourcePath, ' '.repeat(16_385))
      await expect(prepareGmailNativeResource(valid, schemas)).rejects.toThrow('Gmail package configuration failed')
      await writeFile(sourcePath, JSON.stringify(SOURCE))
      await symlink(sourcePath, join(directory, 'redirect.json'))
      await writeFile(join(projectDir, 'client.json'), JSON.stringify(SOURCE))
      await symlink(projectDir, join(directory, 'checkout-alias'))
      for (const input of [{ ...valid, sourcePath: undefined }, { ...valid, platform: 'win32' }, { ...valid, enabled: 'yes' },
        { ...valid, sourcePath: join(directory, 'redirect.json') }, { ...valid, sourcePath: join(projectDir, 'client.json') },
        { ...valid, sourcePath: join(directory, 'checkout-alias', 'client.json') }]) {
        await expect(prepareGmailNativeResource(input, schemas)).rejects.toThrow('Gmail package configuration failed')
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not write generated credentials through a substituted resources directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-gmail-package-linked-'))
    const projectDir = join(directory, 'checkout')
    const outside = join(directory, 'outside')
    const sourcePath = join(directory, 'private-client.json')
    try {
      await mkdir(join(projectDir, 'kun', 'dist'), { recursive: true })
      await mkdir(outside)
      await symlink(outside, join(projectDir, 'kun', 'dist', 'resources'))
      await writeFile(sourcePath, JSON.stringify(SOURCE))
      await expect(prepareGmailNativeResource({ projectDir, platform: 'darwin', enabled: '1', sourcePath }, schemas))
        .rejects.toThrow('Gmail package configuration failed')
      await expect(readFile(join(outside, 'gmail-native-client.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      await rm(join(projectDir, 'kun', 'dist'), { recursive: true, force: true })
      await symlink(outside, join(projectDir, 'kun', 'dist'))
      await mkdir(join(outside, 'resources'))
      const sentinel = join(outside, 'resources', 'gmail-native-client.json')
      await writeFile(sentinel, 'outside sentinel')
      for (const enabled of ['1', '0']) {
        await expect(prepareGmailNativeResource({ projectDir, platform: 'darwin', enabled, sourcePath }, schemas))
          .rejects.toThrow('Gmail package configuration failed')
        expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
