import { describe, expect, it } from 'vitest'
import {
  APP_SANDBOX_GEN_UI_PARTITION,
  appSandboxOrigin,
  parseAppSandboxUrl
} from '../../shared/app-sandbox'
import { AppSandboxRegistry } from './app-sandbox-registry'
import { buildGenUiCsp, buildMcpAppCsp, buildShellCsp } from './app-sandbox-csp'
import { buildGenUiDocument, buildShellDocument, sanitizeThemeColors } from './gen-ui-document'
import { isGenUiVendorUrl } from './app-sandbox-vendor'

const theme = { mode: 'dark' as const, locale: 'zh-CN', colors: { foreground: '#fff', accent: 'red;}body{x:y' } }

describe('app sandbox URLs', () => {
  it('parses shell, Gen UI and MCP App URLs and rejects traversal or foreign hosts', () => {
    const id = 'a'.repeat(32)
    expect(parseAppSandboxUrl(`kun-app://shell-${id}/`)).toEqual({ kind: 'shell', instanceId: id, path: '/' })
    expect(parseAppSandboxUrl(`kun-app://genui-${id}/index.html`)).toMatchObject({ kind: 'gen-ui', instanceId: id })
    expect(parseAppSandboxUrl(`kun-app://app-${'b'.repeat(16)}/i/${id}/assets/x.js`))
      .toEqual({ kind: 'mcp-app', serverHost: 'b'.repeat(16), instanceId: id, path: '/assets/x.js' })
    expect(parseAppSandboxUrl(`kun-app://app-${'b'.repeat(16)}/i/${id}/%2e%2e/secret`)).toBeNull()
    expect(parseAppSandboxUrl(`kun-app://shell-XYZ/`)).toBeNull()
    expect(parseAppSandboxUrl('https://example.com/')).toBeNull()
    expect(appSandboxOrigin(`kun-app://shell-${id}/x`)).toBe(`kun-app://shell-${id}`)
  })
})

describe('AppSandboxRegistry', () => {
  it('binds a guest only with the matching nonce and consumes gestures once', () => {
    let now = 1_000
    const registry = new AppSandboxRegistry(() => now)
    const record = registry.create({ kind: 'gen-ui', ownerWebContentsId: 7, threadId: 't', html: '', csp: '' })
    expect(record.partition).toBe(APP_SANDBOX_GEN_UI_PARTITION)
    expect(registry.bindGuest(record.instanceId, 'wrong', 99)).toBeUndefined()
    expect(registry.bindGuest(record.instanceId, record.nonce, 99)).toBe(record)
    expect(registry.bindGuest(record.instanceId, record.nonce, 100)).toBeUndefined()
    expect(registry.findByGuest(99)).toBe(record)
    registry.recordGesture(99)
    expect(registry.consumeGesture(record.instanceId)).toBe(true)
    expect(registry.consumeGesture(record.instanceId)).toBe(false)
    registry.recordGesture(99)
    now += 10_000
    expect(registry.consumeGesture(record.instanceId)).toBe(false)
    expect(registry.disposeOwner(7)).toHaveLength(1)
    expect(registry.size()).toBe(0)
  })

  it('gives MCP App pages a stable per-server origin and persistent partition', () => {
    const registry = new AppSandboxRegistry()
    const first = registry.create({ kind: 'mcp-app', ownerWebContentsId: 1, threadId: 't', html: '', csp: '', serverHost: 'c'.repeat(16) })
    const second = registry.create({ kind: 'mcp-app', ownerWebContentsId: 1, threadId: 't', html: '', csp: '', serverHost: 'c'.repeat(16) })
    expect(first.partition).toBe(`persist:kun-app-${'c'.repeat(16)}`)
    expect(appSandboxOrigin(first.guestUrl)).toBe(appSandboxOrigin(second.guestUrl))
    expect(first.guestUrl).not.toBe(second.guestUrl)
  })
})

describe('app sandbox CSP and documents', () => {
  it('denies network for Gen UI and only allows declared MCP App domains', () => {
    const genUi = buildGenUiCsp('kun-app://shell-x')
    expect(genUi).toContain("connect-src 'none'")
    expect(genUi).toContain("form-action 'none'")
    expect(genUi).toContain('frame-ancestors kun-app://shell-x')
    const mcp = buildMcpAppCsp({
      shellOrigin: 'kun-app://shell-y',
      meta: { csp: { connectDomains: ['https://api.example.com'] }, wasmUnsafeEval: true }
    })
    expect(mcp).toContain("connect-src 'self' https://api.example.com")
    expect(mcp).toContain("'wasm-unsafe-eval'")
    expect(mcp).not.toContain("'unsafe-eval'")
    expect(buildShellCsp('kun-app://genui-z')).toContain('frame-src kun-app://genui-z')
  })

  it('escapes boot state and rejects theme values that could break out of CSS', () => {
    expect(sanitizeThemeColors(theme).accent).not.toContain(';')
    const html = buildGenUiDocument({
      fragment: '<div id="root"></div>',
      title: 'Demo <b>',
      csp: "default-src 'none'",
      theme,
      widgetState: { modelContent: '</script><script>alert(1)</script>', privateContent: null }
    })
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('\\u003c/script\\u003e')
    expect(html).toContain('<title>Demo b</title>')
    expect(html).toContain('<div id="root"></div>')
    const shell = buildShellDocument({ guestUrl: 'kun-app://genui-x/index.html', csp: 'x', title: 'Kun' })
    expect(shell).toContain('sandbox="allow-scripts allow-same-origin')
    expect(shell).not.toContain('allow-top-navigation')
  })

  it('maps only pinned library URLs to bundled files', () => {
    expect(isGenUiVendorUrl('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js')).toBe(true)
    expect(isGenUiVendorUrl('https://cdn.jsdelivr.net/npm/d3@7.8.0/dist/d3.min.js')).toBe(false)
  })
})
