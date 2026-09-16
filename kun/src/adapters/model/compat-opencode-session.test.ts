import { describe, expect, it } from 'vitest'
import {
  OPENCODE_SESSION_HEADER,
  isOpenCodeFree,
  isOpenCodeGo,
  openCodeSessionRuntimeHeaders,
  requiresOpenCodeSessionHeader,
  withOpenCodeSessionHeader
} from './compat-opencode-session.js'

describe('isOpenCodeGo', () => {
  it('matches the stable preset source', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-go', providerId: 'custom', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches a multi-account preset id', () => {
    expect(isOpenCodeGo({ providerId: 'opencode-go-2', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches the official Go URL', () => {
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(true)
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go' })).toBe(true)
  })

  it('does not match the OpenCode Free path', () => {
    expect(isOpenCodeGo({ presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(false)
  })

  it('does not match a lookalike path or host', () => {
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/go-something/v1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'https://opencode.ai/zen/gov1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'https://fake-opencode.ai/zen/go/v1' })).toBe(false)
    expect(isOpenCodeGo({ baseUrl: 'http://opencode.ai/zen/go/v1' })).toBe(false)
  })
})

describe('isOpenCodeFree', () => {
  it('matches the stable preset source', () => {
    expect(isOpenCodeFree({ presetSource: 'opencode-free', providerId: 'custom', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches a multi-account preset id', () => {
    expect(isOpenCodeFree({ providerId: 'opencode-free-2', baseUrl: 'https://example.test' })).toBe(true)
  })

  it('matches the official Free URL', () => {
    expect(isOpenCodeFree({ baseUrl: 'https://opencode.ai/zen/v1' })).toBe(true)
    expect(isOpenCodeFree({ baseUrl: 'https://opencode.ai/zen' })).toBe(true)
  })

  it('does not match OpenCode Go', () => {
    expect(isOpenCodeFree({ presetSource: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(false)
    expect(isOpenCodeFree({ baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(false)
    expect(isOpenCodeFree({ baseUrl: 'https://opencode.ai/zen/go' })).toBe(false)
  })

  it('does not match a lookalike path or host', () => {
    expect(isOpenCodeFree({ baseUrl: 'https://opencode.ai/zen/v1-extra' })).toBe(false)
    expect(isOpenCodeFree({ baseUrl: 'https://fake-opencode.ai/zen/v1' })).toBe(false)
    expect(isOpenCodeFree({ baseUrl: 'http://opencode.ai/zen/v1' })).toBe(false)
  })
})

describe('OpenCode session header', () => {
  it('requires the header for both Go and Free', () => {
    expect(requiresOpenCodeSessionHeader({ presetSource: 'opencode-go', baseUrl: 'https://example.test' })).toBe(true)
    expect(requiresOpenCodeSessionHeader({
      presetSource: 'opencode-free',
      baseUrl: 'https://opencode.ai/zen/v1'
    })).toBe(true)
    expect(requiresOpenCodeSessionHeader({ baseUrl: 'https://api.deepseek.com' })).toBe(false)
  })

  it('attaches a trimmed thread id for Free and Go', () => {
    expect(openCodeSessionRuntimeHeaders(
      { presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' },
      '  thr_free  '
    )).toEqual({ [OPENCODE_SESSION_HEADER]: 'thr_free' })
    expect(openCodeSessionRuntimeHeaders(
      { presetSource: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' },
      'thr_go'
    )).toEqual({ [OPENCODE_SESSION_HEADER]: 'thr_go' })
    expect(openCodeSessionRuntimeHeaders({ baseUrl: 'https://api.deepseek.com' }, 'thr_1')).toBeUndefined()
  })

  it('adds a request-local id when no thread id is present', () => {
    const headers = openCodeSessionRuntimeHeaders({
      presetSource: 'opencode-free',
      baseUrl: 'https://opencode.ai/zen/v1'
    })
    expect(headers?.[OPENCODE_SESSION_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    )
  })

  it('preserves an explicitly configured header case-insensitively', () => {
    const explicit = { 'X-OpenCode-Session': 'operator-selected-session' }
    expect(withOpenCodeSessionHeader(
      { presetSource: 'opencode-free', baseUrl: 'https://opencode.ai/zen/v1' },
      'automatic-session',
      explicit
    )).toBe(explicit)
  })
})
