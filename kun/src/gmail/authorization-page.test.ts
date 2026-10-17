import { describe, expect, it } from 'vitest'
import { renderGmailAuthorizationPage, type GmailAuthorizationPageState } from './authorization-page.js'

describe('Gmail authorization result page', () => {
  it('renders each result state in both languages without remote assets or scripts', () => {
    const states: GmailAuthorizationPageState[] = ['connected', 'finishing', 'cancelled', 'failed']
    for (const lang of ['en', 'zh'] as const) {
      for (const state of states) {
        const html = renderGmailAuthorizationPage({ state, lang, nonce: 'n0nce', email: 'owner@example.com' })
        expect(html).toContain(`class="chip ${state}"`)
        expect(html).toContain('href="kun://account"')
        expect(html).not.toMatch(/<script|https?:\/\//)
        expect(html.includes('owner@example.com')).toBe(state === 'connected')
      }
    }
    expect(renderGmailAuthorizationPage({ state: 'cancelled', lang: 'zh', nonce: 'n' })).toContain('这次没有连接 Gmail')
  })

  it('escapes the account address', () => {
    const html = renderGmailAuthorizationPage({ state: 'connected', lang: 'en', nonce: 'n', email: '<b>x</b>@example.com' })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&#60;b&#62;x')
  })
})
