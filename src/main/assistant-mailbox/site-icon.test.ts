import { describe, expect, it } from 'vitest'
import { fetchSiteIcon, iconLinks, normalizeWebsite } from './site-icon'

const png = (bytes = 4) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })

describe('custom assistant icons', () => {
  it('accepts bare domains and https origins only', () => {
    expect(normalizeWebsite('zo.computer')).toBe('https://zo.computer')
    expect(normalizeWebsite('https://www.hark.ai/about?x=1')).toBe('https://www.hark.ai')
    expect(['http://zo.computer', 'localhost', 'https://user:pw@zo.computer', '', 'javascript:alert(1)'].map(normalizeWebsite))
      .toEqual([null, null, null, null, null])
  })

  it('prefers apple-touch icons, then SVG, then the largest declared size', () => {
    const html = `<link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel='icon' href='/favicon-64.png' sizes='64x64'>
      <link rel="stylesheet" href="/app.css"><link href="/mark.svg" rel="icon" type="image/svg+xml"><link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">`
    expect(iconLinks(html, 'https://example.com/')).toEqual([
      'https://cdn.example.com/touch.png', 'https://example.com/mark.svg', 'https://example.com/favicon-64.png', 'https://example.com/favicon-16.png'
    ])
  })

  it('returns the first real image as a data URL and skips pages, oversized files and plain http', async () => {
    const asked: string[] = []
    const icon = await fetchSiteIcon('example.com', async (input) => {
      const url = String(input)
      asked.push(url)
      if (url === 'https://example.com/') return new Response('<link rel="icon" href="/big.png"><link rel="icon" href="http://example.com/x.png" sizes="512x512">')
      if (url === 'https://example.com/big.png') return png(300 * 1024)
      if (url === 'https://example.com/apple-touch-icon.png') return new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } })
      if (url === 'https://example.com/favicon.ico') return png(3)
      throw new Error(`unexpected ${url}`)
    })
    expect(icon).toBe('data:image/png;base64,AAAA')
    expect(asked).not.toContain('http://example.com/x.png')
    expect(await fetchSiteIcon('http://example.com', async () => png())).toBeNull()
  })
})
