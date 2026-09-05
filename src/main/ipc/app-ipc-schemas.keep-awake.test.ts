import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('keep-awake settings schema', () => {
  it('accepts only boolean preferences', () => {
    expect(settingsPatchSchema.parse({
      appBehavior: { keepAwake: true }
    }).appBehavior).toEqual({ keepAwake: true })
    expect(settingsPatchSchema.parse({
      appBehavior: { keepAwake: false }
    }).appBehavior).toEqual({ keepAwake: false })
    expect(() => settingsPatchSchema.parse({ appBehavior: { keepAwake: 'true' } })).toThrow()
    expect(() => settingsPatchSchema.parse({ appBehavior: { keepAwake: 1 } })).toThrow()
  })
})
