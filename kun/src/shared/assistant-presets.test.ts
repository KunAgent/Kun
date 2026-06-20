import { describe, expect, it } from 'vitest'
import { assistantPresetInstruction, getAssistantPreset, isAssistantPresetId } from './assistant-presets.js'

describe('assistant presets', () => {
  it('resolves only built-in assistant presets', () => {
    expect(isAssistantPresetId('code-review')).toBe(true)
    expect(isAssistantPresetId('research')).toBe(true)
    expect(isAssistantPresetId('unknown')).toBe(false)
    expect(getAssistantPreset('debug')?.name).toBe('Debug')
  })

  it('builds a dynamic system instruction for a selected preset', () => {
    expect(assistantPresetInstruction('code-review')).toContain('[Assistant preset: Code Review]')
    expect(assistantPresetInstruction('code-review')).toContain('Default tool emphasis: read, grep, find, ls, bash.')
    expect(assistantPresetInstruction('office')).toContain('[Assistant preset: Office]')
    expect(assistantPresetInstruction(undefined)).toBeNull()
  })
})
