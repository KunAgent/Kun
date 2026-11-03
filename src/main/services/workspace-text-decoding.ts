import type { WorkspaceTextEncoding } from '../../shared/workspace-file'

export type DecodedWorkspaceText = {
  text: string
  encoding: WorkspaceTextEncoding
}

type DecodeOptions = {
  /** Reopen with this encoding instead of detecting one. */
  forced?: WorkspaceTextEncoding
  /** The bytes are a head slice, so a trailing multi-byte sequence may be cut. */
  truncated?: boolean
}

const SNIFF_BYTES = 8192
const BINARY_CONTROL_RATIO = 0.3
/** At most one invalid byte per this many valid multi-byte UTF-8 sequences still reads as UTF-8. */
const UTF8_INVALID_TOLERANCE = 50

const DECODER_LABELS: Record<WorkspaceTextEncoding, string> = {
  'utf-8': 'utf-8',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  gb18030: 'gb18030',
  big5: 'big5',
  shift_jis: 'shift_jis',
  'windows-1252': 'windows-1252'
}

export function detectTextBom(bytes: Uint8Array): { encoding: WorkspaceTextEncoding; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', length: 2 }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', length: 2 }
  return null
}

/**
 * Mostly-ASCII UTF-16 without a BOM has a zero in every other byte. Text in
 * other scripts has no such pattern and stays undetected, which is fine: it
 * then fails the UTF-8 check and the user can pick the encoding by hand.
 */
export function guessUtf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const length = Math.min(bytes.length, SNIFF_BYTES) & ~1
  if (length < 8) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let index = 0; index < length; index += 2) {
    if (bytes[index] === 0) evenZeros += 1
    if (bytes[index + 1] === 0) oddZeros += 1
  }
  const pairs = length / 2
  const guess = oddZeros / pairs > 0.4 && evenZeros / pairs < 0.05
    ? 'utf-16le'
    : evenZeros / pairs > 0.4 && oddZeros / pairs < 0.05 ? 'utf-16be' : null
  if (!guess) return null
  // Little-endian integer tables share the zero pattern; real text decodes to printable characters.
  return looksLikeText(decodeWith(guess, bytes.subarray(0, length))) ? guess : null
}

function looksLikeText(text: string): boolean {
  if (!text) return false
  let controls = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 0) return false
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 27) controls += 1
  }
  return controls / text.length <= 0.05
}

/** NUL bytes, or mostly control characters, mean the bytes are not text. ESC stays text for ANSI logs. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.length, SNIFF_BYTES)
  if (length === 0) return false
  let controls = 0
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index]
    if (byte === 0) return true
    if ((byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) || byte === 127) controls += 1
  }
  return controls / length > BINARY_CONTROL_RATIO
}

function sequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf4) return 4
  return 0
}

/** Drops a multi-byte sequence that the read limit cut in half. */
export function trimIncompleteUtf8Tail(bytes: Uint8Array): Uint8Array {
  for (let back = 1; back <= 3 && back <= bytes.length; back += 1) {
    const byte = bytes[bytes.length - back]
    if ((byte & 0xc0) === 0x80) continue
    const needed = sequenceLength(byte)
    return needed > back ? bytes.subarray(0, bytes.length - back) : bytes
  }
  return bytes
}

export function scanUtf8(bytes: Uint8Array): { invalid: number; multibyte: number } {
  let invalid = 0
  let multibyte = 0
  let index = 0
  while (index < bytes.length) {
    const lead = bytes[index]
    if (lead < 0x80) {
      index += 1
      continue
    }
    const needed = sequenceLength(lead)
    let valid = needed > 0 && index + needed <= bytes.length
    for (let offset = 1; valid && offset < needed; offset += 1) {
      if ((bytes[index + offset] & 0xc0) !== 0x80) valid = false
    }
    if (valid && needed === 3) {
      const second = bytes[index + 1]
      if ((lead === 0xe0 && second < 0xa0) || (lead === 0xed && second > 0x9f)) valid = false
    }
    if (valid && needed === 4) {
      const second = bytes[index + 1]
      if ((lead === 0xf0 && second < 0x90) || (lead === 0xf4 && second > 0x8f)) valid = false
    }
    if (valid) {
      multibyte += 1
      index += needed
    } else {
      invalid += 1
      index += 1
    }
  }
  return { invalid, multibyte }
}

function decodeWith(encoding: WorkspaceTextEncoding, bytes: Uint8Array, fatal = false): string {
  return new TextDecoder(DECODER_LABELS[encoding], { fatal, ignoreBOM: false }).decode(bytes)
}

function tryDecode(encoding: WorkspaceTextEncoding, bytes: Uint8Array): string | null {
  try {
    return decodeWith(encoding, bytes, true)
  } catch {
    return null
  }
}

function evenLength(bytes: Uint8Array): Uint8Array {
  return bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1)
}

/**
 * Decodes a file head for preview, or returns null for binary content.
 * Detection order: forced encoding, BOM, BOM-less UTF-16, binary sniff,
 * UTF-8 (tolerating a few broken bytes), GB18030, then Windows-1252.
 */
export function decodeWorkspaceText(
  bytes: Uint8Array,
  options: DecodeOptions = {}
): DecodedWorkspaceText | null {
  if (options.forced) {
    const bom = detectTextBom(bytes)
    const body = bom && bom.encoding === options.forced ? bytes.subarray(bom.length) : bytes
    const sized = options.forced.startsWith('utf-16') ? evenLength(body) : body
    return { text: decodeWith(options.forced, sized), encoding: options.forced }
  }

  const bom = detectTextBom(bytes)
  if (bom) {
    const body = bytes.subarray(bom.length)
    const sized = bom.encoding === 'utf-8'
      ? (options.truncated ? trimIncompleteUtf8Tail(body) : body)
      : evenLength(body)
    return { text: decodeWith(bom.encoding, sized), encoding: bom.encoding }
  }

  const utf16 = guessUtf16WithoutBom(bytes)
  if (utf16) return { text: decodeWith(utf16, evenLength(bytes)), encoding: utf16 }

  if (isProbablyBinary(bytes)) return null

  const body = options.truncated ? trimIncompleteUtf8Tail(bytes) : bytes
  const { invalid, multibyte } = scanUtf8(body)
  if (invalid === 0 || (multibyte > 0 && invalid * UTF8_INVALID_TOLERANCE <= multibyte)) {
    return { text: decodeWith('utf-8', body), encoding: 'utf-8' }
  }

  // A cut head may end inside a 2- or 4-byte GB18030 sequence.
  for (let cut = 0; cut <= (options.truncated ? 3 : 0) && cut < bytes.length; cut += 1) {
    const gb18030 = tryDecode('gb18030', bytes.subarray(0, bytes.length - cut))
    if (gb18030 !== null) return { text: gb18030, encoding: 'gb18030' }
  }
  return { text: decodeWith('windows-1252', bytes), encoding: 'windows-1252' }
}
