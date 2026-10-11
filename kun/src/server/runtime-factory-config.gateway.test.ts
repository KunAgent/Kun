import { describe, expect, it } from 'vitest'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { localGatewayKeyRequiredForApply } from './runtime-factory-config.js'

describe('local gateway hot-config validation', () => {
  const enabled = { enabled: true, exposeProviderModels: false }
  const current = { localModelGateway: enabled } as KunServeRuntimeOptions

  it('leaves an unchanged gateway out of unrelated MCP updates', () => {
    expect(localGatewayKeyRequiredForApply(current, { capabilities: {} } as never)).toBe(false)
    expect(localGatewayKeyRequiredForApply(current, { serve: { localModelGateway: enabled } } as never)).toBe(false)
  })

  it('still requires the key when enabling or changing the gateway', () => {
    expect(localGatewayKeyRequiredForApply({} as KunServeRuntimeOptions,
      { serve: { localModelGateway: enabled } } as never)).toBe(true)
    expect(localGatewayKeyRequiredForApply(current,
      { serve: { localModelGateway: { ...enabled, exposeProviderModels: true } } } as never)).toBe(true)
    expect(localGatewayKeyRequiredForApply(current,
      { serve: { localModelGateway: { ...enabled, enabled: false } } } as never)).toBe(false)
  })
})
