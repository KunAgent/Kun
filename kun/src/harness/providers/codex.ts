import { join } from 'node:path'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { CODEX_APP_SERVER_MIN_VERSION } from '../../runtime/codex/codex-protocol.js'
import { ACP_DEFAULT_CAPABILITIES, CODEX_APP_SERVER_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, ProviderEnv } from './provider-module.js'
import { resolveCodexExecutable } from '../codex-executable.js'
import { codexConfig } from '../gateway-config-templates.js'
import { nonempty, readJsonObject } from './support.js'

export const CODEX_DEFINITION: HarnessDefinition = {
  id: 'codex',
  displayName: 'Codex',
  transport: 'codex-app-server',
  detect: {
    command: 'codex',
    aliases: [],
    versionArgs: ['--version'],
    minVersion: CODEX_APP_SERVER_MIN_VERSION
  },
  launch: { command: 'codex', args: ['app-server'], env: {} },
  // Explicit ACP remains for older configurations. It requires a separate
  // adapter; default native app-server uses the installed Codex CLI itself.
  variants: {
    acp: {
      launch: { command: 'codex-acp', args: [], env: {} },
      detect: {
        command: 'codex-acp',
        aliases: [],
        versionArgs: ['--version'],
        adapterHint: {
          command: 'codex',
          message: 'Codex ACP adapter codex-acp is missing'
        }
      },
      capabilities: ACP_DEFAULT_CAPABILITIES,
      setup: {
        install: [
          { platform: 'any', command: 'npm install -g @openai/codex' },
          { platform: 'darwin', command: 'brew install --cask codex' }
        ],
        login: { command: 'codex', args: ['login'] },
        adapter: {
          command: 'codex-acp',
          install: 'npm i -g @zed-industries/codex-acp'
        },
        docsUrl: 'https://github.com/openai/codex'
      }
    }
  },
  credentialModes: ['native-login', 'kun-gateway'],
  permissionModes: [
    // Product permission levels; Codex sandbox/approval policy is resolved
    // by the per-turn permission and sandbox settings.
    { id: 'read-only', label: 'Read only', kunPermissionMode: 'ask-for-approval' },
    { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' },
    { id: 'full-access', label: 'Full access', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  staticModels: [],
  historySource: 'codex',
  capabilities: CODEX_APP_SERVER_CAPABILITIES,
  // Generated CODEX_HOME/config.toml declares a `kun` responses provider
  // (verified against codex 0.145.0 via `codex doctor`, P3-10).
  gateway: {
    protocol: 'openai-responses',
    env: { baseUrl: 'KUN_GATEWAY_BASE_URL', token: 'KUN_GATEWAY_TOKEN' },
    stripEnv: [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'CODEX_HOME'
    ]
  },
  setup: {
    install: [
      { platform: 'any', command: 'npm install -g @openai/codex' },
      { platform: 'darwin', command: 'brew install --cask codex' }
    ],
    login: { command: 'codex', args: ['login'] },
    docsUrl: 'https://github.com/openai/codex'
  },
  builtin: true
}

const codexHome = (env: ProviderEnv, home: string): string => env.CODEX_HOME || join(home, '.codex')

export const CODEX_MODULE: AgentProviderModule = {
  definition: CODEX_DEFINITION,
  credentials: {
    envKeys: ['OPENAI_API_KEY'],
    evidenceEnvKeys: ['OPENAI_API_KEY'],
    pointerEnvKeys: ['CODEX_HOME'],
    files: (env, home) => [join(codexHome(env, home), 'auth.json')],
    profileFiles: (env, home) => [join(codexHome(env, home), 'config.toml')],
    configured: (context) => context.files().some((path) => nonempty(readJsonObject(path).OPENAI_API_KEY))
  },
  resolveExecutable: () => resolveCodexExecutable(),
  nativeNetwork: { transport: 'codex-app-server', snapshotKey: 'codex' },
  installation: { localCandidates: true },
  update: { command: 'codex', packageName: '@openai/codex', cask: 'codex' },
  gatewayConfig: (input) => {
    if (input.protocol !== 'openai-responses') return undefined
    input.writeConfigFile(join(input.dir, 'config.toml'), codexConfig(input.baseUrl, input.model, input.tokenEnv))
    return { CODEX_HOME: input.dir }
  }
}
