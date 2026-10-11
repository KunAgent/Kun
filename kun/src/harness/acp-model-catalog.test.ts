import { expect, it } from 'vitest'
import { acpModelCatalog } from './acp-model-catalog.js'
import type { AcpConfigOption } from '../runtime/acp/acp-schema.js'

const configOptions = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'swe-2-high', options: [
  { value: 'swe-2-high', name: 'SWE-2', _meta: { 'cognition.ai/supportsImages': true } },
  { value: 'claude-opus-medium', name: 'Claude Opus', _meta: { 'cognition.ai/supportsImages': false } },
  { value: 'fusion-lead-sidekick-helper', name: 'Fusion (Lead + Helper)' }
] }, { id: 'effort', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: 'high', options: [
  { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }, { value: 'max', name: 'Max' }
] }] as AcpConfigOption[]

it('preserves native order, display names and per-model image facts without adding legacy variants', () => {
  const result = acpModelCatalog({ harnessId: 'devin', configOptions,
    models: { availableModels: [{ modelId: 'claude-opus-high' }] } })
  expect(result.models).toEqual(['swe-2-high', 'claude-opus-medium', 'fusion-lead-sidekick-helper'])
  expect(result.modelInfo[0]).toMatchObject({ displayName: 'SWE-2', isDefault: true,
    inputModalities: ['text', 'image'], reasoningEfforts: ['medium', 'high', 'max'], defaultReasoningEffort: 'high' })
  expect(result.modelInfo[1]).toMatchObject({ displayName: 'Claude Opus', inputModalities: ['text'] })
  expect(result.modelInfo[1].reasoningEfforts).toBeUndefined()
  expect(result.modelInfo[2]).toMatchObject({ category: 'fusion' })
})

it('retains legacy labels when there is no modern selector and drops malformed entries', () => {
  expect(acpModelCatalog({ harnessId: 'other', models: { currentModelId: 'legacy',
    availableModels: [null, {}, { modelId: ' ' }, { modelId: 'legacy', name: 'Legacy Model' }] } }))
    .toMatchObject({ models: ['legacy'], modelInfo: [{ id: 'legacy', displayName: 'Legacy Model', isDefault: true }] })
})

it('reads reasoning choices for the selected model without changing the native default', () => {
  const options = structuredClone(configOptions)
  ;(options[0] as { currentValue: string }).currentValue = 'claude-opus-medium'
  const result = acpModelCatalog({ harnessId: 'devin', configOptions: options, defaultModel: 'swe-2-high' })
  expect(result.modelInfo[0].isDefault).toBe(true)
  expect(result.modelInfo[0].reasoningEfforts).toBeUndefined()
  expect(result.modelInfo[1].reasoningEfforts).toEqual(['medium', 'high', 'max'])
})

it('folds legacy reasoning variants into their base model and marks models without levels', () => {
  const result = acpModelCatalog({ harnessId: 'opencode', models: { currentModelId: 'openai/gpt-5.2/high', availableModels: [
    { modelId: 'openai/gpt-5.2', name: 'GPT-5.2' }, { modelId: 'openai/gpt-5.2/high', name: 'GPT-5.2 (high)' },
    { modelId: 'openai/gpt-5.2/low' }, { modelId: 'openai/gpt-5.2/xhigh' }, { modelId: 'openai/gpt-5.2/fast' },
    { modelId: 'local/llama' }, { modelId: 'orphan/model/high' }
  ] } })
  expect(result.models).toEqual(['openai/gpt-5.2', 'openai/gpt-5.2/fast', 'local/llama', 'orphan/model/high'])
  expect(result.modelInfo[0]).toMatchObject({ id: 'openai/gpt-5.2', displayName: 'GPT-5.2', isDefault: true,
    reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' })
  // Reasoning is chosen only through variants, so the rest have no levels to offer.
  expect(result.modelInfo.slice(1).map((entry) => entry.reasoningEfforts)).toEqual([[], [], []])
})
