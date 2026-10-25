import { describe, expect, it, beforeEach } from 'vitest'
import type { ModelDiscoveryResult } from '../services/provider-model-descriptors.js'
import { cursorAgentExecutionOptions } from '../runtime/cursor/cursor-sdk-runtime-support.js'
import {
  clearCursorSubscriptionCatalog,
  cursorCatalogEntries,
  cursorHarnessModelInfo,
  cursorParamsForEffort,
  cursorTurnModelParams,
  loadCursorSubscriptionCatalog
} from './cursor-subscription-catalog.js'

const discovered = (): ModelDiscoveryResult => ({
  models: ['composer-2.5', 'grok-4.6'],
  modelProfiles: {},
  modelDetails: {
    'composer-2.5': {
      displayName: 'Composer 2.5',
      parameters: [{ id: 'fast', values: [{ value: 'false' }, { value: 'true' }] }]
    },
    'grok-4.6': {
      displayName: 'Grok 4.6',
      parameters: [{ id: 'reasoning', values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }, { value: 'ultra' }] }],
      variants: [{ displayName: 'Default', isDefault: true, params: [{ id: 'reasoning', value: 'high' }] }]
    }
  },
  source: 'provider',
  lastAttemptStatus: 'success'
})

describe('Cursor subscription catalog', () => {
  beforeEach(() => clearCursorSubscriptionCatalog())

  it('keeps SDK order and maps thinking levels without inventing fast as effort', () => {
    const entries = cursorCatalogEntries(discovered())
    expect(entries.map((entry) => entry.id)).toEqual(['composer-2.5', 'grok-4.6'])
    expect(entries[0]).toMatchObject({ displayName: 'Composer 2.5', reasoningEfforts: [] })
    expect(entries[0]?.thinking).toBeUndefined()
    expect(entries[1]).toMatchObject({
      displayName: 'Grok 4.6',
      reasoningEfforts: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high',
      thinking: { id: 'reasoning', values: { low: 'low', high: 'high', max: 'xhigh' } }
    })
    expect(cursorHarnessModelInfo(entries, { 'grok-4.6': ['text', 'image'] })[1]).toMatchObject({
      displayName: 'Grok 4.6', inputModalities: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max']
    })
  })

  it('caches a successful listing and sends the wire value for a chosen level', async () => {
    let calls = 0
    const discover = async () => {
      calls += 1
      return discovered()
    }
    const first = await loadCursorSubscriptionCatalog({ apiKey: 'cursor-secret', discover })
    const second = await loadCursorSubscriptionCatalog({ apiKey: 'cursor-secret', discover })
    expect(calls).toBe(1)
    expect(second).toBe(first)
    await loadCursorSubscriptionCatalog({ apiKey: 'cursor-secret', refresh: true, discover })
    expect(calls).toBe(2)

    expect(cursorParamsForEffort(first, 'grok-4.6', 'max')).toEqual([{ id: 'reasoning', value: 'xhigh' }])
    expect(cursorParamsForEffort(first, 'grok-4.6', 'auto')).toBeUndefined()
    expect(cursorParamsForEffort(first, 'composer-2.5', 'high')).toBeUndefined()
    const sent = cursorAgentExecutionOptions({
      workspace: '/tmp/work', apiKey: 'cursor-secret', model: 'grok-4.6', name: 'test',
      planMode: false, approvalPolicy: 'auto', sandboxMode: 'workspace-write',
      modelParams: cursorParamsForEffort(first, 'grok-4.6', 'high')
    })
    expect(sent.model).toEqual({ id: 'grok-4.6', params: [{ id: 'reasoning', value: 'high' }] })
    expect(cursorAgentExecutionOptions({
      workspace: '/tmp/work', apiKey: 'cursor-secret', model: 'grok-4.6', name: 'test',
      planMode: false, approvalPolicy: 'auto', sandboxMode: 'workspace-write'
    }).model).toEqual({ id: 'grok-4.6' })
  })

  it('does not list the account for Auto and survives a failed lookup', async () => {
    let calls = 0
    const discover = async () => { calls += 1; throw new Error('sdk unavailable') }
    expect(await cursorTurnModelParams({ apiKey: 'cursor-secret', modelId: 'grok-4.6', effort: 'auto', discover })).toBeUndefined()
    expect(calls).toBe(0)
    await expect(cursorTurnModelParams({
      apiKey: 'cursor-secret', modelId: 'grok-4.6', effort: 'high', discover
    })).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })
})
