import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSecretEncryptor } from '../../kun/src/security/secret-store.js'
import { ExtensionCredentialStore } from '../../kun/src/services/extension-credential-store.js'
import { ModelConnectionRegistry } from '../../kun/src/services/model-connection-registry.js'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings
} from '../shared/app-settings'
import { LegacyProviderSettingsMigrationCoordinator } from './legacy-provider-settings-migration'
import { JsonSettingsStore } from './settings-store'
import { legacyCredentialSettingsBackupPath } from './settings-store-foundation'

describe('legacy provider credential key-loss recovery', () => {
  it('re-encrypts an unreadable Registry credential from the protected update backup', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-key-loss-update-'))
    const dataDir = join(userDataDir, 'runtime-data')
    const keyPath = join(dataDir, 'secret.key')
    const credential = 'provider-key-that-must-survive-update'
    try {
      const store = new JsonSettingsStore(userDataDir)
      const defaults = await store.load()
      const provider = defaultModelProviderSettings()
      const settings = {
        ...defaults,
        provider,
        agents: {
          kun: {
            ...defaultKunRuntimeSettings(),
            dataDir,
            providerId: 'deepseek',
            model: 'deepseek-chat'
          }
        }
      }
      await store.save(settings)
      const backupSettings = {
        ...settings,
        provider: {
          ...provider,
          apiKey: credential,
          providers: provider.providers.map((entry) =>
            entry.id === 'deepseek' ? { ...entry, apiKey: credential } : entry
          )
        }
      }
      await writeFile(
        legacyCredentialSettingsBackupPath(join(userDataDir, 'kun-settings.json')),
        JSON.stringify(backupSettings),
        { mode: 0o600 }
      )

      const originalKey = randomBytes(32)
      await mkdir(dataDir, { recursive: true })
      await writeFile(keyPath, originalKey.toString('base64'), { mode: 0o600 })
      const originalKeyProvider = await createSecretEncryptor({
        keyFilePath: keyPath,
        disableOsKeychain: true
      })
      const originalCredentials = new ExtensionCredentialStore({
        dataDir,
        profileId: 'default',
        keyProvider: originalKeyProvider
      })
      const originalRegistry = new ModelConnectionRegistry({
        dataDir,
        credentials: originalCredentials
      })
      await originalRegistry.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential,
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: false
      })

      await writeFile(keyPath, randomBytes(32).toString('base64'), { mode: 0o600 })
      const unreadableKeyProvider = await createSecretEncryptor({
        keyFilePath: keyPath,
        disableOsKeychain: true
      })
      const unreadableRegistry = new ModelConnectionRegistry({
        dataDir,
        credentials: new ExtensionCredentialStore({
          dataDir,
          profileId: 'default',
          keyProvider: unreadableKeyProvider
        })
      })
      await expect(unreadableRegistry.snapshot()).resolves.toMatchObject({
        providers: [expect.objectContaining({
          id: 'deepseek',
          credentialStatus: 'unreadable'
        })]
      })
      const coordinator = new LegacyProviderSettingsMigrationCoordinator()
      await new JsonSettingsStore(userDataDir, {
        credentialMigration: coordinator
      }).load()

      const recoveredKeyProvider = await createSecretEncryptor({
        keyFilePath: keyPath,
        disableOsKeychain: true
      })
      const recoveredRegistry = new ModelConnectionRegistry({
        dataDir,
        credentials: new ExtensionCredentialStore({
          dataDir,
          profileId: 'default',
          keyProvider: recoveredKeyProvider
        })
      })
      await recoveredRegistry.initialize()
      await expect(recoveredRegistry.credentialStateForInternalConsumer('deepseek'))
        .resolves.toEqual({ authoritative: true, apiKey: credential })
      expect(await readFile(join(userDataDir, 'kun-settings.json'), 'utf8'))
        .not.toContain(credential)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
