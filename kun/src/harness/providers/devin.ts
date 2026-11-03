import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { ACP_DEFAULT_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, HarnessLoginState, ProviderEnv } from './provider-module.js'
import type { HarnessLoginProbeDeps } from '../harness-login-probes.js'
import { raceProbeAbort } from '../probe-abort.js'
import { applyDevinSessionPermission } from '../../runtime/acp/devin-session-permissions.js'
import { nonempty } from './support.js'

export const DEVIN_DEFINITION: HarnessDefinition = {
  id: 'devin',
  displayName: 'Devin',
  transport: 'acp',
  // Official stdio transport: https://docs.devin.ai/cli/acp/zed
  detect: { command: 'devin', aliases: [], versionArgs: ['--version'] },
  launch: { command: 'devin', args: ['acp'], env: {} },
  credentialModes: ['native-login'],
  permissionModes: [
    { id: 'ask', label: 'Ask (read-only)', kunPermissionMode: 'ask-for-approval' },
    // CLI 3000.11+: auto-approves actions the model judges safe, i.e. the
    // native counterpart of Kun's reviewer-approved mode.
    { id: 'smart', label: 'Smart (auto-approve safe actions)', kunPermissionMode: 'approve-for-me' },
    { id: 'accept-edits', label: 'Accept edits', kunPermissionMode: 'full-access' },
    { id: 'bypass', label: 'Full access', kunPermissionMode: 'full-access' }
  ],
  modelSource: 'probe',
  staticModels: [],
  capabilities: {
    ...ACP_DEFAULT_CAPABILITIES,
    // ACP alone does not enable Devin's optional OS sandbox.
    facts: { sandbox: 'none', usageReporting: 'estimated', compactionOwner: 'harness' }
  },
  setup: {
    install: [
      { platform: 'darwin', command: 'brew install --cask devin-cli' },
      { platform: 'darwin', command: 'curl -fsSL https://cli.devin.ai/install.sh | bash' },
      { platform: 'linux', command: 'curl -fsSL https://cli.devin.ai/install.sh | bash' },
      { platform: 'win32', command: 'irm https://static.devin.ai/cli/setup.ps1 | iex', note: 'Run in PowerShell' }
    ],
    login: { command: 'devin', args: ['auth', 'login'], note: 'Sign in with Devin CLI' },
    docsUrl: 'https://docs.devin.ai/cli/acp/zed'
  },
  builtin: true
}

async function probeDevinLogin(
  deps: HarnessLoginProbeDeps,
  command: string | undefined,
  env: ProviderEnv
): Promise<HarnessLoginState> {
  if (command && deps.spawnCaptured) {
    const result = await raceProbeAbort(deps.spawnCaptured(command, ['auth', 'status'], {
      timeoutMs: 10_000, signal: deps.signal, env
    }), deps.signal).catch(() => undefined)
    deps.signal?.throwIfAborted()
    if (result && !result.timedOut) {
      // Do not propagate stdout: status includes private account details.
      const output = stripVTControlCharacters(result.stdout).trim()
      if (result.exitCode === 0 && /^Logged in(?: \(via (?:Devin|Windsurf)\))?\.?$/im.test(output)) return 'signed-in'
      if (/^(?:Not logged in|Logged out|Not authenticated)\.?$/im.test(output)) return 'signed-out'
    }
    // Unsupported versions or unavailable status are not proof of logout.
    return 'unknown'
  }
  return nonempty(env.WINDSURF_API_KEY) ? 'unknown' : 'signed-out'
}

export const DEVIN_MODULE: AgentProviderModule = {
  definition: DEVIN_DEFINITION,
  credentials: {
    // Official ACP command reference documents WINDSURF_API_KEY, not DEVIN_API_KEY.
    envKeys: ['WINDSURF_API_KEY'],
    evidenceEnvKeys: ['WINDSURF_API_KEY'],
    files: (env, home) => [join(process.platform === 'win32'
      ? env.APPDATA || join(home, 'AppData/Roaming')
      : env.XDG_DATA_HOME || join(home, '.local/share'), 'devin/credentials.toml')]
  },
  login: ({ definition, deps, command, env }) => definition.transport !== 'acp'
    ? Promise.resolve('unknown' as const) : probeDevinLogin(deps, command, env),
  update: { command: 'devin', cask: 'devin-cli' },
  acp: {
    applyPermission: (conn, session, mode) => applyDevinSessionPermission(conn, session, mode),
    modelCategory: (value) => value.startsWith('fusion-') ? 'fusion' : 'model',
    // Devin's picker treats a known-empty list as "details loaded, no levels".
    emptyEffortsWithoutThoughtLevel: true
  },
  // Older Devin ACP versions call their approval-gated mode normal/auto.
  // Negotiate that mode only when the host allows writes with approval; newer
  // versions may narrow it to ask. An explicit read-only ask never widens.
  // Reviewer-approved host scope maps to Devin's Smart mode; older CLIs
  // without it fall back to the legacy approval mode, then read-only Ask.
  permissionMode: ({ requested, ceiling }) => {
    if (!requested && ceiling === 1) return 'smart'
    if ((!requested && ceiling < 1) || requested === 'normal' || requested === 'auto') return 'normal'
    return undefined
  }
}
