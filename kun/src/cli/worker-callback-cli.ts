/**
 * `kun worker <subcommand>` — shell-facing worker callbacks (05 §5). A
 * terminal agent or shell-only worker reaches the runtime's
 * `/v1/worker-callbacks/*` routes with the scoped `kgw_` token it was
 * launched with. Credentials arrive exclusively through the environment —
 * `KUN_WORKER_ENDPOINT`, `KUN_WORKER_TOKEN`, and for hooks `KUN_HOOK_TOKEN` —
 * never on argv, where any local process could read them.
 *
 * Every invocation prints exactly one JSON line on stdout. Exit codes:
 *   0 success · 1 server/other error · 2 usage · 3 auth · 4 timeout
 */

const USAGE = `kun worker <subcommand> [options]

Worker callbacks against the running Kun server.

Subcommands:
  progress "<summary>" [--phase <p>]      Report progress (investigating|implementing|verifying|blocked)
  ask "<question>" [--options a,b] [--timeout <s>]   Ask the manager; blocks until answered
  result --outcome <o> --summary "<s>" [--files a,b] [--check name=status]
                                        Submit the structured task report
  context [--query "<text>"] [--limit <n>] [--cursor <c>]   Read manager context
  hook <event>                            Forward a managed-hook event (reads JSON on stdin)

Environment:
  KUN_WORKER_ENDPOINT  Kun server base URL, e.g. http://127.0.0.1:18899
  KUN_WORKER_TOKEN     Scoped worker-callback token
  KUN_HOOK_TOKEN       Scoped hook-ingest token (hook subcommand only)
`

const HOOK_BODY_LIMIT_BYTES = 64 * 1024
const ASK_TIMEOUT_GRACE_MS = 30_000
const ASK_DEFAULT_TIMEOUT_S = 600

type WorkerIo = {
  stdin?: NodeJS.ReadableStream
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
}

const EXIT = { ok: 0, error: 1, usage: 2, auth: 3, timeout: 4 } as const

function fail(io: WorkerIo, code: number, message: string): number {
  io.stderr.write(`kun worker: ${message}\n`)
  return code
}

function emit(io: WorkerIo, value: unknown): void {
  io.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`)
}

/** Minimal `--flag value` / `--flag=value` parser; unknown flags are usage errors. */
function parseFlags(
  argv: readonly string[],
  allowed: ReadonlySet<string>
): { ok: true; positionals: string[]; flags: Map<string, string[]> } | { ok: false; error: string } {
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const equals = argument.indexOf('=')
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals)
    if (!allowed.has(name)) return { ok: false, error: `unknown option --${name}` }
    const inline = equals === -1 ? undefined : argument.slice(equals + 1)
    const value = inline ?? argv[++index]
    if (value === undefined) return { ok: false, error: `--${name} requires a value` }
    const list = flags.get(name) ?? []
    list.push(value)
    flags.set(name, list)
  }
  return { ok: true, positionals, flags }
}

function commaList(values: string[] | undefined): string[] | undefined {
  const items = values?.flatMap((value) => value.split(',')).map((v) => v.trim()).filter(Boolean)
  return items?.length ? items : undefined
}

async function readStdin(input: NodeJS.ReadableStream, limit: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.byteLength
    if (total > limit) return null
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function post(
  io: WorkerIo,
  endpoint: string,
  token: string,
  path: string,
  body: unknown,
  timeoutMs?: number
): Promise<{ code: number; payload?: unknown }> {
  const send = io.fetch ?? fetch
  let response: Response
  try {
    response = await send(`${endpoint.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {})
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    emit(io, { code: timedOut ? 'timeout' : 'unreachable', message: timedOut ? 'request timed out' : 'endpoint unreachable' })
    return { code: timedOut ? EXIT.timeout : EXIT.error }
  }
  const text = (await response.text()).trim()
  let payload: unknown = undefined
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = undefined }
  }
  if (response.status === 401 || response.status === 403) {
    emit(io, payload ?? { code: 'unauthorized', message: `HTTP ${response.status}` })
    return { code: EXIT.auth }
  }
  if (!response.ok) {
    emit(io, payload ?? { code: 'http_error', message: `endpoint returned HTTP ${response.status}` })
    return { code: EXIT.error }
  }
  emit(io, payload ?? { status: 'ok' })
  const timedOut = typeof payload === 'object' && payload !== null &&
    (payload as { status?: unknown }).status === 'timeout'
  return { code: timedOut ? EXIT.timeout : EXIT.ok }
}

function endpointAndToken(
  io: WorkerIo,
  env: Record<string, string | undefined>,
  tokenName: 'KUN_WORKER_TOKEN' | 'KUN_HOOK_TOKEN'
): { endpoint: string; token: string } | { code: number } {
  const endpoint = env.KUN_WORKER_ENDPOINT?.trim()
  if (!endpoint) return { code: fail(io, EXIT.usage, 'KUN_WORKER_ENDPOINT is not set') }
  const token = env[tokenName]?.trim()
  if (!token) return { code: fail(io, EXIT.usage, `${tokenName} is not set`) }
  return { endpoint, token }
}

export async function runWorkerCallbackCommand(argv: readonly string[], io: WorkerIo): Promise<number> {
  const subcommand = argv[0]
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.stdout.write(USAGE)
    return argv.length === 0 || subcommand === 'help' || subcommand === '--help' || subcommand === '-h'
      ? EXIT.ok
      : EXIT.usage
  }
  const env = io.env ?? process.env
  const rest = argv.slice(1)

  switch (subcommand) {
    case 'progress': {
      const parsed = parseFlags(rest, new Set(['phase']))
      if (!parsed.ok || parsed.positionals.length !== 1) {
        return fail(io, EXIT.usage, parsed.ok ? 'usage: kun worker progress "<summary>" [--phase <p>]' : parsed.error)
      }
      const auth = endpointAndToken(io, env, 'KUN_WORKER_TOKEN')
      if ('code' in auth) return auth.code
      const result = await post(io, auth.endpoint, auth.token, '/v1/worker-callbacks/progress', {
        summary: parsed.positionals[0],
        ...(parsed.flags.get('phase')?.[0] ? { phase: parsed.flags.get('phase')![0] } : {})
      })
      return result.code
    }
    case 'ask': {
      const parsed = parseFlags(rest, new Set(['options', 'timeout']))
      if (!parsed.ok || parsed.positionals.length !== 1) {
        return fail(io, EXIT.usage, parsed.ok ? 'usage: kun worker ask "<question>" [--options a,b] [--timeout <s>]' : parsed.error)
      }
      const timeoutRaw = parsed.flags.get('timeout')?.[0]
      const timeoutSeconds = timeoutRaw === undefined ? undefined : Number(timeoutRaw)
      if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0)) {
        return fail(io, EXIT.usage, '--timeout must be a positive integer of seconds')
      }
      const auth = endpointAndToken(io, env, 'KUN_WORKER_TOKEN')
      if ('code' in auth) return auth.code
      const timeoutMs = (timeoutSeconds ?? ASK_DEFAULT_TIMEOUT_S) * 1_000 + ASK_TIMEOUT_GRACE_MS
      const result = await post(io, auth.endpoint, auth.token, '/v1/worker-callbacks/ask', {
        question: parsed.positionals[0],
        ...(commaList(parsed.flags.get('options')) ? { options: commaList(parsed.flags.get('options')) } : {}),
        ...(timeoutSeconds ? { timeoutSeconds } : {})
      }, timeoutMs)
      return result.code
    }
    case 'result': {
      const parsed = parseFlags(rest, new Set(['outcome', 'summary', 'files', 'check', 'risks']))
      if (!parsed.ok) return fail(io, EXIT.usage, parsed.error)
      const outcome = parsed.flags.get('outcome')?.[0]
      const summary = parsed.flags.get('summary')?.[0]
      if (!outcome || !summary) {
        return fail(io, EXIT.usage, 'usage: kun worker result --outcome <succeeded|partial|failed> --summary "<text>"')
      }
      const checks: { name: string; status: 'passed' | 'failed' | 'skipped' }[] = []
      for (const entry of parsed.flags.get('check') ?? []) {
        const equals = entry.lastIndexOf('=')
        const name = equals === -1 ? entry : entry.slice(0, equals)
        const status = equals === -1 ? 'passed' : entry.slice(equals + 1)
        if (!name || (status !== 'passed' && status !== 'failed' && status !== 'skipped')) {
          return fail(io, EXIT.usage, '--check must be <name>=<passed|failed|skipped>')
        }
        checks.push({ name, status })
      }
      const auth = endpointAndToken(io, env, 'KUN_WORKER_TOKEN')
      if ('code' in auth) return auth.code
      const result = await post(io, auth.endpoint, auth.token, '/v1/worker-callbacks/result', {
        outcome,
        summary,
        ...(commaList(parsed.flags.get('files')) ? { filesChanged: commaList(parsed.flags.get('files')) } : {}),
        ...(checks?.length ? { checks } : {}),
        ...(commaList(parsed.flags.get('risks')) ? { risks: commaList(parsed.flags.get('risks')) } : {})
      })
      return result.code
    }
    case 'context': {
      const parsed = parseFlags(rest, new Set(['query', 'limit', 'cursor']))
      if (!parsed.ok || parsed.positionals.length !== 0) {
        return fail(io, EXIT.usage, parsed.ok ? 'usage: kun worker context [--query <text>] [--limit <n>]' : parsed.error)
      }
      const limitRaw = parsed.flags.get('limit')?.[0]
      const limit = limitRaw === undefined ? undefined : Number(limitRaw)
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
        return fail(io, EXIT.usage, '--limit must be a positive integer')
      }
      const auth = endpointAndToken(io, env, 'KUN_WORKER_TOKEN')
      if ('code' in auth) return auth.code
      const result = await post(io, auth.endpoint, auth.token, '/v1/worker-callbacks/context', {
        ...(parsed.flags.get('query')?.[0] ? { query: parsed.flags.get('query')![0] } : {}),
        ...(parsed.flags.get('cursor')?.[0] ? { cursor: parsed.flags.get('cursor')![0] } : {}),
        ...(limit ? { limit } : {})
      })
      return result.code
    }
    case 'hook': {
      const parsed = parseFlags(rest, new Set())
      if (!parsed.ok || parsed.positionals.length !== 1) {
        return fail(io, EXIT.usage, parsed.ok ? 'usage: kun worker hook <event>' : parsed.error)
      }
      const auth = endpointAndToken(io, env, 'KUN_HOOK_TOKEN')
      if ('code' in auth) return auth.code
      const raw = await readStdin(io.stdin ?? process.stdin, HOOK_BODY_LIMIT_BYTES)
      if (raw === null) return fail(io, EXIT.usage, `hook payload exceeds ${HOOK_BODY_LIMIT_BYTES} bytes`)
      let payload: unknown
      try {
        payload = raw.trim() ? JSON.parse(raw) : {}
      } catch {
        return fail(io, EXIT.usage, 'hook payload is not valid JSON')
      }
      const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
      const body = {
        event: parsed.positionals[0],
        sessionId: record.session_id ?? record.sessionId,
        toolName: record.tool_name ?? record.toolName,
        timestamp: record.timestamp ?? record.ts ?? record.time
      }
      const result = await post(io, auth.endpoint, auth.token, '/v1/activity/hooks', body)
      return result.code
    }
    default:
      io.stderr.write(`kun worker: unknown subcommand ${subcommand}\n`)
      io.stderr.write(USAGE)
      return EXIT.usage
  }
}
