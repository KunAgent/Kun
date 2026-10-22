import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { afterEach, describe, expect, it } from 'vitest'
import { renderPptdPreviewDeck } from './pptd-preview-svg.js'
import { pptdRichTextToXhtml } from './pptd-preview-text.js'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const DECK = [
  'version: v2',
  'title: 季度复盘',
  'size: [960, 540]',
  'theme:',
  '  colors:',
  '    primary: "#14213D"',
  '    accent: "#F2A541"',
  '  textStyles:',
  '    title:',
  '      fontSize: 40',
  '      bold: true',
  '      color: "$primary"',
  'pages:',
  '  - pages/1_cover.page',
  '  - pages/2_data.page'
].join('\n')

const COVER = [
  'pageType: cover',
  'background:',
  '  type: gradient',
  '  gradientType: linear',
  '  angle: 90',
  '  stops:',
  '    - {position: 0, color: "$primary"}',
  '    - {position: 1, color: "#000000"}',
  'elements:',
  '  - elementId: title',
  '    elementType: text',
  '    bounds: [60, 160, 600, 80]',
  '    content:',
  '      style: "$title"',
  '      align: [left, middle]',
  '      text: "<p>Q3 &amp; 经营复盘 <span style=\\"color:$accent;background-image:url(x)\\">增长</span></p><script>alert(1)</script>"',
  '  - elementId: badge',
  '    elementType: shape',
  '    shapeName: roundRect',
  '    bounds: [60, 100, 120, 32]',
  '    fill: {type: solid, color: "#F2A54180"}',
  '    border: {color: "$primary", width: 2, style: dashed}',
  '  - elementId: hero',
  '    elementType: image',
  '    bounds: [640, 80, 260, 380]',
  '    src: media/hero.png',
  '    fit: {mode: cover}',
  '  - elementId: leak',
  '    elementType: image',
  '    bounds: [20, 20, 40, 40]',
  '    src: ../secret.png',
  '  - elementId: rule',
  '    elementType: line',
  '    bounds: [60, 260, 400, 4]',
  '    viewBox: [400, 4]',
  '    points: "0,2 400,2"',
  '    arrow: [null, triangle]',
  '    border: {color: "$accent", width: 3}'
].join('\n')

const DATA = [
  'elements:',
  '  - elementId: heading',
  '    elementType: text',
  '    bounds: [40, 30, 500, 50]',
  '    content: {fontSize: 28, bold: true, text: "分区域营收"}',
  '  - elementId: chart',
  '    elementType: chart',
  '    bounds: [40, 100, 440, 300]',
  '    data:',
  '      cols: [region, revenue]',
  '      rows: [[华东, 16], [华南, 11], [西北, 4]]',
  '    series:',
  '      - {type: bar, encode: {x: region, y: revenue}}',
  '  - elementId: share',
  '    elementType: chart',
  '    bounds: [500, 100, 420, 200]',
  '    data:',
  '      cols: [region, revenue]',
  '      rows: [[华东, 16], [华南, 11]]',
  '    series:',
  '      - {type: pie, encode: {category: region, value: revenue}, innerRadius: 0.5}',
  '  - elementId: risks',
  '    elementType: table',
  '    bounds: [500, 320, 420, 160]',
  '    columnWidths: [0.3, 0.7]',
  '    rowHeights: [0.5, 0.5]',
  '    rows:',
  '      - [{text: 风险, bold: true}, {text: 应对}]',
  '      - [{text: 回款慢, fill: {type: solid, color: "#FFF4E8"}}, {text: "账期 <b>60</b> 天"}]'
].join('\n')

let workspace = ''

async function writeProject(): Promise<string> {
  workspace = await mkdtemp(join(tmpdir(), 'pptd-preview-'))
  const project = join(workspace, 'deck')
  await mkdir(join(project, 'pages'), { recursive: true })
  await mkdir(join(project, 'media'), { recursive: true })
  await writeFile(join(project, 'deck.pptd'), DECK)
  await writeFile(join(project, 'pages', '1_cover.page'), COVER)
  await writeFile(join(project, 'pages', '2_data.page'), DATA)
  await writeFile(join(project, 'media', 'hero.png'), PNG_1X1)
  await writeFile(join(workspace, 'secret.png'), PNG_1X1)
  return project
}

function parseErrors(svg: string): string[] {
  const errors: string[] = []
  new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message)
    }
  }).parseFromString(svg, 'image/svg+xml')
  return errors
}

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
  workspace = ''
})

describe('renderPptdPreviewDeck', () => {
  it('renders every page as well-formed, self-contained SVG', async () => {
    const deck = await renderPptdPreviewDeck(await writeProject())

    expect(deck).toMatchObject({ title: '季度复盘', width: 960, height: 540 })
    expect(deck.pages.map((page) => page.pageFile)).toEqual(['pages/1_cover.page', 'pages/2_data.page'])
    for (const page of deck.pages) {
      expect(parseErrors(page.svg)).toEqual([])
      expect(page.svg).not.toMatch(/<script|url\(x\)|https?:\/\/(?!www\.w3\.org)/)
    }
  })

  it('embeds project images and refuses files outside the project', async () => {
    const [cover] = (await renderPptdPreviewDeck(await writeProject())).pages

    expect(cover.images).toEqual(['media/hero.png'])
    expect(cover.svg.match(/data:image\/png;base64,/g)).toHaveLength(1)
    expect(cover.svg).toContain('图片缺失')
  })

  it('keeps native text, theme colors, charts, and tables visible', async () => {
    const [cover, data] = (await renderPptdPreviewDeck(await writeProject())).pages

    expect(cover.title).toBe('Q3 & 经营复盘 增长')
    expect(cover.svg).toContain('Q3 &amp; 经营复盘')
    expect(cover.svg).toContain('color:#F2A541')
    expect(cover.svg).toContain('linearGradient')
    expect(cover.svg).toContain('stroke-dasharray')
    expect(cover.svg).toContain('marker-end')
    expect(data.title).toBe('分区域营收')
    expect(data.svg.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="#/g)?.length).toBeGreaterThanOrEqual(3)
    expect(data.svg).toContain('华东 59%')
    expect(data.svg).toContain('账期 <strong>60</strong> 天')
  })

  it('accepts a project directory or an explicit manifest, but not ambiguous folders', async () => {
    const project = await writeProject()
    await expect(renderPptdPreviewDeck(join(project, 'deck.pptd'))).resolves.toMatchObject({ title: '季度复盘' })
    await writeFile(join(project, 'other.pptd'), DECK)
    await expect(renderPptdPreviewDeck(project)).rejects.toThrow(/多个 .pptd/)
  })
})

describe('pptdRichTextToXhtml', () => {
  it('keeps plain text line breaks and escapes markup-like text', () => {
    expect(pptdRichTextToXhtml('a < b\nc', {})).toBe('a &lt; b<br/>c')
  })

  it('closes unbalanced tags and drops unknown ones', () => {
    expect(pptdRichTextToXhtml('<ul><li>一<li>二</ul><div>x</div>', {}))
      .toBe('<ul style="margin:0;padding-left:1.4em"><li>一<li>二</li></li></ul>x')
  })
})
