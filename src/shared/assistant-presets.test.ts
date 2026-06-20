import { describe, expect, it } from 'vitest'
import { ASSISTANT_PRESETS, getAssistantPreset, isAssistantPresetId } from './assistant-presets'

describe('assistant presets', () => {
  it('defines unique built-in preset ids', () => {
    const ids = ASSISTANT_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['code-review', 'docs-writer', 'debug', 'office', 'research'])
  })

  it('resolves valid presets and rejects unknown ids', () => {
    expect(isAssistantPresetId('debug')).toBe(true)
    expect(isAssistantPresetId('office')).toBe(true)
    expect(isAssistantPresetId('custom')).toBe(false)
    expect(getAssistantPreset('code-review')?.defaultTools).toContain('grep')
    expect(getAssistantPreset(undefined)).toBeNull()
  })
})
