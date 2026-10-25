import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows only the required local and extension image URL families', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('blob:')
    expect(imgSrc.split(/\s+/)).toContain('kun-extension:')
    expect(imgSrc.split(/\s+/)).not.toContain('https:')
  })

  it('lets workspace audio, video and sandboxed HTML previews load from their lease scheme only', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    for (const directive of ['media-src', 'frame-src']) {
      const sources = (csp.match(new RegExp(`${directive}\\s+([^;]+)`))?.[1] ?? '').split(/\s+/)
      expect(sources).toEqual(["'self'", 'kun-workspace-preview:'])
    }
  })
})
