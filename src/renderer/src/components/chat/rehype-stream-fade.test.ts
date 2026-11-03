import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown, type StreamdownProps } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rehypeFileReferences } from '../../lib/file-references'
import {
  createStreamFadeSource,
  rehypeStreamFade,
  STREAM_FADE_TAG,
  type StreamFadeSnapshot
} from './rehype-stream-fade'
import { StreamFadeChar } from './StreamFadeChar'

const NOW = 10_000

function snapshotFor(text: string, from: number, birth = NOW): StreamFadeSnapshot {
  const births = new Map<number, number>()
  for (let offset = from; offset < text.length; offset += 1) births.set(offset, birth + (offset - from) * 5)
  return { fadeFrom: from, births, now: NOW, fadeMs: 180 }
}

function render(text: string, snapshot: StreamFadeSnapshot, withFileReferences = false): string {
  const source = createStreamFadeSource()
  source.current = snapshot
  const rehypePlugins = [
    ...(withFileReferences ? [rehypeFileReferences] : []),
    [rehypeStreamFade, source]
  ] as StreamdownProps['rehypePlugins']
  return renderToStaticMarkup(createElement(Streamdown, {
    mode: 'static',
    parseIncompleteMarkdown: false,
    isAnimating: false,
    animated: false,
    remarkPlugins: [remarkGfm],
    rehypePlugins,
    components: { [STREAM_FADE_TAG]: StreamFadeChar } as StreamdownProps['components'],
    children: text
  }))
}

function fadedText(html: string): string {
  return [...html.matchAll(/<span class="ds-stream-char"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]).join('')
}

describe('rehypeStreamFade', () => {
  it('wraps only the in-flight tail and leaves the settled prefix as plain text', () => {
    const text = 'Settled words then tail'
    const html = render(text, snapshotFor(text, text.indexOf('tail')))
    expect(fadedText(html)).toBe('tail')
    expect(html).toContain('Settled words then ')
    expect((html.match(/ds-stream-char/g) ?? []).length).toBe(4)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('places queued graphemes after their birth and started ones mid-fade', () => {
    vi.spyOn(performance, 'now').mockReturnValue(NOW)
    const text = 'abc'
    const births = new Map([[0, NOW - 60], [1, NOW + 40]])
    const html = render(text, { fadeFrom: 0, births, now: NOW, fadeMs: 180 })
    const delays = [...html.matchAll(/animation-delay:(-?\d+)ms/g)].map((match) => Number(match[1]))
    expect(delays).toHaveLength(2)
    expect(delays[0]).toBeLessThan(0)
    expect(delays[1]).toBeGreaterThan(0)
  })

  it('maps formatted text through source positions', () => {
    const text = 'Some **bold words** and more'
    const html = render(text, snapshotFor(text, text.indexOf('words')))
    expect(fadedText(html)).toBe('wordsandmore')
    expect(html).toContain('data-streamdown="strong"')
  })

  it('skips code, keeps settled and whitespace graphemes plain', () => {
    const text = 'Run `npm test` now\n\n```ts\nconst a = 1\n```'
    const html = render(text, snapshotFor(text, text.indexOf('`npm')))
    expect(fadedText(html)).toBe('now')
    expect(html).toContain('npm test')

    const settled = render('all settled', snapshotFor('all settled', 0, NOW - 1000))
    expect(settled).not.toContain('ds-stream-char')
  })

  it('keeps grapheme clusters inside one element', () => {
    const text = 'go 👩‍💻 🇨🇳'
    const html = render(text, snapshotFor(text, 3))
    expect(fadedText(html)).toBe('👩‍💻🇨🇳')
    expect((html.match(/ds-stream-char/g) ?? []).length).toBe(2)
  })

  it('reads the current snapshot on every run of a cached processor', () => {
    const source = createStreamFadeSource()
    const options = (text: string) => ({
      mode: 'static' as const,
      rehypePlugins: [[rehypeStreamFade, source]] as StreamdownProps['rehypePlugins'],
      components: { [STREAM_FADE_TAG]: StreamFadeChar } as StreamdownProps['components'],
      children: text
    })
    source.current = snapshotFor('first run', 6)
    expect(fadedText(renderToStaticMarkup(createElement(Streamdown, options('first run'))))).toBe('run')
    source.current = null
    expect(renderToStaticMarkup(createElement(Streamdown, options('first run')))).not.toContain('ds-stream-char')
  })

  it('locates text split by file-reference links', () => {
    const text = 'Open src/renderer/main.tsx then continue'
    const html = render(text, snapshotFor(text, text.indexOf('main.tsx')), true)
    expect(fadedText(html)).toBe('main.tsxthencontinue')
  })
})
