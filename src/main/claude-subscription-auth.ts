/**
 * Claude Pro/Max subscription login helpers for the GUI.
 *
 * The compliant path does NOT do an in-app browser OAuth (Anthropic forbids
 * third-party apps offering claude.ai login). Instead the official Claude Code
 * CLI performs the OAuth. Ambient login is detected with `claude auth status`
 * and started with `claude auth login`; a manually generated setup-token remains
 * an optional `CLAUDE_CODE_OAUTH_TOKEN` for the embedded Agent SDK runtime.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ClaudeSubscriptionLoginResult,
  ClaudeSubscriptionProbeResult,
  ClaudeSubscriptionStatus
} from '../shared/kun-gui-api'
import { validateClaudeSubscriptionToken } from '../shared/claude-subscription-auth'
import { runOwnedCommand } from './owned-command'

const OAUTH_TOKEN_REDACTION_PATTERN = /sk-ant-oat[\w-]+/g
const MAX_CAPTURE_BYTES = 64 * 1024
const DEFAULT_STATUS_TIMEOUT_MS = 5_000
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_PROBE_TIMEOUT_MS = 30_000
const LOGIN_POLL_INTERVAL_MS = 500
const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g'
)

type SpawnFn = typeof spawn

type CapturedCommandResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export { validateClaudeSubscriptionToken } from '../shared/claude-subscription-auth'

function claudeAuthEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS'
  ]) {
    delete env[key]
  }
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  return env
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString()
  return next.length > MAX_CAPTURE_BYTES ? next.slice(-MAX_CAPTURE_BYTES) : next
}

function redactClaudeAuthText(value: string, token?: string): string {
  let redacted = value.replace(ANSI_ESCAPE_SEQUENCE_PATTERN, '')
  if (token) redacted = redacted.split(token).join('<redacted>')
  return redacted
    .replace(OAUTH_TOKEN_REDACTION_PATTERN, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-500)
}

function runCapturedCommand(options: {
  binaryPath?: string
  args: string[]
  env?: NodeJS.ProcessEnv
  spawnFn?: SpawnFn
  timeoutMs: number
}): Promise<CapturedCommandResult> {
  if (!options.spawnFn) {
    const launch = claudeLaunch(options.binaryPath, options.args)
    return runOwnedCommand(launch.command, launch.args, {
      env: options.env ?? claudeAuthEnv(), timeoutMs: options.timeoutMs,
      maxOutputBytes: MAX_CAPTURE_BYTES, truncateOutput: true,
      messages: { timeout: 'claude-capture-timeout' }
    }).then((result) => ({ code: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: false }),
      (error: NodeJS.ErrnoException) => ({ code: null, stdout: '',
        stderr: error.code === 'ENOENT' ? 'claude-cli-not-found' : error.message,
        timedOut: error.message === 'claude-capture-timeout' }))
  }
  const spawnFn = options.spawnFn ?? spawn
  return new Promise((resolve) => {
    let child: ChildProcess | undefined
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child?.kill()
      } catch {
        // ignore cleanup failures
      }
      finish(null)
    }, options.timeoutMs)
    try {
      child = spawnFn(options.binaryPath ?? 'claude', options.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: !options.binaryPath && process.platform === 'win32',
        env: options.env ?? claudeAuthEnv()
      })
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
      finish(null)
      return
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      stderr = error.code === 'ENOENT' ? 'claude-cli-not-found' : error.message
      finish(null)
    })
    child.on('exit', (code) => finish(code))
  })
}

export async function claudeSubscriptionStatus(options: {
  binaryPath?: string
  spawnFn?: SpawnFn
  timeoutMs?: number
  credentialsPath?: string
} = {}): Promise<ClaudeSubscriptionStatus> {
  const credentialsPath =
    options.credentialsPath ?? join(homedir(), '.claude', '.credentials.json')
  const fallback = (): ClaudeSubscriptionStatus =>
    existsSync(credentialsPath)
      ? { loggedIn: true, source: 'credentials-file', message: 'cli-status-unavailable' }
      : { loggedIn: false, source: 'none', message: 'not-logged-in' }
  const result = await runCapturedCommand({
    binaryPath: options.binaryPath,
    args: ['auth', 'status', '--json'],
    spawnFn: options.spawnFn,
    timeoutMs: options.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS
  })
  if (result.timedOut) {
    const status = fallback()
    return status.loggedIn ? status : { ...status, message: 'status-timeout' }
  }
  if (result.code !== 0) {
    const status = fallback()
    if (status.loggedIn) return status
    const message = redactClaudeAuthText(result.stderr || result.stdout)
    return { ...status, message: message || 'cli-status-unavailable' }
  }
  try {
    const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown }
    return parsed.loggedIn === true
      ? { loggedIn: true, source: 'cli' }
      : { loggedIn: false, source: 'cli', message: 'not-logged-in' }
  } catch {
    const status = fallback()
    return status.loggedIn ? status : { ...status, message: 'invalid-status-response' }
  }
}

/**
 * Resolve the Claude Code binary that the Agent SDK bundles as a per-platform
 * optional dependency (`@anthropic-ai/claude-agent-sdk-<plat>-<arch>/claude`).
 * Using it means the user needs NO separate CLI install. Returns the first
 * existing candidate under the given kun roots, or undefined to fall back to a
 * `claude` on PATH.
 */
export function resolveBundledClaudeBinary(kunRoots: readonly string[]): string | undefined {
  const arch =
    process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  const platform =
    process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'win32'
        ? 'win32'
        : process.platform === 'linux'
          ? 'linux'
          : undefined
  if (!arch || !platform) return undefined
  const binName = platform === 'win32' ? 'claude.exe' : 'claude'
  const pkgs =
    platform === 'linux'
      ? [
          `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`,
          `@anthropic-ai/claude-agent-sdk-${platform}-${arch}-musl`
        ]
      : [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]
  for (const root of kunRoots) {
    for (const pkg of pkgs) {
      const candidate = join(root, 'node_modules', pkg, binName)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Run the official ambient subscription login and poll the official structured
 * status. Polling makes completion independent from terminal rendering and
 * lets the GUI finish even if the helper process remains open after OAuth.
 */
export async function runClaudeSubscriptionLogin(
  options: {
    spawnFn?: SpawnFn
    timeoutMs?: number
    pollIntervalMs?: number
    binaryPath?: string
    status?: () => Promise<ClaudeSubscriptionStatus>
  } = {}
): Promise<ClaudeSubscriptionLoginResult> {
  const spawnFn = options.spawnFn ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? LOGIN_POLL_INTERVAL_MS
  const readStatus = options.status ?? (() => claudeSubscriptionStatus({
    binaryPath: options.binaryPath,
    ...(options.spawnFn ? { spawnFn } : {})
  }))
  if ((await readStatus()).loggedIn) return { ok: true, mode: 'ambient' }
  if (!options.spawnFn) return runOwnedClaudeLogin(options.binaryPath, readStatus, timeoutMs, pollIntervalMs)

  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let child: ChildProcess | undefined
    let output = ''
    let polling = false

    const done = (result: ClaudeSubscriptionLoginResult): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (pollTimer) clearTimeout(pollTimer)
      try {
        child?.kill()
      } catch {
        // ignore
      }
      resolve(result)
    }

    const poll = async (): Promise<void> => {
      if (settled || polling) return
      polling = true
      try {
        if ((await readStatus()).loggedIn) {
          done({ ok: true, mode: 'ambient' })
          return
        }
      } catch {
        // keep polling until the bounded login deadline
      } finally {
        polling = false
      }
      if (!settled) pollTimer = setTimeout(() => void poll(), pollIntervalMs)
    }

    try {
      child = spawnFn(options.binaryPath ?? 'claude', ['auth', 'login', '--claudeai'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: !options.binaryPath && process.platform === 'win32',
        env: claudeAuthEnv()
      })
    } catch (err) {
      done({ ok: false, message: err instanceof Error ? err.message : 'failed to start claude' })
      return
    }

    timeout = setTimeout(() => done({ ok: false, message: 'timeout' }), timeoutMs)
    const onChunk = (chunk: Buffer): void => {
      output = appendBounded(output, chunk)
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        message: err.code === 'ENOENT' ? 'claude-cli-not-found' : err.message
      })
    })
    child.on('exit', () => {
      void readStatus().then((status) => {
        if (status.loggedIn) {
          done({ ok: true, mode: 'ambient' })
          return
        }
        done({
          ok: false,
          message: redactClaudeAuthText(output) || 'claude-login-exited'
        })
      }).catch(() => {
        done({ ok: false, message: redactClaudeAuthText(output) || 'claude-login-exited' })
      })
    })
    pollTimer = setTimeout(() => void poll(), Math.min(pollIntervalMs, 100))
  })
}

function claudeLaunch(binaryPath: string | undefined, args: string[]): { command: string; args: string[] } {
  return !binaryPath && process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'claude', ...args] }
    : { command: binaryPath ?? 'claude', args }
}

async function runOwnedClaudeLogin(
  binaryPath: string | undefined,
  readStatus: () => Promise<ClaudeSubscriptionStatus>,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<ClaudeSubscriptionLoginResult> {
  const controller = new AbortController()
  let authenticated = false
  let checking = false
  const poll = async (): Promise<void> => {
    if (checking || controller.signal.aborted) return
    checking = true
    try {
      if ((await readStatus()).loggedIn) {
        authenticated = true
        controller.abort()
      }
    } catch { /* the command still owns the bounded login attempt */ }
    finally { checking = false }
  }
  const timer = setInterval(() => { void poll() }, pollIntervalMs)
  const launch = claudeLaunch(binaryPath, ['auth', 'login', '--claudeai'])
  try {
    const result = await runOwnedCommand(launch.command, launch.args, {
      env: claudeAuthEnv(), signal: controller.signal, timeoutMs,
      maxOutputBytes: MAX_CAPTURE_BYTES, truncateOutput: true, messages: { timeout: 'timeout' }
    })
    if (authenticated || (await readStatus()).loggedIn) return { ok: true, mode: 'ambient' }
    return { ok: false, message: redactClaudeAuthText(result.stdout + result.stderr) || 'claude-login-exited' }
  } catch (error) {
    if (authenticated) return { ok: true, mode: 'ambient' }
    return { ok: false, message: (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'claude-cli-not-found' : redactClaudeAuthText(error instanceof Error ? error.message : String(error)) }
  } finally { clearInterval(timer) }
}

/** Make a real, no-tools request so connection success proves upstream auth. */
export async function probeClaudeSubscription(options: {
  token?: string
  binaryPath?: string
  spawnFn?: SpawnFn
  timeoutMs?: number
  now?: () => number
} = {}): Promise<ClaudeSubscriptionProbeResult> {
  const rawToken = options.token?.trim() ?? ''
  let token: string | undefined
  if (rawToken) {
    const validation = validateClaudeSubscriptionToken(rawToken)
    if (!validation.ok) return validation
    token = validation.token
  }
  const now = options.now ?? Date.now
  const startedAt = now()
  const result = await runCapturedCommand({
    binaryPath: options.binaryPath,
    args: [
      '-p',
      'Reply exactly KUN_AUTH_OK',
      '--model',
      'haiku',
      '--max-turns',
      '1',
      '--no-session-persistence',
      '--output-format',
      'json',
      '--permission-mode',
      'plan',
      '--disable-slash-commands',
      '--tools',
      ''
    ],
    env: claudeAuthEnv(token),
    spawnFn: options.spawnFn,
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  })
  if (result.timedOut) return { ok: false, message: 'probe-timeout' }
  if (result.code === 0) {
    return { ok: true, latencyMs: Math.max(0, now() - startedAt) }
  }
  const message = redactClaudeAuthText(result.stderr || result.stdout, token)
  return {
    ok: false,
    message: message || (result.code === null ? 'claude-cli-not-found' : `claude-probe-exited-${result.code}`)
  }
}
