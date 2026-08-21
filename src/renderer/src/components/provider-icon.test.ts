import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ProviderIcon,
  resolveProviderIconKey,
  type ProviderBrandIconKey
} from './provider-icon'

describe('provider icon resolution', () => {
  it.each<[string, ProviderBrandIconKey]>([
    ['aliyun', 'alibaba'],
    ['codex', 'codex'],
    ['claude-subscription', 'claude'],
    ['cursor-subscription', 'cursor'],
    ['gemini-cli-subscription', 'gemini'],
    ['gemini-subscription', 'antigravity'],
    ['grok-subscription', 'grok'],
    ['kimi-code', 'kimi'],
    ['litellm', 'litellm'],
    ['longcat', 'longcat'],
    ['minimax', 'minimax'],
    ['moonshot-cn', 'kimi'],
    ['moonshot-global', 'kimi'],
    ['ollama', 'ollama'],
    ['opencode-go', 'opencodego'],
    ['volcengine', 'doubao'],
    ['volcengine-agent-plan', 'doubao'],
    ['volcengine-coding-plan', 'doubao'],
    ['xiaomi', 'mimo'],
    ['zai-coding-plan', 'zai'],
    ['zenmux', 'zenmux'],
    ['zhipu-coding-plan', 'zai']
  ])('maps trusted preset %s to %s', (presetId, expected) => {
    expect(resolveProviderIconKey({ presetId, providerId: 'custom-account-4' })).toBe(expected)
  })

  it('prefers a trusted preset over an exact provider id for multi-account profiles', () => {
    expect(resolveProviderIconKey({ presetId: 'codex', providerId: 'deepseek' })).toBe('codex')
    expect(resolveProviderIconKey({ presetId: 'minimax', providerId: 'minimax-token-plan' }))
      .toBe('minimax')
  })

  it('uses exact built-in provider ids without guessing suffixes or custom names', () => {
    expect(resolveProviderIconKey({ providerId: 'deepseek' })).toBe('deepseek')
    expect(resolveProviderIconKey({ providerId: 'litellm' })).toBe('litellm')
    expect(resolveProviderIconKey({ providerId: 'codex' })).toBe('codex')
    expect(resolveProviderIconKey({ providerId: 'codex-2' })).toBe('kun')
    expect(resolveProviderIconKey({ providerId: 'minimax-token-plan' })).toBe('kun')
    expect(resolveProviderIconKey({ providerId: 'my-codex-provider' })).toBe('kun')
  })

  it('falls back to the Kun K mark for intentionally unmapped and unknown providers', () => {
    expect(resolveProviderIconKey({ presetId: 'tencentcloud', providerId: 'tencentcloud' }))
      .toBe('kun')
    expect(resolveProviderIconKey({ presetId: 'vercel-ai-gateway', providerId: 'vercel-ai-gateway' }))
      .toBe('kun')
    expect(resolveProviderIconKey({ providerId: 'custom-provider' })).toBe('kun')
    expect(resolveProviderIconKey({ providerId: 'constructor' })).toBe('kun')
    expect(resolveProviderIconKey({ presetId: '__proto__', providerId: 'toString' })).toBe('kun')
    expect(resolveProviderIconKey({})).toBe('kun')
  })
})

describe('ProviderIcon', () => {
  it('renders a decorative current-color CSS mask by default', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, {
      presetId: 'gemini-subscription',
      providerId: 'google-account-2',
      className: 'h-4 w-4'
    }))

    expect(html).toContain('data-provider-icon="antigravity"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('background-color:currentColor')
    expect(html).toContain('mask-image:url(')
  })

  it('can expose an accessible label when the mark stands alone', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, {
      providerId: 'custom-provider',
      label: 'Custom Provider'
    }))

    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Custom Provider"')
    expect(html).toContain('data-provider-icon="kun"')
  })
})
