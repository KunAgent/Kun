import { describe, expect, it } from 'vitest'
import { buildGatewayClientSetup, GATEWAY_CLIENTS, gatewaySetupDiff, gatewayV1BaseUrl, shellQuote } from './gateway-client-setup'
import { codexConfig, opencodeConfig, piModelsConfig } from '../../kun/src/harness/gateway-config-templates'

describe('gateway client setup previews', () => {
  it('only exposes implemented coding client integrations', () => {
    expect(GATEWAY_CLIENTS.map((client) => client.id)).toEqual(['codex', 'claude-code', 'opencode', 'pi'])
  })
  it('reuses the managed harness templates with a public alias and an env-only key', () => {
    const base = 'http://127.0.0.1:18899/v1'
    for (const [client, template] of [['codex', codexConfig], ['opencode', opencodeConfig], ['pi', piModelsConfig]] as const) {
      const preview = buildGatewayClientSetup(client, base, 'coding')
      expect(preview.content).toBe(template(base, 'coding', 'KUN_GATEWAY_API_KEY'))
      expect(preview.fileName).toMatch(/^\.kun-gateway\//)
      expect(preview.content).not.toContain('kun_local_')
      expect(gatewaySetupDiff(preview)).toContain('--- /dev/null')
    }
  })
  it('clears native Claude auth, keeps the origin unversioned, and disables unsupported thinking', () => {
    const preview = buildGatewayClientSetup('claude-code', 'http://localhost:18899/v1', 'coding')
    expect(preview.launch).toContain("ANTHROPIC_BASE_URL='http://localhost:18899'")
    expect(preview.launch).toContain('-u CLAUDE_CODE_OAUTH_TOKEN')
    expect(preview.launch).toContain('-u ANTHROPIC_API_KEY')
    expect(preview.launch).toContain('MAX_THINKING_TOKENS=0 CLAUDE_CODE_EFFORT_LEVEL=unset')
    expect(preview.launch).toContain('ANTHROPIC_AUTH_TOKEN="$KUN_GATEWAY_API_KEY"')
    expect(preview.content).toBeUndefined()
  })
  it('quotes arbitrary aliases instead of allowing shell substitution', () => {
    const value = "client'$(touch /tmp/nope)"
    expect(shellQuote(value)).toBe("'client'\"'\"'$(touch /tmp/nope)'")
    expect(buildGatewayClientSetup('pi', 'http://127.0.0.1:18899', value).launch).toContain(shellQuote(value))
    expect(() => buildGatewayClientSetup('pi', 'http://127.0.0.1:18899', 'a\nb')).toThrow()
  })
  it('fails closed for non-loopback URLs, URL credentials, queries and unsupported paths', () => {
    for (const base of ['https://api.example.com', 'http://user:secret@localhost', 'http://localhost/v1?key=a', 'http://localhost/other', 'file:///tmp/a']) {
      expect(() => gatewayV1BaseUrl(base)).toThrow()
    }
    expect(gatewayV1BaseUrl('http://[::1]:18899/')).toBe('http://[::1]:18899/v1')
  })
})
