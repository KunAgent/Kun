import { describe, expect, it } from 'vitest'
import { isAntigravityOrchestrator, parseAntigravityModelCatalog } from './antigravity-model-catalog.js'

describe('parseAntigravityModelCatalog', () => {
  it('parses display names and CRLF while grouping effort variants and duplicates', () => {
    expect(parseAntigravityModelCatalog([
      'gemini-3.7-flash-high      Gemini 3.7 Flash (High)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-low       Gemini 3.7 Flash (Low)',
      'gemini-3.7-flash-high      duplicate',
      'claude-sonnet-4-6          Claude Sonnet 4.6'
    ].join('\r\n'))).toEqual({ models: [
      {
        id: 'gemini-3.7-flash',
        supportedEfforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium'
      },
      {
        id: 'claude-sonnet-4-6',
        supportedEfforts: ['medium'],
        defaultEffort: 'medium'
      }
    ] })
  })

  it('does not invent a medium budget for any Orchestrator variant in agy models', () => {
    expect(isAntigravityOrchestrator('gemini-pro-orchestrator')).toBe(true)
    expect(isAntigravityOrchestrator('gemini-pro-orchestrator-argon')).toBe(true)
    expect(isAntigravityOrchestrator('gemini-pro-orchestrator-neon')).toBe(true)
    expect(isAntigravityOrchestrator('models/gemini-pro-orchestrator-neon')).toBe(true)
    expect(isAntigravityOrchestrator('gemini-4-carbon')).toBe(false)
    const { models } = parseAntigravityModelCatalog([
      'gemini-pro-orchestrator        Orchestrator (Carbon)',
      'gemini-pro-orchestrator-argon  Orchestrator (Argon)',
      'gemini-pro-orchestrator-neon   Orchestrator (Neon)',
      'gemini-4-carbon-high           Gemini 4 Carbon (High)',
      'gemini-4-hydrogen-xhigh        Gemini 4 Hydrogen (XHigh)'
    ].join('\n'))
    expect(models).toEqual([
      { id: 'gemini-pro-orchestrator', supportedEfforts: [] },
      { id: 'gemini-pro-orchestrator-argon', supportedEfforts: [] },
      { id: 'gemini-pro-orchestrator-neon', supportedEfforts: [] },
      { id: 'gemini-4-carbon', supportedEfforts: ['high'], defaultEffort: 'high' },
      { id: 'gemini-4-hydrogen', supportedEfforts: ['xhigh'], defaultEffort: 'xhigh' }
    ])
  })

  it('chooses high when medium is unavailable', () => {
    expect(parseAntigravityModelCatalog('gemini-3.5-flash-low\ngemini-3.5-flash-high'))
      .toEqual({ models: [{
        id: 'gemini-3.5-flash',
        supportedEfforts: ['low', 'high'],
        defaultEffort: 'high'
      }] })
  })

  it('ignores logs, malformed ids, empty output, and overlong ids', () => {
    const overlong = `model-${'x'.repeat(130)}`
    expect(parseAntigravityModelCatalog([
      'Loading models...',
      'not/a-model',
      'not-a-model? Invalid',
      overlong,
      ''
    ].join('\n'))).toEqual({ models: [] })
    expect(parseAntigravityModelCatalog('')).toEqual({ models: [] })
  })
})
