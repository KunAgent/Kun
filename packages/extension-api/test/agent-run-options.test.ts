import { describe, expect, it } from 'vitest'
import {
  AgentCreateRunRequestSchema,
  AgentRunOptionsSchema
} from '../src/index.js'

describe('Agent run model options', () => {
  it('accepts the stable Kun model and reasoning selection contract', () => {
    expect(AgentRunOptionsSchema.parse({
      defaultModel: 'gpt-5.6-sol',
      models: [{
        id: 'gpt-5.6-sol',
        displayName: 'gpt-5.6-sol',
        selected: true,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
        defaultReasoningEffort: 'high'
      }]
    })).toMatchObject({ defaultModel: 'gpt-5.6-sol' })

    expect(AgentCreateRunRequestSchema.parse({
      input: 'Implement the task',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max'
    })).toMatchObject({ model: 'gpt-5.6-sol', reasoningEffort: 'max' })
  })

  it('rejects provider-specific wire efforts and unknown fields', () => {
    expect(AgentCreateRunRequestSchema.safeParse({
      input: 'Implement the task',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh'
    }).success).toBe(false)
    expect(AgentRunOptionsSchema.safeParse({
      defaultModel: 'gpt-5.6-sol',
      models: [{
        id: 'gpt-5.6-sol',
        displayName: 'gpt-5.6-sol',
        selected: true,
        reasoningEfforts: ['low'],
        defaultReasoningEffort: 'high'
      }]
    }).success).toBe(false)
    expect(AgentRunOptionsSchema.safeParse({
      defaultModel: 'gpt-5.6-sol',
      models: [{
        id: 'gpt-5.6-sol',
        displayName: 'gpt-5.6-sol',
        selected: true,
        reasoningEfforts: ['high'],
        credential: 'secret'
      }]
    }).success).toBe(false)
  })

  it('accepts Kun model identifiers up to the runtime contract limit', () => {
    const model = 'm'.repeat(512)
    expect(AgentRunOptionsSchema.safeParse({
      defaultModel: model,
      models: [{ id: model, displayName: model, selected: true, reasoningEfforts: [] }]
    }).success).toBe(true)
    expect(AgentCreateRunRequestSchema.safeParse({ input: 'Task', model }).success).toBe(true)
    expect(AgentCreateRunRequestSchema.safeParse({
      input: 'Task', model: `${model}x`
    }).success).toBe(false)
  })
})
