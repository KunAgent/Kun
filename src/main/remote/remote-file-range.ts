export type PdfByteRange = { start: number; end: number }

/** Single bounded HTTP byte range; PDF.js uses fixed-size chunks for visible pages. */
export function parsePdfByteRange(header: string | undefined, size: number): PdfByteRange | 'invalid' | null {
  if (!header) return null
  if (!Number.isSafeInteger(size) || size <= 0) return 'invalid'
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return 'invalid'
  const rawStart = match[1] ? Number(match[1]) : undefined
  const rawEnd = match[2] ? Number(match[2]) : undefined
  if ((rawStart !== undefined && !Number.isSafeInteger(rawStart)) ||
    (rawEnd !== undefined && !Number.isSafeInteger(rawEnd))) return 'invalid'
  const start = rawStart ?? Math.max(0, size - (rawEnd ?? 0))
  const end = rawStart === undefined ? size - 1 : Math.min(rawEnd ?? size - 1, size - 1)
  return start >= size || end < start ? 'invalid' : { start, end }
}
