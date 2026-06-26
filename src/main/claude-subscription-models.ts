/**
 * Fetch the Claude models available to a subscription, via the Agent SDK's
 * `query().supportedModels()`. The SDK lives in kun's
 * node_modules (not the app's), so we run a short ESM eval in a Node subprocess
 * with cwd = the kun dir, scoping the OAuth token into its env. Defensive: any
 * failure (no SDK, timeout, not-logged-in) resolves to `[]` so the caller keeps
 * its existing/preset model list.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const SDK_PKG = '@anthropic-ai/claude-agent-sdk'
// Frame the JSON payload so we can extract it from any other stdout noise.
const MARK = '<<<KUN_MODELS>>>'

function resolveKunDir(kunRoots: readonly string[]): string | undefined {
  return kunRoots.find((root) => existsSync(join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk')))
}

/** Env with API-key overrides stripped so the OAuth token is what authenticates. */
function scopedEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  return env
}

export function fetchSdkModels(options: {
  token?: string
  kunRoots: readonly string[]
  /** Explicit Claude Code binary path (when not bundled in kun/node_modules). */
  binaryPath?: string
  /** Node/Electron executable to run the eval with (defaults to the current one). */
  nodePath?: string
  spawnFn?: typeof spawn
  timeoutMs?: number
}): Promise<string[]> {
  const kunDir = resolveKunDir(options.kunRoots)
  if (!kunDir) return Promise.resolve([])
  const spawnFn = options.spawnFn ?? spawn
  const timeoutMs = options.timeoutMs ?? 30_000
  const nodePath = options.nodePath ?? process.execPath
  const script = [
    `import { query } from ${JSON.stringify(SDK_PKG)};`,
    `let out = [];`,
    // supportedModels() lives on the Query (from query()), NOT the WarmQuery from
    // startup(). It's a control request — we call it and interrupt() WITHOUT
    // iterating the prompt, so no turn runs and the subscription isn't charged.
    `try { const q = query({ prompt: 'list-models', options: ${JSON.stringify(
      options.binaryPath ? { pathToClaudeCodeExecutable: options.binaryPath } : {}
    )} }); try { out = (await q.supportedModels()) || []; } finally { try { await q.interrupt?.(); } catch {} } } catch {}`,
    `process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(out) + ${JSON.stringify(MARK)});`,
    `process.exit(0);`
  ].join('\n')

  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let child: ReturnType<typeof spawn> | undefined

    const done = (models: string[]): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        child?.kill()
      } catch {
        // ignore
      }
      resolve(models)
    }

    try {
      child = spawnFn(nodePath, ['--input-type=module', '-e', script], {
        cwd: kunDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: scopedEnv(options.token)
      })
    } catch {
      done([])
      return
    }

    timer = setTimeout(() => done([]), timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
    })
    child.on('error', () => done([]))
    child.on('exit', () => done(parseModelIds(buffer)))
  })
}

/** Extract the framed JSON of ModelInfo[] from stdout and return unique model ids. */
export function parseModelIds(stdout: string): string[] {
  const start = stdout.indexOf(MARK)
  if (start < 0) return []
  const end = stdout.indexOf(MARK, start + MARK.length)
  if (end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.slice(start + MARK.length, end))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const ids = parsed.map(modelIdFromInfo).filter(Boolean)
  return [...new Set(ids)]
}

/**
 * The SDK's ModelInfo.value is an alias (`opus`/`sonnet`/`haiku`/`default`), but
 * its description carries the concrete version (`Opus 4.8`, `Sonnet 4.6`, …). We
 * prefer the specific code (`claude-opus-4-8`) and fall back to the alias.
 */
export function modelIdFromInfo(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const info = entry as { value?: unknown; description?: unknown }
  const description = typeof info.description === 'string' ? info.description : ''
  const match = description.match(/\b(opus|sonnet|haiku)\s+(\d+(?:\.\d+)*)/i)
  if (match) return `claude-${match[1].toLowerCase()}-${match[2].replace(/\./g, '-')}`
  return typeof info.value === 'string' ? info.value.trim() : ''
}
