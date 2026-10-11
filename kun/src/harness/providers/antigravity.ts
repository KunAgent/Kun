import { join } from 'node:path'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { ANTIGRAVITY_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, HarnessLoginState, ProviderEnv } from './provider-module.js'
import type { HarnessLoginProbeDeps } from '../harness-login-probes.js'
import { antigravityCredentialEvidence } from '../antigravity-credentials.js'
import { homeOf, nonempty, probeProviderCredential, readJsonFile, readJsonObject } from './support.js'

export const ANTIGRAVITY_DEFINITION: HarnessDefinition = {
  id: 'antigravity',
  displayName: 'Antigravity',
  transport: 'antigravity-cli',
  // The supported one-shot protocol is exposed by `agy`, matching the
  // AntigravityCliRuntime launch command. The IDE launcher is not a turn
  // protocol and must not be mistaken for a ready agent.
  detect: { command: 'agy', aliases: [], versionArgs: ['--version'] },
  credentialModes: ['native-login'],
  permissionModes: [
    { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
    { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
  ],
  // agy lists the signed-in account's models itself (`agy models`).
  modelSource: 'probe',
  staticModels: [],
  capabilities: ANTIGRAVITY_CAPABILITIES,
  setup: {
    install: [
      { platform: 'darwin', command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
      { platform: 'linux', command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
      { platform: 'win32', command: 'irm https://antigravity.google/cli/install.ps1 | iex' }
    ],
    login: { command: 'agy', args: [] },
    docsUrl: 'https://antigravity.google/docs/cli/install/'
  },
  builtin: true
}

async function probeAntigravityLogin(deps: HarnessLoginProbeDeps, env: ProviderEnv): Promise<HarnessLoginState> {
  if (probeProviderCredential(deps.providers(), 'antigravity-cli') === 'unknown' ||
      nonempty(env.GOOGLE_API_KEY) || nonempty(env.GEMINI_API_KEY)) return 'unknown'
  const home = deps.homeDir ?? env.HOME ?? env.USERPROFILE ?? homeOf({})
  if ((await antigravityCredentialEvidence({ ...env, HOME: home }, {
    spawn: deps.spawnCaptured, signal: deps.signal
  })).configured) return 'unknown'
  const adcPath = env.GOOGLE_APPLICATION_CREDENTIALS ?? join(
    env.CLOUDSDK_CONFIG ?? join(home, '.config', 'gcloud'), 'application_default_credentials.json'
  )
  const adc = await readJsonFile(adcPath)
  return adc && (adc.type === 'authorized_user' || adc.type === 'service_account' || adc.type === 'external_account')
    ? 'unknown' : 'signed-out'
}

/** Google application default credentials with the fields a client actually needs. */
function adcConfigured(path: string): boolean {
  const value = readJsonObject(path)
  return (value.type === 'service_account' && typeof value.private_key === 'string' && typeof value.client_email === 'string') ||
    (value.type === 'authorized_user' && typeof value.refresh_token === 'string' && typeof value.client_id === 'string')
}

export const ANTIGRAVITY_MODULE: AgentProviderModule = {
  definition: ANTIGRAVITY_DEFINITION,
  credentials: {
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
    evidenceEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    pointerEnvKeys: ['CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'],
    files: (env, home) => [env.GOOGLE_APPLICATION_CREDENTIALS ||
      join(env.CLOUDSDK_CONFIG || join(home, '.config/gcloud'), 'application_default_credentials.json')],
    profileFiles: (_env, home) => [join(home, '.gemini', 'antigravity-cli', 'settings.json')],
    configured: (context) => (context.selected.GOOGLE_APPLICATION_CREDENTIALS
      ? [context.selected.GOOGLE_APPLICATION_CREDENTIALS] : context.files()).some(adcConfigured),
    snapshotEvidence: (env) => antigravityCredentialEvidence(env)
  },
  login: ({ deps, env }) => probeAntigravityLogin(deps, env),
  nativeAccount: { kind: 'antigravity-cli', credentialEnv: 'GEMINI_API_KEY', countsAsEvidence: true },
  binaryEnv: 'KUN_ANTIGRAVITY_BINARY',
  nativeNetwork: { transport: 'antigravity-cli', snapshotKey: 'antigravity' },
  update: { command: 'agy', nativeArgs: ['update'] }
}
