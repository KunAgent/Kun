import { describe, expect, it, vi } from 'vitest'

const tMock = vi.fn((key: string, options?: Record<string, unknown>) => {
  if (options?.defaultValue !== undefined && !key.startsWith('common:modelRouteSwitchReason_')) {
    return key
  }
  if (key === 'common:modelRouteSwitchStatus') {
    return `switch ${options?.from} -> ${options?.to}${options?.reasonSuffix ?? ''}`
  }
  if (key.startsWith('common:modelRouteSwitchReason_')) {
    const known = new Set(['credit', 'quota', 'rate', 'overloaded', 'auth', 'model', 'request', 'other'])
    const code = key.slice('common:modelRouteSwitchReason_'.length)
    return known.has(code) ? `reason:${code}` : (options?.defaultValue as string) ?? key
  }
  return key
})

vi.mock('../i18n', () => ({
  default: { t: (key: string, options?: Record<string, unknown>) => tMock(key, options) }
}))

import { runtimeStatusText } from './chat-store-runtime-projection-support'

const routeSwitch = (routeReason?: string) => ({
  kind: 'model_route_switch' as const,
  itemId: 'item-1',
  fromProviderId: 'acct-a',
  fromModelId: 'deepseek-chat',
  toProviderId: 'acct-b',
  toModelId: 'deepseek-chat',
  ...(routeReason ? { routeReason } : {})
})

describe('runtimeStatusText model_route_switch', () => {
  it('localizes known failure reason codes', () => {
    const text = runtimeStatusText(routeSwitch('credit') as never)
    expect(text).toContain('(reason:credit)')
    expect(tMock).toHaveBeenCalledWith(
      'common:modelRouteSwitchReason_credit',
      expect.objectContaining({ defaultValue: expect.anything() })
    )
  })

  it('falls back to the generic label for unknown reason codes', () => {
    const text = runtimeStatusText(routeSwitch('some_new_code') as never)
    expect(text).toContain('(reason:other)')
  })

  it('omits the suffix when no reason is present', () => {
    const text = runtimeStatusText(routeSwitch() as never)
    expect(text).toBe('switch acct-a/deepseek-chat -> acct-b/deepseek-chat')
  })
})
