import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import type { GatewayMiddlewareConfig, GatewayMiddlewareStats } from '../../contracts/gateway-middleware.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { tapGatewayStream } from './gateway-stream-tap.js'

/**
 * Runs gateway middleware on external agents' traffic at the protocol-neutral
 * layer, so one middleware serves Chat, Responses, Anthropic and Gemini
 * clients alike. Built-ins are declarative. Scripts are the user's trusted
 * code: each call runs under a time limit in a separate `node:vm` context and
 * fails open (the input passes unchanged and the failure is counted).
 * `node:vm` is not a security boundary, which is why only files in the
 * runtime's own middleware folder can be loaded.
 */
const MODEL_LIMIT_MS = 250
const TEXT_LIMIT_MS = 50
const LOAD_LIMIT_MS = 1_000

export type MiddlewareContext = { model: string; agent?: string }

type Script = {
  mtimeMs: number
  context: vm.Context
  call: vm.Script
  hooks: Set<string>
  loadError?: string
}

type Counters = { calls: number; failures: number; nanos: bigint; lastError?: string }

export class GatewayMiddlewareHost {
  private readonly scripts = new Map<string, Script>()
  private readonly counters = new Map<string, Counters>()

  constructor(private readonly directory: string, private readonly configured: () => readonly GatewayMiddlewareConfig[]) {}

  /** The only folder scripts can be loaded from. */
  get folder(): string { return this.directory }

  private active(): GatewayMiddlewareConfig[] {
    return this.configured().filter((entry) => entry.enabled)
  }

  private count(id: string, started: bigint, error?: unknown): void {
    const counters = this.counters.get(id) ?? { calls: 0, failures: 0, nanos: 0n }
    counters.calls += 1
    counters.nanos += process.hrtime.bigint() - started
    if (error !== undefined) {
      counters.failures += 1
      counters.lastError = errorText(error)
    }
    this.counters.set(id, counters)
  }

  /** Compiles a script once per file version. Exports use `export function name` or `exports.name = …`. */
  private script(entry: Extract<GatewayMiddlewareConfig, { type: 'script' }>): Script {
    const path = join(this.directory, entry.file)
    let mtimeMs = -1
    try { mtimeMs = statSync(path).mtimeMs } catch { /* reported below */ }
    const cached = this.scripts.get(entry.id)
    if (cached && cached.mtimeMs === mtimeMs) return cached
    const context = vm.createContext({ exports: {}, console: { log: () => undefined, warn: () => undefined, error: () => undefined },
      __fn: undefined, __arg: undefined, __ctx: undefined, __result: undefined },
    { codeGeneration: { strings: false, wasm: false } })
    const call = new vm.Script('__result = __fn(__arg, __ctx)')
    let loadError: string | undefined
    try {
      const source = readFileSync(path, 'utf8')
        .replace(/^\s*export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, 'exports.$2 = $1function $2')
        .replace(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/gm, 'exports.$1 =')
      new vm.Script(source, { filename: entry.file }).runInContext(context, { timeout: LOAD_LIMIT_MS })
    } catch (error) {
      loadError = errorText(error)
    }
    const exported = (context.exports ?? {}) as Record<string, unknown>
    const hooks = new Set(Object.keys(exported).filter((name) => typeof exported[name] === 'function'))
    const script: Script = { mtimeMs, context, call, hooks, ...(loadError ? { loadError } : {}) }
    this.scripts.set(entry.id, script)
    return script
  }

  /** Calls a script hook under a time limit; any failure or non-matching result keeps the input. */
  private invoke<T>(entry: Extract<GatewayMiddlewareConfig, { type: 'script' }>, hook: string, arg: T, ctx: MiddlewareContext,
    limit: number, accept: (value: unknown) => boolean): T | null | undefined {
    const script = this.script(entry)
    if (script.loadError || !script.hooks.has(hook)) return undefined
    const started = process.hrtime.bigint()
    try {
      const context = script.context as Record<string, unknown>
      context.__fn = (context.exports as Record<string, unknown>)[hook]
      context.__arg = arg
      context.__ctx = Object.freeze({ ...ctx, options: structuredClone(entry.options ?? {}) })
      context.__result = undefined
      script.call.runInContext(script.context, { timeout: limit })
      const result = context.__result
      if (result === undefined) { this.count(entry.id, started); return undefined }
      if (!accept(result)) throw new Error(`${hook} returned an unsupported value`)
      this.count(entry.id, started)
      return result as T | null
    } catch (error) {
      this.count(entry.id, started, error)
      return undefined
    }
  }

  /** The model a request is served by: `model-map` entries, then script `onModel` hooks, in order. */
  rewriteModel(model: string, ctx: Omit<MiddlewareContext, 'model'> = {}): string {
    let current = model
    for (const entry of this.active()) {
      if (entry.type === 'model-map') {
        const started = process.hrtime.bigint()
        const mapped = entry.mapping[current]
        this.count(entry.id, started)
        if (mapped) current = mapped
      } else if (entry.type === 'script') {
        const next = this.invoke(entry, 'onModel', current, { ...ctx, model: current }, MODEL_LIMIT_MS,
          (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 512)
        if (typeof next === 'string') current = next.trim()
      }
    }
    return current
  }

  /** System prompt changes from `system-prompt` entries and script `onSystemPrompt` hooks. */
  transformRequest(request: ModelRequest, ctx: MiddlewareContext): void {
    for (const entry of this.active()) {
      if (entry.type === 'system-prompt') {
        if (entry.agents?.length && !entry.agents.includes(ctx.agent ?? '')) continue
        if (entry.models?.length && !entry.models.includes(ctx.model)) continue
        const started = process.hrtime.bigint()
        const current = request.systemPrompt ?? ''
        request.systemPrompt = entry.position === 'replace' ? entry.text
          : entry.position === 'prepend' ? [entry.text, current].filter(Boolean).join('\n\n')
            : [current, entry.text].filter(Boolean).join('\n\n')
        this.count(entry.id, started)
      } else if (entry.type === 'script') {
        const next = this.invoke(entry, 'onSystemPrompt', request.systemPrompt ?? '', ctx, MODEL_LIMIT_MS,
          (value) => typeof value === 'string' && value.length <= 200_000)
        if (typeof next === 'string') request.systemPrompt = next
      }
    }
  }

  /** Text-level reply transforms: `think-tags` and script `onText` hooks (null drops a delta). */
  wrapStream(source: AsyncIterable<ModelStreamChunk>, ctx: MiddlewareContext): AsyncIterable<ModelStreamChunk> {
    const entries = this.active().filter((entry) => entry.type === 'think-tags' || entry.type === 'script')
    if (!entries.length) return source
    const splitters = new Map(entries.filter((entry) => entry.type === 'think-tags').map((entry) => [entry.id, new ThinkTagSplitter()]))
    const host = this
    return {
      [Symbol.asyncIterator]() {
        const iterator = tapGatewayStream(source, () => undefined)[Symbol.asyncIterator]()
        const queue: ModelStreamChunk[] = []
        return {
          async next() {
            for (;;) {
              if (queue.length) return { done: false, value: queue.shift()! }
              const result = await iterator.next()
              if (result.done) return result
              queue.push(...host.transformChunk(result.value, entries, splitters, ctx))
            }
          },
          async return(value?: unknown) { return iterator.return ? iterator.return(value) : { done: true, value: undefined } },
          async throw(error?: unknown) { if (iterator.throw) return iterator.throw(error); throw error }
        }
      }
    }
  }

  private transformChunk(chunk: ModelStreamChunk, entries: GatewayMiddlewareConfig[], splitters: Map<string, ThinkTagSplitter>,
    ctx: MiddlewareContext): ModelStreamChunk[] {
    let chunks: ModelStreamChunk[] = [chunk]
    for (const entry of entries) {
      const next: ModelStreamChunk[] = []
      for (const current of chunks) {
        if (entry.type === 'think-tags') {
          const started = process.hrtime.bigint()
          const splitter = splitters.get(entry.id)!
          if (current.kind === 'assistant_text_delta') {
            for (const part of splitter.push(current.text)) {
              if (part.reasoning) { if (entry.mode === 'reasoning') next.push({ ...current, kind: 'assistant_reasoning_delta', text: part.text }) }
              else next.push({ ...current, text: part.text })
            }
          } else if (current.kind === 'completed' || current.kind === 'error') {
            const rest = splitter.flush()
            if (rest) next.push({ kind: 'assistant_text_delta', text: rest, ...(current.route ? { route: current.route } : {}) })
            next.push(current)
          } else next.push(current)
          this.count(entry.id, started)
        } else if (entry.type === 'script' && current.kind === 'assistant_text_delta') {
          const text = this.invoke(entry, 'onText', current.text, ctx, TEXT_LIMIT_MS,
            (value) => value === null || (typeof value === 'string' && value.length <= 1_000_000))
          if (text === null) continue
          next.push(typeof text === 'string' ? { ...current, text } : current)
        } else next.push(current)
      }
      chunks = next
    }
    return chunks.filter((entry) => entry.kind !== 'assistant_text_delta' || entry.text.length > 0)
  }

  stats(): GatewayMiddlewareStats[] {
    return this.configured().map((entry) => {
      const counters = this.counters.get(entry.id)
      const loadError = entry.type === 'script' && entry.enabled ? this.script(entry).loadError : undefined
      return { id: entry.id, type: entry.type, enabled: entry.enabled, calls: counters?.calls ?? 0, failures: counters?.failures ?? 0,
        averageMicros: counters?.calls ? Number(counters.nanos / BigInt(counters.calls)) / 1_000 : 0,
        ...(counters?.lastError ? { lastError: counters.lastError } : {}), ...(loadError ? { loadError } : {}) }
    })
  }
}

/** Splits streamed text at `<think>`/`</think>` tags that may straddle deltas. */
export class ThinkTagSplitter {
  private buffer = ''
  private inside = false

  push(text: string): { text: string; reasoning: boolean }[] {
    this.buffer += text
    const out: { text: string; reasoning: boolean }[] = []
    for (;;) {
      const tag = this.inside ? '</think>' : '<think>'
      const index = this.buffer.indexOf(tag)
      if (index >= 0) {
        if (index > 0) out.push({ text: this.buffer.slice(0, index), reasoning: this.inside })
        this.buffer = this.buffer.slice(index + tag.length)
        this.inside = !this.inside
        continue
      }
      // Keep a possible partial tag at the end for the next delta.
      let keep = 0
      for (let size = Math.min(tag.length - 1, this.buffer.length); size > 0; size -= 1) {
        if (tag.startsWith(this.buffer.slice(-size))) { keep = size; break }
      }
      const emit = this.buffer.slice(0, this.buffer.length - keep)
      if (emit) out.push({ text: emit, reasoning: this.inside })
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      return out
    }
  }

  flush(): string {
    const rest = this.inside ? '' : this.buffer
    this.buffer = ''
    return rest
  }
}

/** Errors thrown inside a vm context come from another realm, so `instanceof Error` is false. */
function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message
  return (typeof message === 'string' ? message : String(error)).slice(0, 300)
}

const HOSTS = new WeakMap<object, GatewayMiddlewareHost>()

export function gatewayMiddlewareHost(owner: object, directory: string, configured: () => readonly GatewayMiddlewareConfig[]): GatewayMiddlewareHost {
  let host = HOSTS.get(owner)
  if (!host) { host = new GatewayMiddlewareHost(directory, configured); HOSTS.set(owner, host) }
  return host
}
