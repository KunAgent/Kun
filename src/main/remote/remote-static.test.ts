import { describe, expect, it } from 'vitest'
import { resolveRemoteStaticPath } from './remote-static'

const ROOT = '/app/out/renderer'

describe('resolveRemoteStaticPath', () => {
  it('resolves ordinary asset paths under the root', () => {
    expect(resolveRemoteStaticPath(ROOT, '/index.html')).toBe(`${ROOT}/index.html`)
    expect(resolveRemoteStaticPath(ROOT, '/assets/app-123.js')).toBe(`${ROOT}/assets/app-123.js`)
    expect(resolveRemoteStaticPath(ROOT, '/')).toBe(ROOT)
  })

  it('absorbs traversal attempts back inside the root', () => {
    for (const path of [
      '/../main/index.js',
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/secret',
      '/assets/../../out/main/x.js'
    ]) {
      const resolved = resolveRemoteStaticPath(ROOT, path)
      // normalize() collapses '..' against the root; nothing may escape it.
      expect(resolved === null || resolved === ROOT || resolved.startsWith(`${ROOT}/`)).toBe(true)
    }
  })

  it('rejects malformed input', () => {
    expect(resolveRemoteStaticPath(ROOT, '/%E0%A4%A')).toBeNull()
    expect(resolveRemoteStaticPath(ROOT, '/a\0b')).toBeNull()
  })
})
