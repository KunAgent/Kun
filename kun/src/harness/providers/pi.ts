import { join } from 'node:path'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { PI_MIN_VERSION } from '../../runtime/pi/pi-protocol.js'
import { PI_RPC_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, ProviderEnv } from './provider-module.js'
import { piModelsConfig } from '../gateway-config-templates.js'
import { authJsonConfigured, homeOf, readJsonFile } from './support.js'

export const PI_DEFINITION: HarnessDefinition = {
  id: 'pi',
  displayName: 'Pi',
  transport: 'pi-rpc',
  // pi binds cwd at spawn and hosts one session per process — the shared
  // pool must therefore key on workspace as well as credential.
  poolScope: 'workspace',
  detect: {
    command: 'pi',
    aliases: [],
    versionArgs: ['--version'],
    minVersion: PI_MIN_VERSION
  },
  // `--mode rpc --no-extensions --extension <kun-pi-bridge>` are prepended
  // by PiAgent.connect; launch args stay empty so config can't widen them.
  launch: { command: 'pi', args: [], env: {} },
  credentialModes: ['native-login', 'kun-gateway'],
  permissionModes: [
    { id: 'ask', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
    { id: 'auto', label: 'Auto', kunPermissionMode: 'approve-for-me' },
    { id: 'bypass', label: 'Full access', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  staticModels: [],
  capabilities: PI_RPC_CAPABILITIES,
  // Generated <PI_CODING_AGENT_DIR>/models.json declares a single `kun`
  // provider on the openai-completions surface; the apiKey is a `$NAME`
  // environment reference so the grant token never lands on disk.
  gateway: {
    protocol: 'openai-chat',
    env: { baseUrl: 'KUN_PI_GATEWAY_BASE', token: 'KUN_PI_GATEWAY_KEY' },
    stripEnv: [
      'ANTHROPIC_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'DEEPSEEK_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GROQ_API_KEY',
      'MISTRAL_API_KEY',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENROUTER_API_KEY',
      'XAI_API_KEY',
      'PI_CODING_AGENT_DIR'
    ]
  },
  setup: {
    install: [
      {
        platform: 'any',
        command: 'npm install -g @earendil-works/pi-coding-agent'
      }
    ],
    // Pi login is the interactive `/login` inside its own TUI.
    login: { command: 'pi', args: [], note: 'Run /login inside pi' },
    docsUrl: 'https://github.com/earendil-works/pi'
  },
  availability: 'active',
  builtin: true
}

const agentDir = (env: ProviderEnv, home: string): string => env.PI_CODING_AGENT_DIR || join(home, '.pi/agent')

export const PI_MODULE: AgentProviderModule = {
  definition: PI_DEFINITION,
  credentials: {
    pointerEnvKeys: ['PI_CODING_AGENT_DIR'],
    files: (env, home) => [join(agentDir(env, home), 'auth.json')],
    profileFiles: (env, home) => ['settings.json', 'models.json'].map((name) => join(agentDir(env, home), name)),
    configured: (context) => authJsonConfigured(context.files())
  },
  login: async ({ deps, env }) => {
    const home = deps.homeDir ?? env.HOME ?? env.USERPROFILE ?? homeOf({})
    const auth = await readJsonFile(join(env.PI_CODING_AGENT_DIR ?? join(home, '.pi', 'agent'), 'auth.json'))
    return auth && Object.keys(auth).length > 0 ? 'unknown' : 'signed-out'
  },
  update: { command: 'pi', packageName: '@earendil-works/pi-coding-agent' },
  gatewayConfig: (input) => {
    if (input.protocol !== 'openai-chat') return undefined
    input.writeConfigFile(join(input.dir, 'models.json'), piModelsConfig(input.baseUrl, input.model, input.tokenEnv))
    return { PI_CODING_AGENT_DIR: input.dir }
  }
}
