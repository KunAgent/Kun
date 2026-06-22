import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRuntimeContextInstruction,
  resolvePlanModeToolSpecs,
  shouldInjectInitialRuntimeContext
} from './agent-loop.js'
import type { ModelToolSpec } from '../ports/model-client.js'

function spec(name: string): ModelToolSpec {
  return {
    name,
    description: `Tool: ${name}`,
    toolKind: name === 'create_plan' || name === 'write' || name === 'edit'
      ? 'file_change'
      : 'tool_call',
    inputSchema: { type: 'object', properties: {} }
  }
}

const ALL_TOOLS: ModelToolSpec[] = [
  spec('read'),
  spec('write'),
  spec('edit'),
  spec('ls'),
  spec('find'),
  spec('grep'),
  spec('bash'),
  spec('web_search'),
  spec('web_fetch'),
  spec('create_plan')
]

const READ_ONLY_TOOLS = new Set([
  'read', 'ls', 'find', 'grep', 'web_search', 'web_fetch'
])

describe('resolvePlanModeToolSpecs', () => {
  it('step 0: read-only tools + create_plan only', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('ls')
    expect(names).toContain('find')
    expect(names).toContain('grep')
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
    expect(names).toContain('create_plan')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('bash')
  })

  it('step > 0: only create_plan', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('create_plan')
  })

  it('plan satisfied: returns all tools unchanged (pass-through)', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: true,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toBe(ALL_TOOLS)
  })

  it('not plan-active: returns all tools unchanged (pass-through)', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: false,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toBe(ALL_TOOLS)
  })

  it('uses PLAN_READ_ONLY_TOOL_NAMES default when readOnlyToolNames omitted', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0
    })
    const names = result.map((t) => t.name)
    // Default set excludes bash
    expect(names).not.toContain('bash')
    expect(names).toContain('create_plan')
    expect(names).toContain('read')
  })

  it('uses CREATE_PLAN_TOOL_NAME default when planToolName omitted', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('create_plan')
  })

  it('custom readOnlyToolNames and planToolName', () => {
    const customTools: ModelToolSpec[] = [
      spec('custom-read'),
      spec('custom-plan'),
      spec('write'),
      spec('bash')
    ]
    const result = resolvePlanModeToolSpecs(customTools, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: new Set(['custom-read']),
      planToolName: 'custom-plan'
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('custom-read')
    expect(names).toContain('custom-plan')
    expect(names).not.toContain('write')
    expect(names).not.toContain('bash')
  })
})

describe('buildRuntimeContextInstruction', () => {
  it('includes the opened project absolute path and formatted local time context', () => {
    const instruction = buildRuntimeContextInstruction({
      workspace: '/tmp/kun-test-project',
      nowIso: '2000-01-02T03:04:05.000Z',
      timeZone: 'UTC'
    })

    expect(instruction).toContain('Current opened project absolute path: `/tmp/kun-test-project`')
    expect(instruction).toContain('Current user local time: 2000-01-02 03:04:05 Sunday (UTC')
    expect(instruction).toContain('GMT')
    expect(instruction).toContain('Treat this block as environment context')
  })

  it('normalizes relative workspace paths to absolute paths', () => {
    const instruction = buildRuntimeContextInstruction({
      workspace: 'relative-project',
      nowIso: '2026-06-21T04:30:15.000Z',
      timeZone: 'UTC'
    })

    expect(instruction).toContain(`Current opened project absolute path: \`${resolve('relative-project')}\``)
  })
})

describe('shouldInjectInitialRuntimeContext', () => {
  it('injects only for the first model step of the first thread turn', () => {
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 0,
      turnId: 'turn_1',
      historyItems: [
        {
          id: 'item_turn_1_user',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          kind: 'user_message',
          text: 'hello',
          status: 'completed',
          createdAt: '2000-01-02T03:04:05.000Z'
        }
      ]
    })).toBe(true)
  })

  it('does not inject for tool continuations or later turns', () => {
    const currentTurnItem = {
      id: 'item_turn_2_user',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'user' as const,
      kind: 'user_message' as const,
      text: 'next',
      status: 'completed' as const,
      createdAt: '2000-01-02T03:04:05.000Z'
    }
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 1,
      turnId: 'turn_2',
      historyItems: [currentTurnItem]
    })).toBe(false)
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 0,
      turnId: 'turn_2',
      historyItems: [
        {
          ...currentTurnItem,
          id: 'item_turn_1_user',
          turnId: 'turn_1',
          text: 'previous'
        },
        currentTurnItem
      ]
    })).toBe(false)
  })
})
