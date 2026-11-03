// @vitest-environment jsdom

import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { loadKatexCopyTex } from './katex-copy-tex'

function copySelection(): Record<string, string> {
  const data: Record<string, string> = {}
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (type: string, value: string) => { data[type] = value } }
  })
  document.dispatchEvent(event)
  return data
}

describe('formula copy', () => {
  it('copies selected formulas as LaTeX and grows a partial selection to the whole formula', async () => {
    await loadKatexCopyTex()
    document.body.innerHTML = `<p id="prose">Energy ${katex.renderToString('E=mc^2')} and</p>` +
      `<div id="block">${katex.renderToString('\\int_0^1 x\\,dx', { displayMode: true })}</div>`

    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(document.getElementById('prose')!.firstChild!, 0)
    const inside = document.querySelector('#prose .katex-html')!
    range.setEnd(inside, 1)
    selection.removeAllRanges()
    selection.addRange(range)
    expect(copySelection()['text/plain']).toBe('Energy $E=mc^2$')

    const whole = document.createRange()
    whole.selectNodeContents(document.getElementById('block')!)
    selection.removeAllRanges()
    selection.addRange(whole)
    expect(copySelection()['text/plain']).toBe('$$\\int_0^1 x\\,dx$$')
  })

  it('leaves ordinary text copies alone', async () => {
    await loadKatexCopyTex()
    document.body.innerHTML = '<p id="plain">no math here</p>'
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('plain')!)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(copySelection()).toEqual({})
  })
})
