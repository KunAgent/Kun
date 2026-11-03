import { parseProviderModelDescriptor } from '../../kun/src/services/provider-model-descriptors.js'
import type { ModelProviderModelProfileV1 } from '../shared/app-settings'
import { metadataEvidence } from '../../kun/src/contracts/model-metadata-evidence.js'
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
import { runOwnedCommand } from './owned-command'

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

type SdkModelOptions = {
  token?: string
  kunRoots: readonly string[]
  /** Explicit Claude Code binary path (when not bundled in kun/node_modules). */
  binaryPath?: string
  /** Node/Electron executable to run the eval with (defaults to the current one). */
  nodePath?: string
  spawnFn?: typeof spawn
  timeoutMs?: number
}

export async function fetchSdkModels(options: SdkModelOptions): Promise<string[]> {
  return (await fetchSdkModelCatalog(options)).map((model) => model.id)
}

export type ClaudeSdkCatalogModel = { id: string; displayName?: string; aliases?: string[]; inferredModelId?: string; profile?: Partial<ModelProviderModelProfileV1> }

export function fetchSdkModelCatalog(options: SdkModelOptions): Promise<ClaudeSdkCatalogModel[]> {
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

  if (!options.spawnFn) {
    return runOwnedCommand(nodePath, ['--input-type=module', '-e', script], {
      cwd: kunDir, env: scopedEnv(options.token), timeoutMs, maxOutputBytes: 1024 * 1024
    }).then((result) => parseModelCatalog(result.stdout), () => [])
  }

  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let child: ReturnType<typeof spawn> | undefined

    const done = (models: ClaudeSdkCatalogModel[]): void => {
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
    child.on('exit', () => done(parseModelCatalog(buffer)))
  })
}

/** Extract the framed JSON of ModelInfo[] from stdout and return unique model ids. */
export function parseModelIds(stdout: string): string[] { return parseModelCatalog(stdout).map((model) => model.id) }

export function parseModelCatalog(stdout: string): ClaudeSdkCatalogModel[] {
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
  const models = new Map<string, ClaudeSdkCatalogModel>()
  for (const entry of parsed.slice(0, 500)) {
    const id = modelIdFromInfo(entry)
    if (!id || id.length > 512 || models.has(id)) continue
    const info = entry as Record<string, unknown>
    const inferredModelId = modelIdFromDescription(info.description)
    const aliases = [info.value, inferredModelId].filter((alias): alias is string => typeof alias === 'string' && alias !== id && !!alias)
    const facts = parseProviderModelDescriptor(info, 'anthropic-thinking')
    models.set(id, { id,
      ...(typeof info.displayName === 'string' ? { displayName: info.displayName.slice(0, 256) } : {}),
      ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
      ...(inferredModelId && inferredModelId !== id ? { inferredModelId } : {}),
      ...(Object.keys(facts).some((field) => field !== 'evidence') ? { profile: { ...facts, evidence: metadataEvidence(facts, 'provider', new Date().toISOString()) } } : {})
    })
  }
  return [...models.values()]
}

/** Explicit SDK identifiers are authoritative; descriptive aliases are only hints. */
export function modelIdFromInfo(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const info = entry as Record<string, unknown>
  for (const field of ['modelId', 'id', 'value']) {
    if (typeof info[field] === 'string' && info[field].trim()) return info[field].trim()
  }
  return ''
}

function modelIdFromDescription(description: unknown): string | undefined {
  const match = typeof description === 'string' ? description.match(/\b(opus|sonnet|haiku)\s+(\d+(?:\.\d+)*)/i) : undefined
  return match ? `claude-${match[1].toLowerCase()}-${match[2].replace(/\./g, '-')}` : undefined
}
