import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import { repairPptxPresentationChildOrder } from './office-pptx-presentation-order.js'

const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

const PRESENTATION_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<p:presentation xmlns:r="${RELATIONSHIPS_NS}" xmlns:p="${PRESENTATION_NS}">`
const SLIDE_MASTERS =
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
const NOTES_MASTER_LIST =
  '<p:notesMasterIdLst><p:notesMasterId r:id="rId11"/></p:notesMasterIdLst>'
const SLIDE_LIST = '<p:sldIdLst><p:sldId id="256" r:id="rId3"/></p:sldIdLst>'
const SIZES = '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
const ORDERED_PRESENTATION =
  `${PRESENTATION_HEADER}${SLIDE_MASTERS}${NOTES_MASTER_LIST}${SLIDE_LIST}${SIZES}` +
  '</p:presentation>'
// Mirrors the deck that blocked editing: the notes master list sits after sldIdLst.
const MISORDERED_PRESENTATION =
  `${PRESENTATION_HEADER}${SLIDE_MASTERS}${SLIDE_LIST}${NOTES_MASTER_LIST}${SIZES}` +
  '</p:presentation>'

const MEDIA = Buffer.from('media-bytes', 'utf8')

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function relationshipsXml(options: { notesMaster?: boolean } = {}): string {
  const notesMaster = options.notesMaster === false
    ? ''
    : `<Relationship Id="rId11" Type="${RELATIONSHIPS_NS}/notesMaster" ` +
      'Target="notesMasters/notesMaster1.xml"/>'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">` +
    `<Relationship Id="rId1" Type="${RELATIONSHIPS_NS}/slideMaster" ` +
    'Target="slideMasters/slideMaster1.xml"/>' +
    `<Relationship Id="rId3" Type="${RELATIONSHIPS_NS}/slide" Target="slides/slide1.xml"/>` +
    `${notesMaster}</Relationships>`
  )
}

async function writePptx(
  filePath: string,
  entries: Array<[string, string | Buffer]>
): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, value] of entries) {
    zip.addBuffer(typeof value === 'string' ? Buffer.from(value, 'utf8') : value, name)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(filePath))
}

async function readPart(filePath: string, part: string): Promise<Buffer> {
  const zipfile = await yauzl.openPromise(filePath, {
    lazyEntries: true,
    decodeStrings: true,
    autoClose: false
  })
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName !== part) continue
      const stream = await zipfile.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
      return Buffer.concat(chunks)
    }
    throw new Error(`missing fixture part ${part}`)
  } finally {
    zipfile.close()
  }
}

async function fixture(
  options: {
    presentation?: string
    relationships?: string
  } = {}
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-pptx-order-'))
  roots.push(root)
  const filePath = join(root, 'deck.pptx')
  await writePptx(filePath, [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="types"/>'],
    ['ppt/presentation.xml', options.presentation ?? MISORDERED_PRESENTATION],
    ['ppt/_rels/presentation.xml.rels', options.relationships ?? relationshipsXml()],
    ['ppt/media/image1.png', MEDIA]
  ])
  return filePath
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('PPTX presentation child order repair', () => {
  it('moves a misplaced notes master list into the schema position', async () => {
    const filePath = await fixture()

    const repairs = await repairPptxPresentationChildOrder(filePath)

    expect(repairs).toEqual([
      { part: 'ppt/presentation.xml', action: 'moved-notes-master-id-list' }
    ])
    const xml = (await readPart(filePath, 'ppt/presentation.xml')).toString('utf8')
    expect(xml.indexOf('<p:sldMasterIdLst>')).toBeLessThan(xml.indexOf('<p:notesMasterIdLst>'))
    expect(xml.indexOf('<p:notesMasterIdLst>')).toBeLessThan(xml.indexOf('<p:sldIdLst>'))
    expect(xml).toContain('<p:notesMasterId r:id="rId11"/>')
    expect(await readPart(filePath, 'ppt/_rels/presentation.xml.rels')).toEqual(
      Buffer.from(relationshipsXml(), 'utf8')
    )
    expect(await readPart(filePath, 'ppt/media/image1.png')).toEqual(MEDIA)
  })

  it('is idempotent once the deck is ordered', async () => {
    const filePath = await fixture()
    await repairPptxPresentationChildOrder(filePath)
    const before = sha256(await readFile(filePath))

    const repairs = await repairPptxPresentationChildOrder(filePath)

    expect(repairs).toEqual([])
    expect(sha256(await readFile(filePath))).toBe(before)
  })

  it('leaves an ordered deck byte-identical', async () => {
    const filePath = await fixture({ presentation: ORDERED_PRESENTATION })
    const before = sha256(await readFile(filePath))

    expect(await repairPptxPresentationChildOrder(filePath)).toEqual([])
    expect(sha256(await readFile(filePath))).toBe(before)
  })

  it('refuses duplicate notes master lists instead of guessing', async () => {
    const filePath = await fixture({
      presentation: `${PRESENTATION_HEADER}${SLIDE_MASTERS}${NOTES_MASTER_LIST}` +
        `${SLIDE_LIST}${NOTES_MASTER_LIST}${SIZES}</p:presentation>`
    })
    const before = sha256(await readFile(filePath))

    await expect(repairPptxPresentationChildOrder(filePath)).rejects.toThrow(
      /more than one notesMasterIdLst/
    )
    expect(sha256(await readFile(filePath))).toBe(before)
  })

  it('refuses a notes master list whose relationship is missing', async () => {
    const filePath = await fixture({ relationships: relationshipsXml({ notesMaster: false }) })
    const before = sha256(await readFile(filePath))

    await expect(repairPptxPresentationChildOrder(filePath)).rejects.toThrow(
      /do not define|not a notes master/
    )
    expect(sha256(await readFile(filePath))).toBe(before)
  })

  it('refuses to place the list beside an unknown presentation child', async () => {
    const filePath = await fixture({
      presentation: `${PRESENTATION_HEADER}${SLIDE_MASTERS}<p:futureExtension/>` +
        `${SLIDE_LIST}${NOTES_MASTER_LIST}${SIZES}</p:presentation>`
    })
    const before = sha256(await readFile(filePath))

    await expect(repairPptxPresentationChildOrder(filePath)).rejects.toThrow(
      /unsupported presentation child/
    )
    expect(sha256(await readFile(filePath))).toBe(before)
  })

  it('rejects a package without a presentation part', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-pptx-order-'))
    roots.push(root)
    const filePath = join(root, 'deck.pptx')
    await writePptx(filePath, [['[Content_Types].xml', '<?xml version="1.0"?><Types/>']])

    await expect(repairPptxPresentationChildOrder(filePath)).rejects.toThrow(
      /no ppt\/presentation\.xml/
    )
  })
})
