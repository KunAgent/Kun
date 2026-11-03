import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  buildHtmlElementPickScript, buildHtmlElementResolveScript,
  normalizeHtmlElementPickResult, resolveHtmlElementPickSelection,
  htmlElementPickResolvedStillMatches
} from './html-element-pick'

function fixture(html: string, hit: string) {
  const dom = new JSDOM(html)
  const { window } = dom
  window.Element.prototype.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 50,
    width: 100, height: 30, toJSON: () => ({})
  })
  Object.defineProperty(window.document, 'elementFromPoint', {
    value: () => window.document.querySelector(hit)
  })
  return {
    window,
    run: (script: string) => new Function('window', 'document', `return ${script}`)(window, window.document),
    close: () => window.close()
  }
}

describe('component picker guest execution', () => {
  it('selects the button around an SVG path and retains the hit', () => {
    const f = fixture('<button id="take"><svg><path /></svg>接管</button>', 'path')
    try {
      const result = normalizeHtmlElementPickResult(f.run(buildHtmlElementPickScript({ x: 20, y: 25 })))!
      const selection = resolveHtmlElementPickSelection(result)!
      expect(selection.element.selector).toBe('#take')
      expect(selection.hit.tagName).toBe('path')
      expect(selection.element.editableText).toBe(false)
    } finally { f.close() }
  })

  it('does not include password, hidden values or textarea drafts in ancestors', () => {
    const f = fixture('<form><input type="password" value="secret1"><input type="hidden" value="secret2"><textarea>secret3</textarea><button>Go</button></form>', 'button')
    try {
      const raw = f.run(buildHtmlElementPickScript({ x: 20, y: 25 }))
      expect(JSON.stringify(raw)).not.toMatch(/secret[123]/)
      expect(normalizeHtmlElementPickResult(raw)!.chain[0].editableText).toBe(true)
    } finally { f.close() }
  })

  it('rejects ambiguous resolve and falls back from duplicate ids', () => {
    const f = fixture('<button id="same">First</button><button id="same">Second</button>', 'button')
    try {
      const result = normalizeHtmlElementPickResult(f.run(buildHtmlElementPickScript({ x: 20, y: 25 })))!
      expect(result.chain[0].selector).toBe('body > button:nth-of-type(1)')
      expect(f.run(buildHtmlElementResolveScript('#same'))).toMatchObject({ ok: false })
      f.window.document.querySelector('button')!.textContent = 'Replacement'
      const replacement = normalizeHtmlElementPickResult(f.run(buildHtmlElementResolveScript(result.chain[0].selector)))!
      expect(htmlElementPickResolvedStillMatches(result.chain[0], replacement)).toBe(false)
    } finally { f.close() }
  })

  it('rejects sensitive hits and empty document hits', () => {
    for (const hit of ['input', 'body']) {
      const f = fixture('<input type="password" value="secret">', hit)
      try { expect(f.run(buildHtmlElementPickScript({ x: 0, y: 0 }))).toMatchObject({ ok: false }) }
      finally { f.close() }
    }
  })
})
