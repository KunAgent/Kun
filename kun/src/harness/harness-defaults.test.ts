import { describe, expect, it } from 'vitest'
import type { HarnessesConfig } from '../config/kun-config-application.js'
import { harnessDefaultsFor } from './harness-defaults.js'

const harnesses = (partial: Partial<HarnessesConfig>): HarnessesConfig =>
  partial as HarnessesConfig

describe('harnessDefaultsFor (P4-11)', () => {
  it('returns the canonical defaults entry', () => {
    const entry = { credentialMode: 'kun-gateway' as const, model: 'deepseek-chat' }
    expect(harnessDefaultsFor(harnesses({ defaults: { 'claude-code': entry } }), 'claude-code'))
      .toEqual(entry)
  })

  it('falls back to legacy defaultPermissionMode for permissionMode', () => {
    expect(harnessDefaultsFor(
      harnesses({ defaultPermissionMode: { cursor: 'ask' } }),
      'cursor'
    )).toEqual({ permissionMode: 'ask' })
    // And fills a defaults entry that lacks permissionMode.
    expect(harnessDefaultsFor(
      harnesses({
        defaults: { cursor: { model: 'composer-2' } },
        defaultPermissionMode: { cursor: 'ask' }
      }),
      'cursor'
    )).toEqual({ model: 'composer-2', permissionMode: 'ask' })
  })

  it('explicit defaults.permissionMode wins over the legacy value', () => {
    expect(harnessDefaultsFor(
      harnesses({
        defaults: { cursor: { permissionMode: 'edit' } },
        defaultPermissionMode: { cursor: 'ask' }
      }),
      'cursor'
    )).toEqual({ permissionMode: 'edit' })
  })

  it('returns undefined when nothing is configured', () => {
    expect(harnessDefaultsFor(undefined, 'kun')).toBeUndefined()
    expect(harnessDefaultsFor(harnesses({}), 'kun')).toBeUndefined()
  })
})
