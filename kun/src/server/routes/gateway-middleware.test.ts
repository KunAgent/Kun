import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GatewayMiddlewareSchema, type GatewayMiddlewareConfig } from '../../contracts/gateway-middleware.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GatewayMiddlewareHost, ThinkTagSplitter } from './gateway-middleware.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kun-middleware-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const host = (entries: GatewayMiddlewareConfig[]) => new GatewayMiddlewareHost(dir, () => entries)
const request = (): ModelRequest => ({ threadId: 't', turnId: 'u', model: 'm', prefix: [], history: [], tools: [], systemPrompt: 'base',
  abortSignal: new AbortController().signal })
async function* chunks(...items: ModelStreamChunk[]): AsyncIterable<ModelStreamChunk> { yield* items }
async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const out: ModelStreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('built-in middleware', () => {
  it('maps models in order and counts calls', () => {
    const middleware = host([{ id: 'map', enabled: true, type: 'model-map', mapping: { fast: 'deepseek/flash', 'deepseek/flash': 'deepseek/flash-2' } }])
    expect(middleware.rewriteModel('fast')).toBe('deepseek/flash')
    expect(middleware.rewriteModel('other')).toBe('other')
    expect(middleware.stats()[0]).toMatchObject({ id: 'map', calls: 2, failures: 0 })
  })
  it('adds a system prompt only for the agents and models it names', () => {
    const middleware = host([{ id: 'p', enabled: true, type: 'system-prompt', text: 'Be brief.', position: 'append', agents: ['codex'] }])
    const forCodex = request()
    middleware.transformRequest(forCodex, { model: 'm', agent: 'codex' })
    expect(forCodex.systemPrompt).toBe('base\n\nBe brief.')
    const forOther = request()
    middleware.transformRequest(forOther, { model: 'm', agent: 'pi' })
    expect(forOther.systemPrompt).toBe('base')
  })
  it('moves <think> text that straddles deltas into reasoning, or strips it', async () => {
    const stream = chunks({ kind: 'assistant_text_delta', text: 'a<thi' }, { kind: 'assistant_text_delta', text: 'nk>plan</th' },
      { kind: 'assistant_text_delta', text: 'ink>b' }, { kind: 'completed', stopReason: 'stop' })
    const moved = await drain(host([{ id: 't', enabled: true, type: 'think-tags', mode: 'reasoning' }]).wrapStream(stream, { model: 'm' }))
    expect(moved).toEqual([{ kind: 'assistant_text_delta', text: 'a' }, { kind: 'assistant_reasoning_delta', text: 'plan' },
      { kind: 'assistant_text_delta', text: 'b' }, { kind: 'completed', stopReason: 'stop' }])
    const splitter = new ThinkTagSplitter()
    expect(splitter.push('x<think>hidden')).toEqual([{ text: 'x', reasoning: false }, { text: 'hidden', reasoning: true }])
  })
  it('skips disabled entries and rejects malformed config', () => {
    expect(host([{ id: 'map', enabled: false, type: 'model-map', mapping: { a: 'b' } }]).rewriteModel('a')).toBe('a')
    expect(GatewayMiddlewareSchema.safeParse({ id: 's', enabled: true, type: 'script', file: '../escape.js' }).success).toBe(false)
  })
})

describe('script middleware', () => {
  const script = (file: string, source: string): GatewayMiddlewareConfig => {
    writeFileSync(join(dir, file), source)
    return { id: file, enabled: true, type: 'script', file, options: { suffix: '!' } }
  }
  it('runs onModel, onSystemPrompt and onText with options and agent context', async () => {
    const middleware = host([script('m.js', `
      export function onModel(model, ctx) { return ctx.agent === 'codex' && model === 'fast' ? 'served' : undefined }
      export function onSystemPrompt(text, ctx) { return text + ctx.options.suffix }
      exports.onText = function (text) { return text === 'drop' ? null : text.toUpperCase() }`)])
    expect(middleware.rewriteModel('fast', { agent: 'codex' })).toBe('served')
    expect(middleware.rewriteModel('fast', { agent: 'pi' })).toBe('fast')
    const req = request()
    middleware.transformRequest(req, { model: 'm' })
    expect(req.systemPrompt).toBe('base!')
    const out = await drain(middleware.wrapStream(chunks({ kind: 'assistant_text_delta', text: 'hi' },
      { kind: 'assistant_text_delta', text: 'drop' }, { kind: 'completed', stopReason: 'stop' }), { model: 'm' }))
    expect(out).toEqual([{ kind: 'assistant_text_delta', text: 'HI' }, { kind: 'completed', stopReason: 'stop' }])
  })
  it('fails open on throws, bad results and timeouts, and reports load errors', async () => {
    const middleware = host([
      script('throws.js', `export function onModel() { throw new Error('boom') }`),
      script('slow.js', `export function onText(text) { for (;;) {} }`),
      script('broken.js', `export function onModel( {`)
    ])
    expect(middleware.rewriteModel('a')).toBe('a')
    const out = await drain(middleware.wrapStream(chunks({ kind: 'assistant_text_delta', text: 'kept' }, { kind: 'completed', stopReason: 'stop' }), { model: 'm' }))
    expect(out[0]).toEqual({ kind: 'assistant_text_delta', text: 'kept' })
    const stats = middleware.stats()
    expect(stats.find((entry) => entry.id === 'throws.js')).toMatchObject({ failures: 1, lastError: 'boom' })
    expect(stats.find((entry) => entry.id === 'slow.js')?.failures).toBe(1)
    expect(stats.find((entry) => entry.id === 'broken.js')?.loadError).toBeTruthy()
  }, 10_000)
  it('stacks entries in order: two maps chain, think-tags runs before a script onText', async () => {
    const middleware = host([
      { id: 'map-1', enabled: true, type: 'model-map', mapping: { fast: 'mid' } },
      script('route.js', `export function onModel(model) { return model === 'mid' ? 'deep' : undefined }`),
      { id: 'map-2', enabled: true, type: 'model-map', mapping: { deep: 'deep-2' } },
      { id: 'think', enabled: true, type: 'think-tags', mode: 'strip' },
      script('upper.js', `export function onText(text) { return text.toUpperCase() }`)
    ])
    expect(middleware.rewriteModel('fast')).toBe('deep-2')
    const out = await drain(middleware.wrapStream(chunks({ kind: 'assistant_text_delta', text: '<think>secret</think>ok' },
      { kind: 'completed', stopReason: 'stop' }), { model: 'm' }))
    expect(out).toEqual([{ kind: 'assistant_text_delta', text: 'OK' }, { kind: 'completed', stopReason: 'stop' }])
  })
  it('gives each call a fresh copy of options so a script cannot leak state through them', () => {
    const entry = script('mutate.js', `export function onModel(model, ctx) { ctx.options.count = (ctx.options.count || 0) + 1; return model + ctx.options.count }`)
    const middleware = host([entry])
    expect(middleware.rewriteModel('m')).toBe('m1')
    expect(middleware.rewriteModel('m')).toBe('m1')
    expect(entry).toMatchObject({ options: { suffix: '!' } })
  })
  it('cannot generate code from strings inside a script', () => {
    const middleware = host([script('eval.js', `export function onModel() { return eval('"x"') }`)])
    expect(middleware.rewriteModel('a')).toBe('a')
    expect(middleware.stats()[0]!.failures).toBe(1)
  })
})
