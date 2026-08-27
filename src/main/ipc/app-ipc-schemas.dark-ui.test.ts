import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('dark UI settings IPC schema', () => {
  it('accepts strict partial colors and rejects invalid or unknown fields', () => {
    expect(settingsPatchSchema.parse({
      darkUiColors: { background: ' #AABBCC ', panel: '#123456' }
    }).darkUiColors).toEqual({ background: '#AABBCC', panel: '#123456' })
    expect(() => settingsPatchSchema.parse({ darkUiColors: { border: 'transparent' } })).toThrow()
    expect(() => settingsPatchSchema.parse({
      darkUiColors: { background: '#112233', accent: '#445566' }
    })).toThrow()
  })
})
