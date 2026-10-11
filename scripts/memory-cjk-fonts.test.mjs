import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertCjkFontReport, CJK_PROBES, inspectCjkFonts } from './memory-cjk-fonts.mjs'

const report = () => CJK_PROBES.map(selector => ({ selector, text: '中文', fonts: [
  { familyName: 'Noto Sans CJK SC', glyphCount: 2, isCustomFont: false }
] }))
test('accepts actual CJK glyph usage and rejects tofu, zero glyphs, missing probes and untranslated labels', () => {
  assertCjkFontReport(report())
  for (const fonts of [[{ familyName: 'Arial', glyphCount: 2 }], [{ familyName: 'Noto Sans CJK SC', glyphCount: 0 }]]) {
    assert.throws(() => assertCjkFontReport(report().map(entry => ({ ...entry, fonts }))), /refusing tofu/)
  }
  assert.throws(() => assertCjkFontReport(report().slice(1)), /every visible CJK/)
  assert.throws(() => assertCjkFontReport(report().map(entry => ({ ...entry, text: 'memoryTitle' }))), /translated Chinese/)
})
test('queries the actual platform font for each rendered node and always closes the CDP session', async () => {
  const calls = [], session = { send: async (method, params) => {
    calls.push([method, params])
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelector') return { nodeId: 2 }
    if (method === 'CSS.getPlatformFontsForNode') return { fonts: report()[0].fonts }
    return {}
  }, detach: async () => calls.push(['detach']) }
  const page = { evaluate: async () => undefined, context: () => ({ newCDPSession: async () => session }),
    locator: () => ({ innerText: async () => '中文' }) }
  assert.equal((await inspectCjkFonts(page)).length, 4)
  assert.equal(calls.filter(([method]) => method === 'CSS.getPlatformFontsForNode').length, 4)
  assert.equal(calls.at(-1)[0], 'detach')
})
