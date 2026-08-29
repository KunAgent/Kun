import { describe, expect, it } from 'vitest'
import { parseAntigravityModelCatalog } from './antigravity-model-catalog.js'

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
