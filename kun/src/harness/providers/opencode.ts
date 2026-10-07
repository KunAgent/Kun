import { join } from 'node:path'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { unsupported } from '../../contracts/harness-capabilities.js'
import { ACP_DEFAULT_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, ProviderGatewayConfigInput } from './provider-module.js'
import { opencodeConfig } from '../gateway-config-templates.js'
import { authJsonConfigured, openCodeConfigFiles, xdgDataHome } from './support.js'

export const OPENCODE_DEFINITION: HarnessDefinition = {
  id: 'opencode',
  displayName: 'OpenCode',
  transport: 'acp',
  detect: { command: 'opencode', aliases: [], versionArgs: ['--version'] },
  launch: { command: 'opencode', args: ['acp'], env: {} },
  credentialModes: ['native-login', 'kun-gateway'],
  permissionModes: [
    // OpenCode exposes its agents as session modes; plan is read-only.
    { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' },
    { id: 'build', label: 'Build', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  nativeAgents: 'session-modes',
  loginOptional: true,
  staticModels: [],
  historySource: 'opencode',
  capabilities: ACP_DEFAULT_CAPABILITIES,
  // Generated opencode.json pins a single `kun` provider selected via
  // OPENCODE_CONFIG (verified against opencode 1.1.47, P3-10).
  gateway: {
    protocol: 'openai-chat',
    env: { baseUrl: 'KUN_GATEWAY_BASE_URL', token: 'KUN_GATEWAY_TOKEN' },
    stripEnv: [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'AZURE_OPENAI_API_KEY',
      'DEEPSEEK_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GROQ_API_KEY',
      'MISTRAL_API_KEY',
      'OPENROUTER_API_KEY',
      'XAI_API_KEY',
      'OPENCODE_CONFIG'
    ]
  },
  setup: {
    install: [
      { platform: 'any', command: 'npm i -g opencode-ai' },
      {
        platform: 'darwin',
        command: 'curl -fsSL https://opencode.ai/install | bash',
        note: 'standalone installer (also works on Linux)'
      }
    ],
    login: { command: 'opencode', args: ['auth', 'login'] },
    docsUrl: 'https://opencode.ai/docs'
  },
  builtin: true
}

/** OPENCODE_CONFIG names a generated opencode.json with only the `kun` provider. */
function openCodeGatewayConfig(input: ProviderGatewayConfigInput): Record<string, string> | undefined {
  if (input.protocol !== 'openai-chat') return undefined
  return { OPENCODE_CONFIG: input.writeConfigFile(join(input.dir, 'opencode.json'), opencodeConfig(input.baseUrl, input.model, input.tokenEnv)) }
}

export const OPENCODE_MODULE: AgentProviderModule = {
  definition: OPENCODE_DEFINITION,
  credentials: {
    pointerEnvKeys: ['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG'],
    files: (env, home) => [join(xdgDataHome(env, home), 'opencode/auth.json')],
    profileFiles: (env, home) => openCodeConfigFiles(env, home, 'opencode'),
    configured: (context) => authJsonConfigured(context.files())
  },
  update: { command: 'opencode', packageName: 'opencode-ai' },
  gatewayConfig: openCodeGatewayConfig,
  // OpenCode 1 refuses a shared opencode.db that OpenCode2 created first (it
  // has session_v2 but no session table). Only the user may move that file.
  explainFailure: (message) => /has no session table/i.test(message)
    ? { detail: 'OpenCode cannot open its database: opencode.db in its data directory (usually ~/.local/share/opencode) was created by OpenCode2 without the session table OpenCode needs. Back it up, move it out of that directory together with its -wal and -shm files, then check again; OpenCode recreates it and OpenCode2 can use the new file.', authRequired: false }
    : undefined
}

/**
 * CodeMaker is an OpenCode fork. Its ACP server, permission modes,
 * `opencode.json` config names and OPENCODE_* variables match OpenCode; the
 * command and XDG app name are `codemaker` (~/.config/codemaker,
 * ~/.local/share/codemaker). It differs where Kun must not assume OpenCode:
 * - Login is required. ACP `authenticate` is a no-op, so credentials come
 *   from `codemaker auth login` or the CODEMAKER_* variables.
 * - Its restricted-file policy (C/C++ sources, .codemakerignore) runs in its
 *   own filesystem layer, so Kun does not offer client-side file writes.
 */
export function codeMakerDefinition(opencode: HarnessDefinition): HarnessDefinition {
  // OpenCode's history reader, installers and free-model login exemption
  // target OpenCode itself.
  const { historySource: _history, setup: _setup, loginOptional: _login, ...shared } = opencode
  return {
    ...shared,
    id: 'codemaker',
    displayName: 'CodeMaker',
    detect: { command: 'codemaker', aliases: [], versionArgs: ['--version'] },
    launch: { command: 'codemaker', args: ['acp'], env: {} },
    acpClientWrites: false,
    capabilities: {
      ...opencode.capabilities,
      statuses: {
        ...opencode.capabilities.statuses,
        fsMediated: unsupported('upstream', { message: 'CodeMaker writes files through its own restricted-file policy' })
      }
    },
    // CodeMaker has no public installer: the organization distributes the
    // executable, and the fork keeps OpenCode's documentation links.
    setup: {
      login: { command: 'codemaker', args: ['auth', 'login'],
        note: 'CodeMaker is distributed by your organization; set its command path in Kun if it is not on PATH' },
      docsUrl: 'https://opencode.ai/docs'
    }
  }
}

export const CODEMAKER_MODULE: AgentProviderModule = {
  definition: codeMakerDefinition(OPENCODE_DEFINITION),
  credentials: {
    // ACP authenticate is a no-op in CodeMaker; these are its documented native credentials.
    envKeys: ['CODEMAKER_AUTH_TOKEN', 'CODEMAKER_AUTH_KEY', 'CODEMAKER_AUTH_USER', 'CODEMAKER_API_KEY'],
    // CODEMAKER_AUTH_USER only names the account; it is not a credential.
    evidenceEnvKeys: ['CODEMAKER_AUTH_TOKEN', 'CODEMAKER_AUTH_KEY', 'CODEMAKER_API_KEY'],
    pointerEnvKeys: ['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG'],
    files: (env, home) => [join(xdgDataHome(env, home), 'codemaker/auth.json')],
    profileFiles: (env, home) => openCodeConfigFiles(env, home, 'codemaker'),
    // CodeMaker's account login may use its own record type; any stored
    // secret is configured evidence, never verified authentication.
    configured: (context) => authJsonConfigured(context.files(), { anySecret: true })
  },
  gatewayConfig: openCodeGatewayConfig
}
