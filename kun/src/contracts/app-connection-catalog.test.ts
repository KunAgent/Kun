import { describe, expect, it } from 'vitest'
import { AppPresetSchema } from './app-connections.js'
import { APP_PRESETS, appPreset } from './app-connection-catalog.js'
import { ROOM_APP_CATALOG, canonicalRoomAppId, isHiddenRoomGoogleApp } from './room-app-catalog.js'

describe('built-in app connections', () => {
  it('keeps preset and provider identities unique while grouping Figma modes', () => {
    expect(new Set(APP_PRESETS.map((item) => item.id)).size).toBe(APP_PRESETS.length)
    expect(new Set(APP_PRESETS.map((item) => item.runtimeProviderId)).size).toBe(APP_PRESETS.length)
    expect(appPreset('figma-desktop')?.appId).toBe('figma')
    expect(appPreset('figma-api')?.appId).toBe('figma')
    expect(appPreset('figma-remote')?.availability).toBe('vendor_approval')
  })

  it('preserves existing Room entries without advertising unfinished providers', () => {
    expect(ROOM_APP_CATALOG).toEqual({
      google_gmail: { name: 'Gmail', connectionKind: 'native_gmail' },
      github: { name: 'GitHub', connectionKind: 'native_github' }
    })
    expect(canonicalRoomAppId('gmail')).toBe('google_gmail')
    expect(isHiddenRoomGoogleApp('mcp:google_drive')).toBe(true)
  })

  it('rejects arbitrary native endpoints and non-canonical local endpoints', () => {
    const github = appPreset('github')!
    expect(AppPresetSchema.safeParse({ ...github, endpoint: 'https://evil.example' }).success).toBe(false)
    const desktop = appPreset('figma-desktop')!
    expect(AppPresetSchema.safeParse({ ...desktop, endpoint: 'http://localhost:3845/mcp' }).success).toBe(false)
    expect(AppPresetSchema.safeParse({ ...desktop, endpoint: 'http://127.0.0.1:3845/mcp?token=x' }).success).toBe(false)
  })

  it('rejects non-HTTPS and credential-bearing OAuth endpoints', () => {
    const notion = appPreset('notion')!
    for (const endpoint of ['not a url', 'http://example.com/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp?token=x']) {
      expect(AppPresetSchema.safeParse({ ...notion, endpoint }).success).toBe(false)
    }
  })
})
