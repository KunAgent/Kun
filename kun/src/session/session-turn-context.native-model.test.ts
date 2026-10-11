import { describe, expect, it } from 'vitest'
import { modelForHarnessWire } from './session-turn-context.js'

describe('delegated native model boundary', () => {
  it('omits the native default sentinel for Codex and ACP model selection', () => {
    expect(modelForHarnessWire('default', 'native-login')).toBeUndefined()
    expect(modelForHarnessWire('gpt-5.6-sol', 'native-login')).toBe('gpt-5.6-sol')
  })

  it('preserves a real provider or gateway model named default', () => {
    expect(modelForHarnessWire('default', 'provider')).toBe('default')
    expect(modelForHarnessWire('default', 'kun-gateway')).toBe('default')
  })
})
