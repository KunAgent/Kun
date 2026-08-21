import { describe, expect, it } from 'vitest'
import { defaultClawSettings } from '@shared/app-settings'
import { runtimePromptForSurface } from './chat-store-send-prompt'

describe('runtimePromptForSurface', () => {
  it('does not apply Code managed instructions to Work turns', () => {
    const settings = { claw: defaultClawSettings(), codePromptPrefix: 'Code-only instruction' }

    expect(runtimePromptForSurface({
      channel: null,
      requestedAgentSurface: 'write',
      writeContext: undefined,
      settings,
      prompt: 'Summarize this document'
    })).toBe('Summarize this document')
  })

  it('continues to apply the configured prefix to Code turns', () => {
    const settings = { claw: defaultClawSettings(), codePromptPrefix: 'Code-only instruction' }

    expect(runtimePromptForSurface({
      channel: null,
      requestedAgentSurface: 'code',
      writeContext: undefined,
      settings,
      prompt: 'Fix the test'
    })).toContain('[Code managed instructions]\n\nCode-only instruction')
  })
})
