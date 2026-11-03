import { describe, expect, it } from 'vitest'
import type { ModelReasoningCapabilityMetadata } from '../../contracts/capabilities-core.js'
import {
  applyAnthropicReasoningEffort,
  resolveReasoningEffort
} from './compat-request-reasoning.js'

const FLASH_REASONING: ModelReasoningCapabilityMetadata = {
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: 'max',
  requestProtocol: 'anthropic-thinking'
}

const M3_REASONING: ModelReasoningCapabilityMetadata = {
  supportedEfforts: ['auto', 'off'],
  defaultEffort: 'auto',
  requestProtocol: 'anthropic-thinking'
}

const CLAUDE_REASONING: ModelReasoningCapabilityMetadata = {
  supportedEfforts: ['low', 'medium', 'high', 'max'],
  defaultEffort: 'high',
  requestProtocol: 'anthropic-thinking'
}

describe('Anthropic reasoning effort', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'sends %s verbatim for MiniMax-M3.1-Flash',
    (effort) => {
      const body: Record<string, unknown> = {}

      applyAnthropicReasoningEffort(body, effort, FLASH_REASONING)

      expect(body.thinking).toEqual({ type: 'adaptive' })
      expect(body.output_config).toEqual({ effort })
      expect(body.service_tier).toBeUndefined()
    }
  )

  it('normalizes stale off/auto/none to the Flash default without disabling thinking', () => {
    for (const effort of ['off', 'auto', 'none', 'disabled'] as const) {
      const body: Record<string, unknown> = {}

      applyAnthropicReasoningEffort(body, effort, FLASH_REASONING)

      expect(body.thinking).toEqual({ type: 'adaptive' })
      expect(body.output_config).toEqual({ effort: 'max' })
    }
  })

  it('omits thinking fields when no effort is configured so the provider default applies', () => {
    for (const effort of [undefined, ''] as const) {
      const body: Record<string, unknown> = {}

      applyAnthropicReasoningEffort(body, effort, FLASH_REASONING)

      expect(body.thinking).toBeUndefined()
      expect(body.output_config).toBeUndefined()
    }
  })

  it('keeps the historical off semantics for the older MiniMax M3 profile', () => {
    const body: Record<string, unknown> = {}

    applyAnthropicReasoningEffort(body, 'off', M3_REASONING)

    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.output_config).toBeUndefined()
  })

  it('keeps the xhigh → max alias for capabilities without a distinct xhigh tier', () => {
    expect(resolveReasoningEffort('xhigh', CLAUDE_REASONING)).toBe('max')

    const body: Record<string, unknown> = {}
    applyAnthropicReasoningEffort(body, 'xhigh', CLAUDE_REASONING)

    expect(body.output_config).toEqual({ effort: 'max' })
  })
})
