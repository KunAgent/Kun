import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { createOwnedServiceManagerSession } from '../manager/owned-service-manager-session.js'
import { bindRuntimeManagerDataPlane } from '../manager/owned-manager-binding.js'
import { createSecretEncryptor, defaultSecretCommandRunner, hasPersistedSecretKeyMaterial } from '../security/secret-store.js'
import { ExtensionCredentialStore } from '../services/extension-credential-store.js'
import { ExtensionProviderAccountStore } from '../services/extension-provider-account-store.js'
import { ModelConnectionRegistry, isModelConnectionCredentialSourceId } from '../services/model-connection-registry.js'
import { LegacyProviderCredentialMigrationService, materializeLegacyProviderCredential } from '../services/legacy-provider-credential-migration.js'
import { DeepSeekAccountEvidenceStore } from '../gmail/deepseek-account-evidence.js'
import { assertGoogleWorkspaceModelEndpoint } from '../domain/google-workspace-model-policy.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'

/** Operator-only program. Stop the desktop first so Manager's sole-writer ownership can be reserved. */
export async function installConfiguredDeepSeekEvidence(input: {
  dataDir: string; controlDir?: string; settingsPath?: string; providerId?: string;
  source: 'user-confirmed-unified-account-opt-out'; checkedAt: string
}) {
  const owner = createOwnedServiceManagerSession({ ownerKind: 'cli' })
  try {
    const manager = await owner.ensure({ dataDir: resolve(input.dataDir), controlDir: input.controlDir,
      settingsPath: input.settingsPath, flavor: 'development', allowDevelopmentBootstrap: true })
    const options = { dataDir: input.dataDir }
    bindRuntimeManagerDataPlane(options, manager)
    await assertEncryptedGmailStorage(options.dataDir)
    const keyProvider = await createSecretEncryptor({ keyFilePath: join(options.dataDir, 'secret.key'),
      run: defaultSecretCommandRunner,
      canBootstrapKeyFileFallback: async () => !await hasPersistedSecretKeyMaterial(options.dataDir) })
    const credentials = new ExtensionCredentialStore({ dataDir: options.dataDir, profileId: 'default', keyProvider })
    const legacy = new LegacyProviderCredentialMigrationService({ dataDir: options.dataDir, credentials,
      accounts: new ExtensionProviderAccountStore({ dataDir: options.dataDir }) })
    const registry = new ModelConnectionRegistry({ dataDir: options.dataDir, credentials })
    const materialized = await registry.materializeReadOnly()
    const provider = input.providerId ? materialized.providers.get(input.providerId) : materialized.selected?.config
    if (!provider || provider.kind !== 'http' || !provider.baseUrl || provider.customEndpointProtocol) {
      throw new Error('Select a configured fixed direct DeepSeek API connection')
    }
    assertGoogleWorkspaceModelEndpoint(provider.endpoints?.chat_completions ?? provider.baseUrl,
      provider.endpointFormat ?? 'chat_completions')
    let apiKey = provider.apiKey.trim()
    if (provider.credentialSourceId) {
      const stored = isModelConnectionCredentialSourceId(provider.credentialSourceId)
        ? await registry.resolveApiKey(provider.credentialSourceId) : await legacy.resolveApiKey(provider.credentialSourceId)
      if (!stored) throw new Error('The current configured API credential is unavailable')
      apiKey = materializeLegacyProviderCredential(stored.apiKey).apiKey
    }
    return await new DeepSeekAccountEvidenceStore(options.dataDir, keyProvider.encryptor).install({
      apiKey, source: input.source, checkedAt: input.checkedAt })
  } finally { await owner.close() }
}

const executed = process.argv[1]?.endsWith('gmail-deepseek-evidence-entry.js')
if (executed) {
  const { values } = parseArgs({ options: {
    'data-dir': { type: 'string' }, 'control-dir': { type: 'string' }, 'settings-path': { type: 'string' },
    'provider-id': { type: 'string' }, source: { type: 'string' }, 'checked-at': { type: 'string' }
  }, strict: true })
  if (!values['data-dir'] || !values['checked-at'] || values.source !== 'user-confirmed-unified-account-opt-out') {
    console.error('Required: --data-dir, --checked-at and --source user-confirmed-unified-account-opt-out')
    process.exitCode = 1
  } else {
    installConfiguredDeepSeekEvidence({ dataDir: values['data-dir'], controlDir: values['control-dir'],
      settingsPath: values['settings-path'], providerId: values['provider-id'], source: values.source,
      checkedAt: values['checked-at'] }).then((result) => console.log(JSON.stringify(result))).catch(() => {
        console.error('DeepSeek account evidence was not installed. Check the configured fixed API connection and close the desktop before retrying.')
        process.exitCode = 1
      })
  }
}
