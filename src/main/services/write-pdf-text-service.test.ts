import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearWritePdfTextCache, readLocalPdfText, readWritePdfText } from './write-pdf-text-service'

function escapePdfText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function createSimpleTextPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    [
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'endobj\n'
    ].join('\n'),
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += 'xref\n0 6\n'
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

function createImageOnlyPdf(text: string): Buffer {
  const width = 1200
  const height = 360
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#111'
  context.font = '76px Arial'
  context.fillText(text, 72, 155)
  context.font = '44px Arial'
  context.fillText('This page has no PDF text layer.', 72, 245)
  const jpeg = canvas.toBuffer('image/jpeg', 95)

  const chunks: Buffer[] = []
  const offsets: number[] = []
  let byteLength = 0
  const write = (part: string | Buffer): void => {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part, 'ascii')
    chunks.push(chunk)
    byteLength += chunk.byteLength
  }
  const writeObject = (id: number, parts: Array<string | Buffer>): void => {
    offsets[id] = byteLength
    write(`${id} 0 obj\n`)
    for (const part of parts) write(part)
    write('\nendobj\n')
  }

  write('%PDF-1.4\n')
  writeObject(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  writeObject(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'])
  writeObject(3, [[
    '<< /Type /Page /Parent 2 0 R',
    `/MediaBox [0 0 ${width} ${height}]`,
    '/Resources << /XObject << /Im1 4 0 R >> >>',
    '/Contents 5 0 R >>'
  ].join('\n')])
  writeObject(4, [
    [
      '<< /Type /XObject /Subtype /Image',
      `/Width ${width} /Height ${height}`,
      '/ColorSpace /DeviceRGB /BitsPerComponent 8',
      '/Filter /DCTDecode',
      `/Length ${jpeg.byteLength} >>\nstream\n`
    ].join('\n'),
    jpeg,
    '\nendstream'
  ])
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`
  writeObject(5, [`<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`])
  const xrefOffset = byteLength
  write('xref\n0 6\n0000000000 65535 f \n')
  for (let id = 1; id <= 5; id += 1) {
    write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  write(`trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.concat(chunks)
}

afterEach(() => {
  clearWritePdfTextCache()
})

describe('write PDF text service', () => {
  it('extracts page text from a text-layer PDF fixture', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-write-pdf-text-'))
    const pdfPath = join(workspaceRoot, 'papers', 'fixture.pdf')
    await mkdir(join(workspaceRoot, 'papers'), { recursive: true })
    await writeFile(pdfPath, createSimpleTextPdf('PDF BM25 keyword retrieval context'))

    const result = await readWritePdfText({
      workspaceRoot,
      path: 'papers/fixture.pdf'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(1)
    expect(result.hasText).toBe(true)
    expect(result.pages[0]).toMatchObject({
      page: 1,
      charStart: 0
    })
    expect(result.pages[0].text).toContain('PDF BM25 keyword retrieval context')
  }, 15_000)

  it('extracts text for local PDF attachments', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-local-pdf-text-'))
    const pdfPath = join(workspaceRoot, 'fixture.pdf')
    await writeFile(pdfPath, createSimpleTextPdf('Local PDF attachment text'))

    const result = await readLocalPdfText({ path: pdfPath })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(1)
    expect(result.hasText).toBe(true)
    expect(result.pages[0]?.text).toContain('Local PDF attachment text')
  }, 15_000)

  it('falls back to OCR for image-only local PDF attachments', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-local-pdf-ocr-'))
    const pdfPath = join(workspaceRoot, 'scanned.pdf')
    await writeFile(pdfPath, createImageOnlyPdf('SCANNED PDF OCR'))

    const result = await readLocalPdfText({ path: pdfPath })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(1)
    expect(result.hasText).toBe(true)
    expect(result.ocrApplied).toBe(true)
    expect(result.ocrPageCount).toBe(1)
    expect(result.pages[0]?.source).toBe('ocr')
    expect(result.pages[0]?.text.toUpperCase()).toContain('SCANNED')
    expect(result.pages[0]?.text.toUpperCase()).toContain('OCR')
  }, 60_000)

  it('returns a recoverable no-text result when OCR fails for an image-only PDF', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-local-pdf-ocr-failure-'))
    const pdfPath = join(workspaceRoot, 'scanned-ocr-failure.pdf')
    await writeFile(pdfPath, createImageOnlyPdf('SCANNED PDF OCR FAILURE'))

    const createWorker = vi.fn(async () => {
      throw new Error('OCR worker unavailable')
    })

    vi.resetModules()
    vi.doMock('tesseract.js', () => ({
      createWorker,
      default: {
        createWorker,
        PSM: { AUTO: '3' }
      },
      PSM: { AUTO: '3' }
    }))

    try {
      const service = await import('./write-pdf-text-service')
      const result = await service.readLocalPdfText({ path: pdfPath })

      expect(createWorker).toHaveBeenCalledTimes(1)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.pageCount).toBe(1)
      expect(result.hasText).toBe(false)
      expect(result.pages).toEqual([])
      expect(result.ocrApplied).toBe(false)
      expect(result.ocrPageCount).toBe(0)
      expect(result.truncated).toBe(false)
      service.clearWritePdfTextCache()
    } finally {
      vi.doUnmock('tesseract.js')
      vi.resetModules()
    }
  }, 30_000)
})
