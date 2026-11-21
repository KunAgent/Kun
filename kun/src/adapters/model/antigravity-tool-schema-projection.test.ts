import { expect, it } from 'vitest'
import { projectAnthropicToolInputSchema } from './anthropic-tool-schema-projection.js'
import { projectAntigravityToolInputSchema } from './antigravity-tool-schema-projection.js'
import { createDesignOpenTool } from '../tool/design-open-tool.js'
import { buildVideoGenToolProviders } from '../tool/media-gen-tool-provider.js'
import { createReportOpenTool } from '../tool/report-open-tool.js'

it('accepts the actual enabled Grok video tool schema before sending the complete catalog to Antigravity', () => {
  const config = { enabled: true, protocol: 'grok-imagine-video', model: 'grok-imagine-video-1.5-preview',
    baseUrl: 'https://video.example.test/v1', apiKey: 'fixture-key' } as Parameters<typeof buildVideoGenToolProviders>[0]
  const tool = buildVideoGenToolProviders(config).providers[0]!.tools[0]!
  expect(tool.name).toBe('generate_video')
  const projected = projectAntigravityToolInputSchema(tool.inputSchema)
  expect((projected.properties as any).duration).toMatchObject({ type: 'integer', minimum: 6, maximum: 10 })
  expect((projected.properties as any).duration).not.toHaveProperty('enum')
  expect((tool.inputSchema.properties as any).duration.enum).toEqual([6, 10])
})

it('advertises Grok video durations without protobuf-incompatible enum entries or changing their numeric type', () => {
  const schema = { type: 'object', properties: {
    duration: { type: 'integer', enum: [6, 10], description: 'Video length.' },
    resolution: { type: 'string', enum: ['720p', '1080p'] }
  }, required: ['duration'] }
  const original = structuredClone(schema)
  expect(projectAntigravityToolInputSchema(schema)).toEqual({
    type: 'object', properties: {
      duration: { type: 'integer', minimum: 6, maximum: 10, description: 'Video length. Allowed values: 6, 10.' },
      resolution: { type: 'string', enum: ['720p', '1080p'] }
    }, required: ['duration']
  })
  expect(schema).toEqual(original)
})

it('projects nested enum schemas while preserving literal data and tighter numeric bounds', () => {
  const result = projectAntigravityToolInputSchema({ type: 'object', properties: {
    nested: { type: 'array', items: { type: 'object', properties: {
      duration: { type: 'integer', enum: [6, 10], minimum: 8, maximum: 9 },
      optional: { type: 'string', format: 'enum', enum: ['', 'ready', null] },
      empty: { type: 'string', enum: [] }
    } } }
  }, $defs: { flag: { type: 'boolean', enum: [true, false] } },
  examples: [{ enum: [6, 10] }] })
  const properties = ((result.properties as any).nested.items.properties)
  expect(properties.duration).toMatchObject({ type: 'integer', minimum: 8, maximum: 9 })
  expect(properties.duration).not.toHaveProperty('enum')
  expect(properties.optional).toEqual({ type: 'string', description: 'Allowed values: "", "ready", null.' })
  expect(properties.empty).toEqual({ type: 'string' })
  expect((result.$defs as any).flag).toEqual({ type: 'boolean', description: 'Allowed values: true, false.' })
  expect(result.examples).toEqual([{ enum: [6, 10] }])
})

it('keeps unrelated nested schema branches and annotations intact', () => {
  let nested: Record<string, unknown> = { type: 'string', enum: ['ready', 'done'] }
  for (let depth = 0; depth < 12; depth++) nested = { type: 'object', properties: { nested } }
  const schema = { ...nested, $id: 'https://schema.example.test/tool', 'x-display': 'task' }
  expect(projectAntigravityToolInputSchema(schema)).toEqual(schema)
})

it('projects const, exclusive bounds, and nested oneOf for eager Kun tools', () => {
  const projected = projectAntigravityToolInputSchema({
    type: 'object',
    properties: {
      branch: { const: 'default-branch' },
      version: { const: 1, description: 'Payload version.' },
      flag: { const: true },
      count: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 },
      ratio: { type: 'number', exclusiveMinimum: 0.5, exclusiveMaximum: 1.5 },
      mode: { oneOf: [{ const: 'auto' }, { const: 'manual' }] }
    }
  })
  const props = projected.properties as Record<string, Record<string, unknown>>
  expect(props.branch).toEqual({ type: 'string', enum: ['default-branch'] })
  expect(props.version).toEqual({ type: 'integer', minimum: 1, maximum: 1, description: 'Payload version. Allowed values: 1.' })
  expect(props.flag).toEqual({ type: 'boolean', description: 'Allowed values: true.' })
  expect(props.count).toEqual({ type: 'integer', minimum: 1, maximum: 9 })
  expect(props.ratio).toEqual({ type: 'number', minimum: 0.5, maximum: 1.5 })
  expect(props.mode).toEqual({
    anyOf: [
      { type: 'string', enum: ['auto'] },
      { type: 'string', enum: ['manual'] }
    ]
  })
})

it('projects design_open and report_open schemas without unsupported Gemini keywords', () => {
  const assertGeminiCompatible = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) assertGeminiCompatible(entry)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    expect(record).not.toHaveProperty('const')
    expect(record).not.toHaveProperty('oneOf')
    expect(record).not.toHaveProperty('exclusiveMinimum')
    expect(record).not.toHaveProperty('exclusiveMaximum')
    if ('enum' in record) {
      expect(Array.isArray(record.enum)).toBe(true)
      for (const value of record.enum as unknown[]) {
        expect(typeof value).toBe('string')
        expect((value as string).length).toBeGreaterThan(0)
      }
    }
    for (const value of Object.values(record)) assertGeminiCompatible(value)
  }

  const designProjected = projectAntigravityToolInputSchema(
    projectAnthropicToolInputSchema(createDesignOpenTool().inputSchema)
  )
  const reportProjected = projectAntigravityToolInputSchema(
    projectAnthropicToolInputSchema(createReportOpenTool().inputSchema)
  )
  assertGeminiCompatible(designProjected)
  assertGeminiCompatible(reportProjected)
})
