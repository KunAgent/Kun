import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'

export type HarnessLoginState = HarnessStatus['login']

export type HarnessLoginProbeDeps = {
  /** Provider configs from the active runtime options (read-only). */
  providers: () => Record<string, Pick<ServeProviderConfig, 'kind' | 'credentialSourceId' | 'apiKey' | 'presetSource'>>
  /** Claude Code credentials file; overridable in tests. */
  claudeCredentialsPath?: string
  /** Gemini CLI OAuth credentials file (used by Antigravity); overridable in tests. */
  geminiCredentialsPath?: string
  homeDir?: string
}

/**
 * Login probes never trigger paid calls: they only read local state or a local
 * config binding. ACP agents answer with `unknown` here; session creation can
 * report an authentication error. Initialize authMethods lists login choices.
 */
export async function probeHarnessLogin(
  def: HarnessDefinition,
  deps: HarnessLoginProbeDeps
): Promise<HarnessLoginState> {
  switch (def.id) {
    case 'kun':
      return 'not-required'
    case 'claude-code':
      return probeClaudeCodeLogin(deps)
    case 'cursor':
      return probeProviderCredential(deps, 'cursor-sdk')
    case 'antigravity':
      return probeAntigravityLogin(deps)
    case 'pi':
      return probePiLogin(deps)
    default:
      return def.transport === 'acp' || def.transport === 'terminal' ? 'unknown' : 'unknown'
  }
}

async function probeClaudeCodeLogin(deps: HarnessLoginProbeDeps): Promise<HarnessLoginState> {
  const home = deps.homeDir ?? homedir()
  const credentialsPath = deps.claudeCredentialsPath ?? join(home, '.claude', '.credentials.json')
  if (existsSync(credentialsPath)) {
    try {
      const parsed = JSON.parse(await readFile(credentialsPath, 'utf8'))
      if (parsed && typeof parsed === 'object') return 'signed-in'
    } catch {
      // Unparseable credentials file is treated as not logged in.
    }
    return 'signed-out'
  }
  // On macOS the CLI stores credentials in the Keychain, which we deliberately
  // do not read; report unknown so the UI can hint instead of claiming signed out.
  return process.platform === 'darwin' ? 'unknown' : 'signed-out'
}

async function probeAntigravityLogin(deps: HarnessLoginProbeDeps): Promise<HarnessLoginState> {
  const bound = probeProviderCredential(deps, 'antigravity-cli')
  if (bound === 'signed-in') return bound
  const home = deps.homeDir ?? homedir()
  const geminiCredentials =
    deps.geminiCredentialsPath ?? join(home, '.gemini', 'oauth_creds.json')
  if (existsSync(geminiCredentials)) return 'signed-in'
  return bound === 'signed-out' ? 'unknown' : bound
}

/**
 * Pi native login state = `~/.pi/agent/auth.json` exists and parses with at
 * least one provider credential (P6-11, D2 — Kun never writes into pi's
 * agent dir; the file is read-only probed).
 */
async function probePiLogin(deps: HarnessLoginProbeDeps): Promise<HarnessLoginState> {
  const home = deps.homeDir ?? homedir()
  const authPath = join(home, '.pi', 'agent', 'auth.json')
  if (!existsSync(authPath)) return 'signed-out'
  try {
    const parsed = JSON.parse(await readFile(authPath, 'utf8'))
    return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
      ? 'signed-in'
      : 'signed-out'
  } catch {
    return 'signed-out'
  }
}

function probeProviderCredential(
  deps: HarnessLoginProbeDeps,
  kind: ServeProviderConfig['kind']
): HarnessLoginState {
  const providers = deps.providers()
  const hasCredential = Object.values(providers).some(
    (p) => p?.kind === kind && Boolean(p.credentialSourceId || p.apiKey)
  )
  return hasCredential ? 'signed-in' : 'signed-out'
}
