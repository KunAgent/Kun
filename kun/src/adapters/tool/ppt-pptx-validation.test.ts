import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { afterEach, describe, expect, it } from 'vitest'
import * as yazl from 'yazl'
import { validatePptx } from './ppt-pptx-validation.js'

const SLIDE_WIDTH = 12_192_000
const SLIDE_HEIGHT = 6_858_000
const roots: string[] = []

const namespaces = [
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"',
  'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
].join(' ')

function transform(x: number, y: number, width: number, height: number): string {
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
}

function picture(x = 0, y = 0, width = SLIDE_WIDTH, height = SLIDE_HEIGHT): string {
  return [
    '<p:pic>',
    '<p:nvPicPr><p:cNvPr id="2" name="review.png"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>',
    '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>',
    `<p:spPr>${transform(x, y, width, height)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
    '</p:pic>'
  ].join('')
}

type ShapeOptions = {
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  fontSize?: number
  fill?: 'visible' | 'transparent' | 'none'
}

function shape(options: ShapeOptions = {}): string {
  const x = options.x ?? 400_000
  const y = options.y ?? 400_000
  const width = options.width ?? 3_000_000
  const height = options.height ?? 1_000_000
  const fill = options.fill === 'visible'
    ? '<a:solidFill><a:srgbClr val="C54A2C"/></a:solidFill>'
    : options.fill === 'transparent'
      ? '<a:solidFill><a:srgbClr val="C54A2C"><a:alpha val="0"/></a:srgbClr></a:solidFill>'
      : ''
  const text = options.text === undefined
    ? ''
    : [
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>',
        `<a:rPr sz="${options.fontSize ?? 2400}"/>`,
        `<a:t>${options.text}</a:t>`,
        '</a:r></a:p></p:txBody>'
      ].join('')
  return [
    '<p:sp>',
    '<p:nvSpPr><p:cNvPr id="3" name="native-overlay"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>',
    `<p:spPr>${transform(x, y, width, height)}${fill}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
    text,
    '</p:sp>'
  ].join('')
}

function graphicFrame(kind: 'chart' | 'table' | 'diagram'): string {
  const contents = kind === 'chart'
    ? '<c:chart r:id="rId2"/>'
    : kind === 'table'
      ? '<a:tbl><a:tblPr/><a:tblGrid/></a:tbl>'
      : '<dgm:relIds r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/>'
  const uri = `http://schemas.openxmlformats.org/drawingml/2006/${kind}`
  return [
    '<p:graphicFrame>',
    '<p:nvGraphicFramePr><p:cNvPr id="4" name="native-data"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>',
    `<p:xfrm><a:off x="900000" y="700000"/><a:ext cx="7000000" cy="4000000"/></p:xfrm>`,
    `<a:graphic><a:graphicData uri="${uri}">${contents}</a:graphicData></a:graphic>`,
    '</p:graphicFrame>'
  ].join('')
}

function slideXml(contents: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld ${namespaces}><p:cSld><p:spTree>${contents}</p:spTree></p:cSld></p:sld>`
}

async function fixture(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-pptx-editability-'))
  roots.push(root)
  const path = join(root, 'deck.pptx')
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), '[Content_Types].xml')
  zip.addBuffer(Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`,
    `<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>`,
    '</p:presentation>'
  ].join('')), 'ppt/presentation.xml')
  zip.addBuffer(Buffer.from(slideXml(contents)), 'ppt/slides/slide1.xml')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PPTX native editability validation', () => {
  it.each([
    ['tiny shape', shape({ width: 10_000, height: 10_000, fill: 'visible' })],
    ['transparent shape', shape({ fill: 'transparent' })],
    ['empty shape', shape({ fill: 'none' })],
    ['tiny text', shape({ width: 10_000, height: 10_000, text: 'fake' })]
  ])('rejects a full-slide review raster padded with a %s', async (_label, overlay) => {
    const path = await fixture(picture() + overlay)
    await expect(validatePptx(path, 'none')).rejects.toThrow(/contains only raster image content \(raster coverage 100%\)/)
  })

  it('rejects tiled review rasters whose union covers the whole slide', async () => {
    const path = await fixture(
      picture(0, 0, SLIDE_WIDTH / 2, SLIDE_HEIGHT) +
      picture(SLIDE_WIDTH / 2, 0, SLIDE_WIDTH / 2, SLIDE_HEIGHT) +
      shape({ fill: 'none' })
    )
    await expect(validatePptx(path, 'none')).rejects.toThrow(/raster coverage 100%/)
  })

  it.each([
    ['native title', shape({ text: 'Covered native title' })],
    ['substantive native geometry', shape({ width: 3_000_000, height: 1_000_000, fill: 'visible' })]
  ])('rejects a %s hidden behind a later full-slide raster', async (_label, nativeElement) => {
    const path = await fixture(nativeElement + picture())
    await expect(validatePptx(path, 'none')).rejects.toThrow(/contains only raster image content \(raster coverage 100%\)/)
  })

  it('accepts a full-bleed background image with a real native title', async () => {
    const path = await fixture(picture() + shape({
      x: 900_000,
      y: 700_000,
      width: 9_500_000,
      height: 1_200_000,
      text: 'Native decision title'
    }))
    await expect(validatePptx(path, 'none')).resolves.toMatchObject({ slides: 1, editableSlides: 1 })
  })

  it('rejects a giant text box containing only two 6pt characters', async () => {
    const path = await fixture(picture() + shape({
      x: 0,
      y: 0,
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      text: 'OK',
      fontSize: 600
    }))
    await expect(validatePptx(path, 'none')).rejects.toThrow(/contains only raster image content/)
  })

  it('rejects a sparse editability token in a full-slide text box', async () => {
    const path = await fixture(picture() + shape({
      x: 0,
      y: 0,
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      text: 'EDITABLE_TOKEN',
      fontSize: 2400
    }))
    await expect(validatePptx(path, 'none')).rejects.toThrow(/contains only raster image content/)
  })

  it('accepts multiple substantive native text elements over a raster background', async () => {
    const path = await fixture(
      picture() +
      shape({ x: 900_000, y: 700_000, width: 4_000_000, height: 700_000, text: 'Plan', fontSize: 1800 }) +
      shape({ x: 900_000, y: 1_700_000, width: 4_000_000, height: 700_000, text: 'Next', fontSize: 1800 })
    )
    await expect(validatePptx(path, 'none')).resolves.toMatchObject({ slides: 1, editableSlides: 1 })
  })

  it('rejects a full-slide raster with only substantive decorative geometry', async () => {
    const path = await fixture(picture() + shape({ width: 3_000_000, height: 1_000_000, fill: 'visible' }))
    await expect(validatePptx(path, 'none')).rejects.toThrow(/contains only raster image content/)
  })

  it('accepts substantive native geometry when the slide is not raster-dominated', async () => {
    const path = await fixture(shape({ width: 3_000_000, height: 1_000_000, fill: 'visible' }))
    await expect(validatePptx(path, 'none')).resolves.toMatchObject({ slides: 1, editableSlides: 1 })
  })

  it.each(['chart', 'table', 'diagram'] as const)('accepts a native %s over a raster background', async (kind) => {
    const path = await fixture(picture() + graphicFrame(kind))
    await expect(validatePptx(path, 'none')).resolves.toMatchObject({ slides: 1, editableSlides: 1 })
  })
})
