import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { SpawnCaptured } from './harness-detector.js'
import { raceProbeAbort } from './probe-abort.js'

export type HarnessLoginState = HarnessStatus['login']

export type HarnessLoginProbeDeps = {
  /** Provider configs from the active runtime options (read-only). */
  providers: () => Record<string, Pick<ServeProviderConfig, 'kind' | 'credentialSourceId' | 'apiKey' | 'presetSource'>>
  claudeCredentialsPath?: string
  /** Retained for compatibility; Gemini OAuth is not an agy credential. */
  geminiCredentialsPath?: string
  homeDir?: string
  env?: Record<string, string | undefined>
  signal?: AbortSignal
  spawnCaptured?: SpawnCaptured
}

/** Local metadata only. Credential presence never proves authentication. */
export async function probeHarnessLogin(
  def: HarnessDefinition,
  deps: HarnessLoginProbeDeps,
  command?: string
): Promise<HarnessLoginState> {
  deps.signal?.throwIfAborted()
  const env = { ...(deps.env ?? process.env), ...def.launch?.env }
  let state: HarnessLoginState
  switch (def.id) {
    case 'kun': return 'not-required'
    case 'claude-code': state = await probeClaudeCodeLogin(deps, command, env); break
    case 'cursor': state = probeProviderCredential(deps, 'cursor-sdk'); break
    case 'antigravity': state = await probeAntigravityLogin(deps, env); break
    case 'devin':
    case 'windsurf':
      state = def.transport !== 'acp' ? 'unknown' : await probeDevinLogin(deps, command, env)
      break
    case 'pi': {
      const home = deps.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir()
      const auth = await readObject(join(env.PI_CODING_AGENT_DIR ?? join(home, '.pi', 'agent'), 'auth.json'))
      state = auth && Object.keys(auth).length > 0 ? 'unknown' : 'signed-out'
      break
    }
    default: state = 'unknown'
  }
  deps.signal?.throwIfAborted()
  return state
}

async function probeDevinLogin(
  deps: HarnessLoginProbeDeps,
  command: string | undefined,
  env: Record<string, string | undefined>
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

async function probeClaudeCodeLogin(
  deps: HarnessLoginProbeDeps,
  command: string | undefined,
  env: Record<string, string | undefined>
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

async function probeAntigravityLogin(
  deps: HarnessLoginProbeDeps,
  env: Record<string, string | undefined>
): Promise<HarnessLoginState> {
  if (probeProviderCredential(deps, 'antigravity-cli') === 'unknown' ||
      nonempty(env.GOOGLE_API_KEY) || nonempty(env.GEMINI_API_KEY)) return 'unknown'
  const home = deps.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir()
  const adcPath = env.GOOGLE_APPLICATION_CREDENTIALS ?? join(
    env.CLOUDSDK_CONFIG ?? join(home, '.config', 'gcloud'), 'application_default_credentials.json'
  )
  const adc = await readObject(adcPath)
  return adc && (adc.type === 'authorized_user' || adc.type === 'service_account' || adc.type === 'external_account')
    ? 'unknown' : 'signed-out'
}

function nonempty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

async function readObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

function probeProviderCredential(
  deps: HarnessLoginProbeDeps,
  kind: ServeProviderConfig['kind']
): HarnessLoginState {
  const hasCredential = Object.values(deps.providers()).some(
    (provider) => provider?.kind === kind &&
      (nonempty(provider.credentialSourceId) || nonempty(provider.apiKey))
  )
  return hasCredential ? 'unknown' : 'signed-out'
}
