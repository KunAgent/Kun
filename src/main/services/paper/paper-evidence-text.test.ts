import { describe, expect, it } from 'vitest'
import { extractEvidencePdfText } from './paper-evidence-text'

function pdfWithText(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 12 Tf 20 700 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const start = Buffer.byteLength(body)
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(body)
}

describe('PDF evidence text extraction from hashed bytes', () => {
  it('uses real PDF.js on supplied bytes without detaching the input', async () => {
    const bytes = pdfWithText('arXiv:2401.12345v3 Actual result: 91% accuracy.')
    const before = Buffer.from(bytes)
    const result = await extractEvidencePdfText(bytes)
    expect(result).toMatchObject({ pageCount: 1, truncated: false,
      pages: [{ page: 1, text: 'arXiv:2401.12345v3 Actual result: 91% accuracy.' }] })
    expect(bytes.equals(before)).toBe(true)
  })

  it('does not reuse stale path/mtime text when replacement bytes differ', async () => {
    expect((await extractEvidencePdfText(pdfWithText('Original result'))).pages[0].text).toBe('Original result')
    expect((await extractEvidencePdfText(pdfWithText('Replaced result'))).pages[0].text).toBe('Replaced result')
  })

  it('reports pages with no text honestly and rejects out-of-range source pages', async () => {
    const bytes = pdfWithText('')
    expect((await extractEvidencePdfText(bytes)).pages).toEqual([{ page: 1, text: '' }])
    await expect(extractEvidencePdfText(bytes, 2)).rejects.toMatchObject({ code: 'stale-anchor' })
  })
})
