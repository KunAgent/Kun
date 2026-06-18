import { describe, expect, it } from 'vitest'
import {
  defaultWorkflowSettings,
  mergeWorkflowSettings,
  normalizeWorkflowSettings
} from './app-settings-workflow'
import type { WorkflowV1 } from './app-settings-types'

describe('normalizeWorkflowSettings', () => {
  it('returns disabled defaults when given nothing', () => {
    const settings = normalizeWorkflowSettings(undefined)
    expect(settings.enabled).toBe(false)
    expect(settings.workflows).toEqual([])
    expect(defaultWorkflowSettings().workflows).toEqual([])
  })

  it('keeps known node kinds and drops unknown ones', () => {
    const settings = normalizeWorkflowSettings({
      enabled: true,
      workflows: [
        {
          id: 'wf-1',
          name: 'Demo',
          nodes: [
            { id: 'a', type: 'manual-trigger', name: '', position: { x: 0, y: 0 }, disabled: false, config: {} },
            { id: 'b', type: 'ai-agent', config: { prompt: 'hi' } },
            { id: 'c', type: 'not-a-real-node', config: {} }
          ]
        } as Partial<WorkflowV1>
      ]
    })
    const workflow = settings.workflows[0]
    expect(workflow.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    const aiNode = workflow.nodes.find((node) => node.id === 'b')
    expect(aiNode?.type).toBe('ai-agent')
    // Missing config fields are filled with defaults.
    expect(aiNode?.type === 'ai-agent' && aiNode.config.reasoningEffort).toBe('medium')
  })

  it('removes connections that reference missing nodes', () => {
    const settings = normalizeWorkflowSettings({
      workflows: [
        {
          id: 'wf-1',
          name: 'Demo',
          nodes: [
            { id: 'a', type: 'manual-trigger', config: {} },
            { id: 'b', type: 'delay', config: { delayMs: 500 } }
          ],
          connections: [
            { id: 'e1', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
            { id: 'e2', source: 'a', sourceHandle: 'out', target: 'ghost', targetHandle: 'in' }
          ]
        } as Partial<WorkflowV1>
      ]
    })
    const connections = settings.workflows[0].connections
    expect(connections.map((connection) => connection.id)).toEqual(['e1'])
  })

  it('caps run history at 20 entries', () => {
    const runs = Array.from({ length: 30 }, (_, index) => ({
      id: `run-${index}`,
      trigger: 'manual',
      status: 'success' as const,
      startedAt: '',
      finishedAt: '',
      message: '',
      nodeResults: []
    }))
    const settings = normalizeWorkflowSettings({
      workflows: [{ id: 'wf-1', name: 'Demo', nodes: [], connections: [], runs } as Partial<WorkflowV1>]
    })
    expect(settings.workflows[0].runs).toHaveLength(20)
    // Keeps the most recent runs.
    expect(settings.workflows[0].runs[19].id).toBe('run-29')
  })

  it('clamps http and delay config bounds', () => {
    const settings = normalizeWorkflowSettings({
      workflows: [
        {
          id: 'wf-1',
          name: 'Demo',
          nodes: [
            { id: 'h', type: 'http-request', config: { method: 'BOGUS', timeoutMs: 999_999_999 } },
            { id: 'd', type: 'delay', config: { delayMs: -5 } }
          ]
        } as Partial<WorkflowV1>
      ]
    })
    const http = settings.workflows[0].nodes.find((node) => node.id === 'h')
    const delay = settings.workflows[0].nodes.find((node) => node.id === 'd')
    expect(http?.type === 'http-request' && http.config.method).toBe('GET')
    expect(http?.type === 'http-request' && http.config.timeoutMs).toBe(600_000)
    expect(delay?.type === 'delay' && delay.config.delayMs).toBe(0)
  })
})

describe('mergeWorkflowSettings', () => {
  it('replaces the workflows array wholesale when present', () => {
    const current = normalizeWorkflowSettings({
      enabled: true,
      workflows: [{ id: 'old', name: 'Old', nodes: [], connections: [] } as Partial<WorkflowV1>]
    })
    const merged = mergeWorkflowSettings(current, {
      workflows: [{ id: 'new', name: 'New', nodes: [], connections: [] } as Partial<WorkflowV1>]
    })
    expect(merged.workflows.map((workflow) => workflow.id)).toEqual(['new'])
    expect(merged.enabled).toBe(true)
  })

  it('keeps presets when a patch omits them', () => {
    const current = normalizeWorkflowSettings({
      presets: [{ id: 'p1', label: 'My HTTP', nodeType: 'http-request', nodeName: 'Call API', config: { url: 'https://x' } }]
    })
    const merged = mergeWorkflowSettings(current, { enabled: true })
    expect(merged.presets.map((preset) => preset.id)).toEqual(['p1'])
  })
})

describe('normalizeWorkflowSettings presets', () => {
  it('normalizes a valid preset and drops one with an unknown node type', () => {
    const settings = normalizeWorkflowSettings({
      presets: [
        { id: 'p1', label: 'My HTTP', nodeType: 'http-request', nodeName: 'Call API', config: { url: 'https://x', method: 'POST' } },
        { id: 'bad', label: 'Bogus', nodeType: 'not-a-real-kind', nodeName: '', config: {} }
      ]
    })
    expect(settings.presets).toHaveLength(1)
    const preset = settings.presets[0]
    expect(preset.id).toBe('p1')
    expect(preset.nodeType).toBe('http-request')
    // Config is normalized through the node normalizer (defaults filled in).
    if (preset.config && 'method' in preset.config) {
      expect(preset.config.method).toBe('POST')
    }
  })

  it('falls back to a label from the node when none is given', () => {
    const settings = normalizeWorkflowSettings({
      presets: [{ id: 'p2', label: '', nodeType: 'delay', nodeName: 'Wait a bit', config: {} }]
    })
    expect(settings.presets[0].label).toBe('Wait a bit')
  })
})
