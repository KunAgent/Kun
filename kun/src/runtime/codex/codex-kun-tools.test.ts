import { describe, expect, it } from 'vitest'
import { codexKunToolsConfig, isKunToolsElicitation } from './codex-kun-tools.js'

describe('Kun Tools for codex app-server', () => {
  it('registers the http Kun Tools server as a per-thread config override', () => {
    expect(codexKunToolsConfig([{
      type: 'http',
      name: 'kun-tools',
      url: 'http://127.0.0.1:18899/mcp/kun',
      headers: [{ name: 'Authorization', value: 'Bearer kgw_x.y' }]
    }])).toEqual({
      'mcp_servers.kun': {
        url: 'http://127.0.0.1:18899/mcp/kun',
        http_headers: { Authorization: 'Bearer kgw_x.y' },
        startup_timeout_sec: 30,
        tool_timeout_sec: 900
      }
    })
  })

  it('adds nothing without an http descriptor', () => {
    expect(codexKunToolsConfig(undefined)).toBeUndefined()
    expect(codexKunToolsConfig([{ name: 'kun-tools', command: 'kun', args: [], env: [] }])).toBeUndefined()
  })

  it('answers only form elicitations from the Kun server', () => {
    expect(isKunToolsElicitation({ serverName: 'kun', threadId: 't', mode: 'form', message: 'Allow?', requestedSchema: {} })).toBe(true)
    expect(isKunToolsElicitation({ serverName: 'github', threadId: 't', mode: 'form' })).toBe(false)
    expect(isKunToolsElicitation({ serverName: 'kun', threadId: 't', mode: 'url', url: 'https://x' })).toBe(false)
    expect(isKunToolsElicitation(null)).toBe(false)
  })
})
