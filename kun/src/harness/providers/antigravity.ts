import { isAntigravityOrchestrator } from '@kun/provider-catalog'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { resolveExecutable } from '../../process/owned-process.js'
import { harnessExecutableEnv } from '../harness-executable-env.js'
import { ANTIGRAVITY_CAPABILITIES, ANTIGRAVITY_CLI_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule, HarnessLoginState, ProviderEnv } from './provider-module.js'
import type { HarnessLoginProbeDeps } from '../harness-login-probes.js'
import { antigravityCredentialEvidence } from '../antigravity-credentials.js'
import { homeOf, nonempty, probeProviderCredential, readJsonFile, readJsonObject } from './support.js'
import { projectAntigravityToolInputSchema } from '../../adapters/model/antigravity-tool-schema-projection.js'
import { selectAntigravityMcpToolListMeta } from './antigravity-mcp-eager.js'

const AGY_DETECT = { command: 'agy', aliases: [], versionArgs: ['--version'] }
// Official `agy acp` first shipped in CLI 1.5.0; older builds open the TUI.
// https://antigravity.google/docs/changelog
export const ANTIGRAVITY_ACP_MIN_VERSION = '1.5.0'

export const ANTIGRAVITY_DEFINITION: HarnessDefinition = {
  id: 'antigravity',
  displayName: 'Antigravity',
  transport: 'acp',
  poolScope: 'thread',
  // Official stdio ACP server (`agy acp`); the IDE launcher is not a turn
  // protocol and must not be mistaken for a ready agent.
  detect: { ...AGY_DETECT, minVersion: ANTIGRAVITY_ACP_MIN_VERSION },
  launch: { command: 'agy', args: ['acp', '--process-per-session'], env: {} },
  variants: {
    'antigravity-cli': {
      detect: AGY_DETECT,
      launch: { command: 'agy', args: [], env: {} },
      capabilities: ANTIGRAVITY_CLI_CAPABILITIES
    }
  },
  credentialModes: ['native-login'],
  permissionModes: [
    { id: 'plan', label: 'Plan (read-only)', kunPermissionMode: 'ask-for-approval' },
    { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
    { id: 'accept-edits', label: 'Accept edits', kunPermissionMode: 'full-access' },
    { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
  ],
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

function antigravityBinaryName(): string {
  return process.platform === 'win32' ? 'agy.exe' : 'agy'
}

function antigravityManagedPaths(home: string): string[] {
  const binary = antigravityBinaryName()
  const appSupport = process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Kun')
    : process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Kun')
      : join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Kun')
  return [
    join(appSupport, 'provider-cli', 'antigravity', binary),
    join(appSupport, 'antigravity-cli', binary)
  ]
}

async function resolveAntigravityExecutable(): Promise<string> {
  const fromPath = await resolveExecutable('agy', { env: harnessExecutableEnv() })
  if (fromPath) return fromPath
  const managed = antigravityManagedPaths(homedir()).find((candidate) => existsSync(candidate))
  return managed ?? 'agy'
}

export const ANTIGRAVITY_MODULE: AgentProviderModule = {
  definition: ANTIGRAVITY_DEFINITION,
  acp: {
    projectToolInputSchema: projectAntigravityToolInputSchema,
    mcpToolListMeta: selectAntigravityMcpToolListMeta,
    continuePendingTools: true,
    emptyEffortsWithoutThoughtLevel: true,
    probeAllModelEfforts: true,
    managesReasoningBudget: isAntigravityOrchestrator,
    turnInstructions: [
      'In this ACP session, wait for native background commands and scheduled checks to finish before ending your response. Use the existing task id to wait for or inspect the result; do not end with a promise to continue automatically. A native schedule is not a Kun-owned continuation.'
    ]
  },
  installation: {
    nativePaths: ({ home, canonicalHome, dataDir }) => [
      ...new Set([home, canonicalHome].flatMap((root) => [
        ...antigravityManagedPaths(root),
        process.platform === 'win32'
          ? join(process.env.LOCALAPPDATA ?? join(root, 'AppData', 'Local'), 'agy', 'bin', antigravityBinaryName())
          : join(root, '.local', 'bin', antigravityBinaryName())
      ])),
      ...(dataDir ? [join(dataDir, 'provider-cli', 'antigravity', antigravityBinaryName())] : [])
    ],
    localCandidates: true
  },
  credentials: {
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
    evidenceEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    pointerEnvKeys: ['CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'],
    files: (env, home) => [env.GOOGLE_APPLICATION_CREDENTIALS ||
      join(env.CLOUDSDK_CONFIG || join(home, '.config/gcloud'), 'application_default_credentials.json')],
    // agy rewrites settings.json when switching session models/efforts; credentials live in files + snapshotEvidence.
    configured: (context) => (context.selected.GOOGLE_APPLICATION_CREDENTIALS
      ? [context.selected.GOOGLE_APPLICATION_CREDENTIALS] : context.files()).some(adcConfigured),
    snapshotEvidence: (env) => antigravityCredentialEvidence(env)
  },
  login: ({ deps, env }) => probeAntigravityLogin(deps, env),
  nativeAccount: { kind: 'antigravity-cli', credentialEnv: 'GEMINI_API_KEY', countsAsEvidence: true },
  binaryEnv: 'KUN_ANTIGRAVITY_BINARY',
  managedExecutable: (dataDir) => {
    const candidates = [
      join(dataDir, 'provider-cli', 'antigravity', antigravityBinaryName()),
      ...antigravityManagedPaths(homedir())
    ]
    return candidates.find((candidate) => existsSync(candidate))
  },
  resolveExecutable: () => resolveAntigravityExecutable(),
  nativeNetwork: { transport: 'acp', snapshotKey: 'antigravity' },
  update: { command: 'agy', nativeArgs: ['update'], githubRepo: 'google-antigravity/antigravity-cli' }
}
