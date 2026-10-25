import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPptdDeck } from './pptd-deck.js'
import { lintPptdDeck } from './pptd-lint.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function deckWith(elements: string[], fonts = ['Inter', 'Source Serif 4']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-pptd-lint-'))
  roots.push(root)
  await mkdir(join(root, 'pages'))
  await writeFile(join(root, 'deck.pptd'), [
    'version: v2',
    'title: Lint',
    'size: [960, 540]',
    'theme:',
    '  textStyles:',
    ...fonts.map((font, index) => `    style${index}:\n      fontFamily: ${font}`),
    'pages:',
    '  - pages/01.page',
    ''
  ].join('\n'))
  await writeFile(join(root, 'pages', '01.page'), ['pageType: content', 'elements:', ...elements, ''].join('\n'))
  return join(root, 'deck.pptd')
}

function text(id: string, bounds: string, fontSize: number, value: string, wrap = true): string {
  return [
    `  - elementId: ${id}`,
    '    elementType: text',
    `    bounds: ${bounds}`,
    '    content:',
    `      fontSize: ${fontSize}`,
    `      wrap: ${wrap}`,
    `      text: "${value}"`
  ].join('\n')
}

describe('lintPptdDeck', () => {
  it('passes a readable in-bounds page', async () => {
    const deck = await loadPptdDeck(await deckWith([text('title', '[80, 80, 800, 120]', 32, 'Quarterly review')]))
    expect(lintPptdDeck(deck)).toEqual([])
  })

  it('flags small, overflowing, and off-slide text with page numbers', async () => {
    const deck = await loadPptdDeck(await deckWith([
      text('tiny', '[80, 80, 400, 60]', 8, 'Footnote'),
      text('crowded', '[80, 200, 200, 40]', 24, 'This sentence is far too long for such a small text box to hold'),
      text('outside', '[900, 500, 200, 80]', 20, 'Off the edge')
    ]))
    const issues = lintPptdDeck(deck)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 1, elementId: 'tiny', rule: 'small-text' }),
      expect.objectContaining({ page: 1, elementId: 'crowded', rule: 'text-overflow' }),
      expect.objectContaining({ page: 1, elementId: 'outside', rule: 'off-slide' })
    ]))
  })

  it('flags stretched images and too many font families', async () => {
    const deck = await loadPptdDeck(await deckWith([
      [
        '  - elementId: photo',
        '    elementType: image',
        '    bounds: [80, 80, 400, 200]',
        '    src: media/photo.png',
        '    fit: {mode: fill}'
      ].join('\n')
    ], ['Inter', 'Source Serif 4', 'Roboto Mono', 'Playfair Display']))
    expect(lintPptdDeck(deck)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 1, elementId: 'photo', rule: 'stretched-image' }),
      expect.objectContaining({ page: 0, rule: 'font-sprawl' })
    ]))
  })
})
