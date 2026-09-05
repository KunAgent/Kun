import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../contracts/policy.js'
import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { resolveCliRuntimeFlavor } from '../cli/runtime-flavor.js'

export const DEFAULT_TUI_DATA_DIR = join(homedir(), '.kun', 'data')

export const KUN_TUI_USAGE = `kun [tui options]

Open Kun's inline terminal client. By default Kun starts one Runtime owned by
this TUI session and stops it when the TUI exits; \`kun tui\` is an alias.
The GUI and default TUI cannot own the same data directory/flavor concurrently.
Use \`kun tui --no-start\` to connect to a Runtime already owned by the GUI.
For an independent Runtime, isolate KUN_MANAGER_CONTROL_DIR,
KUN_MANAGER_SETTINGS_PATH, and KUN_DATA_DIR.

Options:
  --url <url>               Explicit runtime URL (default: discover from data dir)
  --runtime-token <token>   Bearer token (prefer KUN_RUNTIME_TOKEN to shell history)
  --data-dir <path>         Discovery directory (default GUI setting, then ~/.kun/data)
  --no-start                Attach to discovery only; never start or stop Runtime
  --workspace <path>        Workspace for new terminal threads (default cwd)
  --thread <id>             Open a specific thread
  --continue, -c            Open the most recently updated thread
  --graph <requirement>     Start or steer a Graph requirement after opening
  -graph <requirement>      Compatibility alias for --graph
  --model <model>           Model for newly created threads
  --provider-id <id>        Provider for newly created threads
  --account-id <id>         Provider account for newly created threads
  --approval-policy <p>     on-request | untrusted | never | auto | suggest
  --sandbox-mode <mode>     read-only | workspace-write | danger-full-access | external-sandbox
  --approval-reviewer <r>   user | agent
  --help, -h                Show this help

Keys:
  Enter send/steer  Ctrl+J/Shift+Enter newline  Ctrl+T reasoning effort
  Ctrl+X Leader  Ctrl+X L sessions  Ctrl+X N new  Ctrl+P commands
  Escape interrupt  Ctrl+C clear/exit  Mouse wheel scrollback  Drag select/copy
  Ctrl+X P direct clicks  Shift+PgUp/PgDn terminal scrollback
`

export type TuiOptions = {
  url?: string
  runtimeToken: string
  dataDir: string
  dataDirSource?: 'argument' | 'environment' | 'default'
  workspace: string
  threadId?: string
  continueLatest: boolean
  graphPrompt?: string
  noStart: boolean
  runtimeFlavor?: RuntimeFlavor
  model?: string
  providerId?: string
  accountId?: string
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  help: boolean
}

export type TuiOptionsResult =
  | { ok: true; options: TuiOptions }
  | { ok: false; message: string }

const VALUE_OPTIONS = new Set([
  'url',
  'runtime-token',
  'data-dir',
  'workspace',
  'thread',
  'graph',
  'model',
  'provider-id',
  'account-id',
  'approval-policy',
  'sandbox-mode',
  'approval-reviewer'
])

const APPROVAL_POLICIES = new Set<ApprovalPolicy>([
  'on-request',
  'untrusted',
  'never',
  'auto',
  'suggest'
])

const SANDBOX_MODES = new Set<SandboxMode>([
  'read-only',
  'workspace-write',
  'danger-full-access',
  'external-sandbox'
])
const APPROVAL_REVIEWERS = new Set<ApprovalReviewer>(['user', 'agent'])

export function parseTuiOptions(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
  cwd: () => string = process.cwd
): TuiOptionsResult {
  const values = new Map<string, string>()
  let continueLatest = false
  let noStart = false
  let help = false
  let graphOptionSeen = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') {
      help = true
      continue
    }
    if (token === '--continue' || token === '-c') {
      continueLatest = true
      continue
    }
    if (token === '--no-start') {
      noStart = true
      continue
    }
    if (token === '-graph') {
      const value = argv[++index]
      if (!value || isTuiOptionToken(value)) {
        return { ok: false, message: graphPromptUsageError() }
      }
      values.set('graph', value)
      graphOptionSeen = true
      continue
    }
    if (!token.startsWith('--')) {
      return {
        ok: false,
        message: graphOptionSeen
          ? 'graph requirement must be one quoted argument; usage: kun --graph "<requirement>"'
          : `unknown argument: ${token}`
      }
    }
    const equalAt = token.indexOf('=')
    const key = equalAt >= 0 ? token.slice(2, equalAt) : token.slice(2)
    if (!VALUE_OPTIONS.has(key)) return { ok: false, message: `unknown option: --${key}` }
    const value = equalAt >= 0 ? token.slice(equalAt + 1) : argv[++index]
    if (!value || value.startsWith('--') || (key === 'graph' && isTuiOptionToken(value))) {
      return {
        ok: false,
        message: key === 'graph' ? graphPromptUsageError() : `missing value for --${key}`
      }
    }
    values.set(key, value)
    if (key === 'graph') graphOptionSeen = true
  }

  const approvalPolicy = nonEmpty(values.get('approval-policy')) as ApprovalPolicy | undefined
  if (approvalPolicy && !APPROVAL_POLICIES.has(approvalPolicy)) {
    return { ok: false, message: `invalid approval policy: ${approvalPolicy}` }
  }
  const sandboxMode = nonEmpty(values.get('sandbox-mode')) as SandboxMode | undefined
  if (sandboxMode && !SANDBOX_MODES.has(sandboxMode)) {
    return { ok: false, message: `invalid sandbox mode: ${sandboxMode}` }
  }
  const approvalReviewer =
    nonEmpty(values.get('approval-reviewer')) as ApprovalReviewer | undefined
  if (approvalReviewer && !APPROVAL_REVIEWERS.has(approvalReviewer)) {
    return { ok: false, message: `invalid approval reviewer: ${approvalReviewer}` }
  }

  const argumentDataDir = nonEmpty(values.get('data-dir'))
  const environmentDataDir = nonEmpty(env.KUN_DATA_DIR)
  const dataDir = expandHome(argumentDataDir ?? environmentDataDir ?? DEFAULT_TUI_DATA_DIR)
  const workspace = resolve(expandHome(nonEmpty(values.get('workspace')) ?? nonEmpty(env.KUN_WORKSPACE) ?? cwd()))
  const url = nonEmpty(values.get('url')) ?? nonEmpty(env.KUN_TUI_URL)
  return {
    ok: true,
    options: {
      ...(url ? { url: normalizeBaseUrl(url) } : {}),
      runtimeToken: nonEmpty(values.get('runtime-token')) ?? nonEmpty(env.KUN_RUNTIME_TOKEN) ?? '',
      dataDir,
      dataDirSource: argumentDataDir
        ? 'argument'
        : environmentDataDir
          ? 'environment'
          : 'default',
      workspace,
      ...(nonEmpty(values.get('thread')) ? { threadId: nonEmpty(values.get('thread')) } : {}),
      continueLatest,
      ...(nonEmpty(values.get('graph')) ? { graphPrompt: nonEmpty(values.get('graph')) } : {}),
      noStart,
      runtimeFlavor: resolveCliRuntimeFlavor({ env }),
      ...(nonEmpty(values.get('model')) ? { model: nonEmpty(values.get('model')) } : {}),
      ...(nonEmpty(values.get('provider-id')) ? { providerId: nonEmpty(values.get('provider-id')) } : {}),
      ...(nonEmpty(values.get('account-id')) ? { accountId: nonEmpty(values.get('account-id')) } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
      ...(sandboxMode ? { sandboxMode } : {}),
      ...(approvalReviewer ? { approvalReviewer } : {}),
      help
    }
  }
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('runtime URL must use http or https')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

function isTuiOptionToken(value: string): boolean {
  return value === '-graph' ||
    value === '-c' ||
    value === '-h' ||
    value.startsWith('--')
}

function graphPromptUsageError(): string {
  return 'missing Graph requirement; usage: kun --graph "<requirement>"'
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}
