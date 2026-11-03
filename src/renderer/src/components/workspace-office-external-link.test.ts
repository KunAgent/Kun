import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceOfficeExternalLink, secureWorkspaceOfficeLinks } from './workspace-office-external-link'

describe('office document links', () => {
  let dom: JSDOM
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    openExternal = vi.fn(async () => undefined)
    vi.stubGlobal('window', Object.assign(dom.window, { kunGui: { openExternal } }))
    vi.stubGlobal('Element', dom.window.Element)
  })

  afterEach(() => {
    dom.window.close()
    vi.unstubAllGlobals()
  })

  function anchor(href: string): HTMLAnchorElement {
    const link = dom.window.document.createElement('a')
    link.setAttribute('href', href)
    link.setAttribute('target', '_blank')
    link.setAttribute('ping', 'https://tracker.example/ping')
    dom.window.document.body.append(link)
    return link
  }

  it('strips navigation from links but remembers web addresses', () => {
    const web = anchor('https://example.com/a')
    const mail = anchor('mailto:team@example.com')
    const script = anchor('javascript:alert(1)')
    secureWorkspaceOfficeLinks(dom.window.document.body)
    for (const link of [web, mail, script]) {
      expect(link.getAttribute('href')).toBe('#')
      expect(link.hasAttribute('target')).toBe(false)
      expect(link.hasAttribute('ping')).toBe(false)
    }
    expect(web.getAttribute('data-kun-office-href')).toBe('https://example.com/a')
    expect(mail.getAttribute('data-kun-office-href')).toBe('mailto:team@example.com')
    expect(script.hasAttribute('data-kun-office-href')).toBe(false)
  })

  it('opens the remembered address of a secured link', () => {
    const link = anchor('https://example.com/a')
    secureWorkspaceOfficeLinks(dom.window.document.body)
    const preventDefault = vi.fn()
    openWorkspaceOfficeExternalLink({ target: link, preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a')
  })

  it('opens the live address of a link in pages that mount lazily', () => {
    const link = anchor('https://example.com/live')
    const preventDefault = vi.fn()
    openWorkspaceOfficeExternalLink({ target: link, preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/live')
  })

  it('swallows clicks on other schemes and ignores clicks outside links', () => {
    const preventDefault = vi.fn()
    openWorkspaceOfficeExternalLink({ target: anchor('file:///etc/passwd'), preventDefault })
    openWorkspaceOfficeExternalLink({ target: anchor('#bookmark'), preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(openExternal).not.toHaveBeenCalled()

    const outside = dom.window.document.createElement('p')
    const other = vi.fn()
    openWorkspaceOfficeExternalLink({ target: outside, preventDefault: other })
    expect(other).not.toHaveBeenCalled()
  })
})
