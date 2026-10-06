import assert from 'node:assert/strict'

export const CJK_PROBES = [
  '.memory-section-tabs button:first-child',
  '.memory-section-tabs button[aria-current="page"]',
  '.memory-fixture-conversation button',
  '.project-knowledge-panel > summary'
]

/** Check fonts actually used by Chromium for rendered text, not CSS/font availability alone. */
export function assertCjkFontReport(report) {
  assert.equal(report.length, CJK_PROBES.length, 'every visible CJK probe must be inspected')
  for (const [index, entry] of report.entries()) {
    assert.equal(entry.selector, CJK_PROBES[index])
    const hanCharacters = [...entry.text.matchAll(/\p{Script=Han}/gu)].length
    assert.ok(hanCharacters > 0, `${entry.selector} must contain translated Chinese text`)
    const cjkGlyphs = entry.fonts.filter(font => /^Noto (?:Sans|Serif)(?: Mono)? CJK\b/.test(font.familyName))
      .reduce((sum, font) => sum + font.glyphCount, 0)
    assert.ok(cjkGlyphs >= hanCharacters,
      `${entry.selector} rendered only ${cjkGlyphs}/${hanCharacters} Han glyphs with the required Noto CJK font; refusing tofu screenshots`)
  }
}

export async function inspectCjkFonts(page) {
  await page.evaluate(async () => { await document.fonts.ready })
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const report = []
    for (const selector of CJK_PROBES) {
      const text = await page.locator(selector).innerText()
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
      assert.ok(nodeId, `missing rendered CJK probe: ${selector}`)
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
      report.push({ selector, text, fonts })
    }
    assertCjkFontReport(report)
    return report
  } finally { await session.detach() }
}
