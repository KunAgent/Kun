import { describe, expect, it } from 'vitest'
import {
  graphParentAuthorityToolNames,
  graphWorkerToolNamesWithin,
  isGraphLeadContext,
  isToolAllowedInOrchestration
} from './graph-tool-boundary.js'

describe('Graph tool boundary', () => {
  it('recognizes both selected Graph turns and automatic Graph Lead turns', () => {
    expect(isGraphLeadContext({ orchestration: 'graph' })).toBe(true)
    expect(isGraphLeadContext({
      orchestration: 'direct',
      messageSource: 'graph_runtime'
    })).toBe(true)
    expect(isGraphLeadContext({ orchestration: 'direct' })).toBe(false)
  })

  it('blocks ordinary delegation providers and legacy orchestration only in Graph', () => {
    expect(isToolAllowedInOrchestration({
      toolName: 'delegate_task',
      providerId: 'delegation',
      providerKind: 'delegation'
    }, { orchestration: 'graph' })).toBe(false)
    expect(isToolAllowedInOrchestration({
      toolName: 'task_graph',
      providerId: 'planning',
      providerKind: 'built-in'
    }, { messageSource: 'graph_runtime' })).toBe(false)
    expect(isToolAllowedInOrchestration({
      toolName: 'delegate_task',
      providerId: 'delegation',
      providerKind: 'delegation'
    }, { orchestration: 'direct' })).toBe(true)
  })

  it('keeps Lab fast_context available on Graph Lead turns', () => {
    expect(isToolAllowedInOrchestration({
      toolName: 'fast_context',
      providerId: 'fast-context',
      providerKind: 'delegation'
    }, { orchestration: 'graph' })).toBe(true)
    expect(isToolAllowedInOrchestration({
      toolName: 'fast_context',
      providerId: 'fast-context',
      providerKind: 'delegation'
    }, { messageSource: 'graph_runtime' })).toBe(true)
  })

  it('builds executor authority with Fast Context but without orchestration tools', () => {
    const names = graphParentAuthorityToolNames([
      'read',
      'report_to_parent',
      'graph_create_run',
      'graph_worker_submit_result',
      'delegate_task',
      'list_subagent_profiles',
      'task_graph',
      'design_component',
      'fast_context'
    ])

    expect(names).toEqual(['fast_context', 'read'])
    expect(graphWorkerToolNamesWithin(names)).toEqual(['fast_context'])
    expect(graphWorkerToolNamesWithin(['read', 'fast_context', 'report_to_parent']))
      .toEqual(['fast_context', 'report_to_parent'])
  })
})
