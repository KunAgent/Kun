import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { claudeCodeSdkExecutable, installedClaudeCode, sdkBundledClaudeBinary } from '../claude-code-executable.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { CLAUDE_CODE_CAPABILITIES, CLAUDE_SETTINGS_HOOK_EVENTS } from './capabilities.js'
import type { AgentProviderModule, HarnessLoginState, ProviderEnv } from './provider-module.js'
import type { HarnessLoginProbeDeps } from '../harness-login-probes.js'
import { raceProbeAbort } from '../probe-abort.js'
import { nonempty } from './support.js'

export const CLAUDE_CODE_DEFINITION: HarnessDefinition = {
  id: 'claude-code',
  displayName: 'Claude Code',
  transport: 'agent-sdk',
  detect: { command: 'claude', aliases: [], versionArgs: ['--version'] },
  credentialModes: ['native-login', 'kun-gateway'],
  permissionModes: [
    { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
    // acceptEdits writes files without any approval; approve-for-me cannot cover
    // it, so it conservatively maps to full-access.
    { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'full-access' },
    { id: 'bypassPermissions', label: 'Full access', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  // Fallback list when the SDK `supportedModels()` probe cannot run;
  // mirrors what Claude Code 2.1.x reports (P3-07).
  staticModels: [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5-1',
    'claude-haiku-4-5-20251001'
  ],
  historySource: 'claude-code',
  terminal: {
    argv: [],
    taskFlag: undefined,
    resumeArgs: ['--continue'],
    hooks: {
      kind: 'claude-settings',
      events: [...CLAUDE_SETTINGS_HOOK_EVENTS]
    }
  },
  capabilities: CLAUDE_CODE_CAPABILITIES,
  gateway: {
    protocol: 'anthropic-messages',
    env: {
      baseUrl: 'ANTHROPIC_BASE_URL',
      token: 'ANTHROPIC_AUTH_TOKEN',
      model: 'ANTHROPIC_MODEL',
      smallModel: 'ANTHROPIC_SMALL_FAST_MODEL'
    },
    stripEnv: [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX'
    ]
  },
  setup: {
    install: [
      { platform: 'any', command: 'npm install -g @anthropic-ai/claude-code' },
      {
        platform: 'darwin',
        command: 'curl -fsSL https://claude.ai/install.sh | bash',
        note: 'native installer (also works on Linux)'
      }
    ],
    login: {
      command: 'claude',
      args: [],
      note: 'type /login inside the Claude Code session'
    },
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  builtin: true
}

const runtimeRequire = createRequire(import.meta.url)

/**
 * The Agent SDK's own `claude` executable, when its platform package is
 * installed (development checkouts). Packaged builds omit it; detection then
 * reports the user's installation and its real version instead of claiming
 * the SDK package version for a binary that is not there.
 */
function bundledClaudeCode(): { version?: string; command?: string } | undefined {
  const command = sdkBundledClaudeBinary()
  if (!command) return undefined
  try {
    const pkgPath = join(dirname(runtimeRequire.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json')
    return { version: (runtimeRequire(pkgPath) as { version?: string }).version, command }
  } catch {
    return { command }
  }
}

async function probeClaudeCodeLogin(
  deps: HarnessLoginProbeDeps,
  command: string | undefined,
  env: ProviderEnv
): Promise<HarnessLoginState> {
  // `auth status` is a local account query, not login or inference. Empty,
  // unsupported or malformed responses cannot establish a signed-in account.
  if (command && deps.spawnCaptured) {
    const result = await raceProbeAbort(deps.spawnCaptured(command, ['auth', 'status', '--json'], {
      timeoutMs: 5_000, signal: deps.signal, env
    }), deps.signal).catch(() => undefined)
    deps.signal?.throwIfAborted()
    if (result && !result.timedOut) {
      try {
        const account: unknown = JSON.parse(result.stdout)
        if (account && typeof account === 'object' && 'loggedIn' in account) {
          const details = account as Record<string, unknown>
          const nativeOAuth = ['oauth', 'claude.ai', 'claude_ai'].includes(String(details.authMethod))
          const accountEvidence = nonempty(details.email) || nonempty(details.subscriptionType)
          if (account.loggedIn === true && result.exitCode === 0 && nativeOAuth && accountEvidence) return 'signed-in'
          if (account.loggedIn === true) return 'unknown'
          if (account.loggedIn === false) return 'signed-out'
        }
      } catch { /* Older CLIs can lack the JSON account surface. */ }
    }
  }
  // OAuth files may be expired; macOS may use Keychain. No file, key or
  // unsupported status command establishes authenticated native account state.
  return 'unknown'
}

const configDir = (env: ProviderEnv, home: string): string => env.CLAUDE_CONFIG_DIR || join(home, '.claude')

export const CLAUDE_CODE_MODULE: AgentProviderModule = {
  definition: CLAUDE_CODE_DEFINITION,
  credentials: {
    envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
    // An ambient OAuth token is the SDK's own credential, not configured evidence.
    pointerEnvKeys: ['CLAUDE_CONFIG_DIR'],
    files: (env, home) => [join(configDir(env, home), '.credentials.json')],
    profileFiles: (env, home) => [join(configDir(env, home), 'settings.json')]
  },
  login: ({ deps, command, env }) => probeClaudeCodeLogin(deps, command, env),
  nativeAccount: { kind: 'agent-sdk', credentialEnv: 'CLAUDE_CODE_OAUTH_TOKEN', countsAsEvidence: false },
  nativeLoginStripEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  loginStatusIgnoredWhen: ['CLAUDE_CODE_OAUTH_TOKEN'],
  binaryEnv: 'KUN_CLAUDE_BINARY',
  bundled: bundledClaudeCode,
  // Same choice as the SDK launch (claude-code-executable.ts), so the
  // detected command is the one readiness and turns start.
  resolveExecutable: async () => installedClaudeCode() ?? 'claude',
  sdkExecutable: (override) => claudeCodeSdkExecutable(override),
  nativeNetwork: { transport: 'agent-sdk', snapshotKey: 'claude-code' },
  installation: {
    bundledPathMarkers: ['/node_modules/@anthropic-ai/claude-agent-sdk', '/agent-sdk/'],
    native: ({ home, canonicalHome }) => ({ versionsDir: join(canonicalHome, '.local', 'share', 'claude', 'versions'),
      launcher: join(home, '.local', 'bin', 'claude'), owner: 'Claude Code' }),
    localCandidates: true
  },
  update: { command: 'claude', packageName: '@anthropic-ai/claude-code', cask: 'claude-code', nativeArgs: ['update'] }
}
