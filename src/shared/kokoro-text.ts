/**
 * Text preparation for local Kokoro speech.
 *
 * Assistant answers are Markdown, and reading Markdown syntax aloud is
 * unintelligible, so the pipeline is: strip markup -> normalize characters and
 * abbreviations -> split into speakable chunks. Every step is pure so it can be
 * unit tested and reused by both the renderer and the main process.
 */

/** Longest chunk handed to the model. Kept well under the 510-token voice limit. */
export const KOKORO_MAX_CHUNK_CHARS = 240

const FENCED_CODE = /(^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$)|$)/g
const UNCLOSED_FENCE = /(^|\n)[ \t]*(?:```|~~~)[^\n]*[\s\S]*$/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const INLINE_LINK = /\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*\)/g
const REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/g
const LINK_DEFINITION = /^[ \t]*\[[^\]]+\]:[^\n]*$/gm
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/g
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>]*>/g
const FOOTNOTE_REFERENCE = /\[\^[^\]]+\]/g
const HORIZONTAL_RULE = /^[ \t]*(?:[-*_][ \t]*){3,}$/gm
const TABLE_DIVIDER = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/
const ATX_HEADING = /^[ \t]{0,3}#{1,6}[ \t]*/
const SETEXT_UNDERLINE = /^[ \t]{0,3}(?:={2,}|-{2,})[ \t]*$/
const BLOCKQUOTE = /^[ \t]{0,3}(?:>[ \t]?)+/
const BULLET = /^[ \t]*(?:[-*+•][ \t]+|\[[ xX]\][ \t]+)/
const ORDERED = /^[ \t]*\d{1,3}[.)][ \t]+/
const EMPHASIS = /(\*\*\*|\*\*|\*|___|__|_|~~)/g
const INLINE_CODE = /`+([^`]*)`+/g
/** Emoji, arrows and dingbats have no pronunciation; drop them. */
const PICTOGRAPHS = /\p{Extended_Pictographic}/gu
/**
 * Variation selectors and zero-width joiners left behind once the emoji they
 * decorate is dropped. Skin-tone modifiers already fall inside PICTOGRAPHS.
 */
const EMOJI_MODIFIERS = /\u{FE0F}|\u{200D}/gu
const REPEATED_PUNCTUATION = /([,!?;:])\1{1,}/g
/** Kokoro's vocabulary has a dedicated ellipsis token; keep the pause. */
const ELLIPSIS = /\.{3,}/g

const SMART_CHARACTERS: Array<[RegExp, string]> = [
  [/[‘’‛′]/g, "'"],
  [/[“”‟″]/g, '"'],
  [/[–—―]/g, ', '],
  [/[\u00a0\u2007\u202f\u2002-\u200a\u3000]/g, ' '],
  [/[\u2022\u25cf\u25aa]/g, ' '],
  [/[«»]/g, '"']
]

/**
 * Abbreviations expanded before sentence splitting; their trailing period would
 * otherwise be read as the end of a sentence.
 */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bDr\./g, 'Doctor'],
  [/\bMr\./g, 'Mister'],
  [/\bMrs\./g, 'Misses'],
  [/\bMs\./g, 'Miss'],
  [/\bProf\./g, 'Professor'],
  [/\bSt\./g, 'Saint'],
  [/\be\.g\./gi, 'for example'],
  [/\bi\.e\./gi, 'that is'],
  [/\betc\./gi, 'etcetera'],
  [/\bvs\./gi, 'versus'],
  [/\bapprox\./gi, 'approximately'],
  [/\bFig\./gi, 'Figure'],
  [/\bNo\.(?=\s*\d)/g, 'number']
]

/** Markdown table row split into its cells, or null when the line is not a row. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  if (!trimmed.startsWith('|') && !/\|.*\|/.test(trimmed)) return null
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = body.split('|').map((cell) => cell.trim())
  return cells.length > 1 ? cells : null
}

const SPOKEN_SYMBOLS: Record<string, string> = {
  '≤': 'less than or equal to', '≥': 'greater than or equal to',
  '≠': 'not equal to', '≈': 'approximately equal to', '±': 'plus or minus',
  '×': 'times', '÷': 'divided by', '→': 'right arrow', '←': 'left arrow'
}

/** The bundled pronunciation data cannot handle non-Latin scripts. */
export function hasUnsupportedSpeechScript(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}]/u.test(text)
}

function stripInline(line: string): string {
  return line
    .replace(IMAGE, ' ')
    .replace(INLINE_LINK, '$1')
    .replace(REFERENCE_LINK, '$1')
    .replace(FOOTNOTE_REFERENCE, ' ')
    .replace(AUTOLINK, ' ')
    .replace(BARE_URL, ' ')
    .replace(INLINE_CODE, (_match, content: string) => content.replace(/_/g, ' underscore ').replace(/\*/g, ' asterisk '))
    .replace(HTML_TAG, ' ')
    .replace(EMPHASIS, '')
    .replace(EMOJI_MODIFIERS, '')
    .replace(/[≤≥≠≈±×÷→←]/g, (symbol) => ` ${SPOKEN_SYMBOLS[symbol]} `)
    .replace(PICTOGRAPHS, ' ')
}

/**
 * Reduce a Markdown answer to speakable prose. Fenced code blocks are dropped
 * entirely (reading source aloud is noise); table rows are read cell by cell.
 */
export function speechTextFromMarkdown(markdown: string): string {
  if (typeof markdown !== 'string' || !markdown) return ''
  const withoutCode = markdown
    .replace(HTML_COMMENT, '\n')
    .replace(FENCED_CODE, '\n')
    .replace(UNCLOSED_FENCE, '\n')
    .replace(LINK_DEFINITION, '')
    .replace(HORIZONTAL_RULE, '')
  const lines = withoutCode.split(/\r?\n/)
  const blocks: string[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length === 0) return
    blocks.push(paragraph.join(' '))
    paragraph = []
  }
  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      flush()
      continue
    }
    if (TABLE_DIVIDER.test(rawLine)) continue
    if (SETEXT_UNDERLINE.test(rawLine) && paragraph.length > 0) {
      flush()
      continue
    }
    const cells = tableCells(rawLine)
    if (cells) {
      flush()
      const spoken = cells.map((cell) => stripInline(cell).trim()).filter(Boolean).join(', ')
      if (spoken) blocks.push(endWithStop(spoken))
      continue
    }
    const heading = ATX_HEADING.test(rawLine)
    let line = rawLine.replace(BLOCKQUOTE, '').replace(ATX_HEADING, '')
    const listItem = BULLET.test(line) || ORDERED.test(line)
    line = line.replace(BULLET, '').replace(ORDERED, '')
    const spoken = stripInline(line).replace(/\s+/g, ' ').trim()
    if (!spoken) continue
    if (heading || listItem) {
      flush()
      blocks.push(endWithStop(spoken))
      continue
    }
    paragraph.push(spoken)
  }
  flush()
  return blocks.join('\n').replace(/\n{2,}/g, '\n').trim()
}

/** Give a block terminal punctuation so sentence splitting keeps it separate. */
function endWithStop(text: string): string {
  return /[.!?;:,]$/.test(text) ? text : `${text}.`
}

/**
 * Normalize characters, currency and abbreviations. espeak handles plain
 * numbers and dates on its own, so only forms it mispronounces are rewritten.
 */
export function normalizeSpeechText(text: string): string {
  if (typeof text !== 'string' || !text) return ''
  let value = text
  for (const [pattern, replacement] of SMART_CHARACTERS) value = value.replace(pattern, replacement)
  for (const [pattern, replacement] of ABBREVIATIONS) value = value.replace(pattern, replacement)
  value = value
    .replace(/\$(\d+(?:\.\d{1,2})?)\s?(?:million|M)\b/gi, '$1 million dollars')
    .replace(/\$(\d+(?:\.\d{1,2})?)\s?(?:billion|B)\b/gi, '$1 billion dollars')
    .replace(/\$(\d+)\.(\d{2})\b/g, '$1 dollars and $2 cents')
    .replace(/\$(\d+(?:[.,]\d+)*)/g, '$1 dollars')
    .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
    .replace(/(\d{1,2}):(\d{2})(?::(\d{2}))?/g, (_match, hour, minute, second) =>
      second ? `${hour} ${minute} ${second}` : `${hour} ${minute}`
    )
    .replace(/([A-Za-z0-9])\/([A-Za-z0-9])/g, '$1 slash $2')
    .replace(/&/g, ' and ')
    .replace(ELLIPSIS, '…')
    .replace(REPEATED_PUNCTUATION, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
  return value.trim()
}

/** Markdown answer -> normalized prose ready for chunking. */
export function speechTextFromAnswer(markdown: string): string {
  return normalizeSpeechText(speechTextFromMarkdown(markdown))
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\n+/

function hardSplit(sentence: string, maxChars: number): string[] {
  const pieces: string[] = []
  let rest = sentence
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    const breakAt = Math.max(
      window.lastIndexOf(', '),
      window.lastIndexOf('; '),
      window.lastIndexOf(': '),
      window.lastIndexOf(' ')
    )
    const cut = breakAt > maxChars * 0.4 ? breakAt + 1 : maxChars
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces.filter(Boolean)
}

/**
 * Split prose into chunks that are synthesized and played in order. Sentences
 * are packed together so short lines do not produce choppy playback, and any
 * sentence longer than `maxChars` is broken at a clause boundary.
 */
/**
 * Budget for the chunk spoken first.
 *
 * Synthesis is only a little faster than realtime, so a full-size first chunk
 * means seconds of silence after the user clicks. Roughly one sentence starts
 * playback quickly; later chunks are sized against the audio already buffered.
 */
export const KOKORO_FIRST_CHUNK_CHARS = 70

/** Smallest chunk budget worth using; below this, prosody suffers. */
export const KOKORO_MIN_CHUNK_CHARS = 40

/** Prose -> trimmed sentences, the unit chunks are assembled from. */
export function speechSentences(text: string): string[] {
  const normalized = typeof text === 'string' ? text.trim() : ''
  if (!normalized) return []
  return normalized
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** A markdown answer as sentences, ready to be chunked while it is spoken. */
export function speechSentencesFromAnswer(markdown: string): string[] {
  return speechSentences(speechTextFromAnswer(markdown))
}

/**
 * Remove and return the next chunk of at most `maxChars` characters.
 *
 * `queue` is consumed in place so the caller can decide each chunk's budget
 * from what it has learned - how fast synthesis is running, how much audio is
 * already scheduled - instead of committing to every boundary up front. A
 * sentence longer than the budget is broken at a clause boundary, and the
 * unused part stays at the head of the queue. Returns an empty string once the
 * queue is empty.
 */
export function takeSpeechChunk(queue: string[], maxChars: number): string {
  if (!Array.isArray(queue) || queue.length === 0) return ''
  const budget = Math.max(KOKORO_MIN_CHUNK_CHARS, Math.floor(maxChars))
  let current = ''
  while (queue.length > 0) {
    const sentence = queue[0]
    if (sentence.length > budget) {
      const pieces = hardSplit(sentence, budget)
      if (pieces.length > 1) {
        queue.splice(0, 1, ...pieces)
        continue
      }
    }
    if (!current) {
      current = queue.shift() as string
      continue
    }
    if (current.length + 1 + sentence.length > budget) break
    current = `${current} ${queue.shift() as string}`
  }
  return current
}

function drainChunks(sentences: string[], budgetFor: (index: number) => number): string[] {
  const queue = [...sentences]
  const chunks: string[] = []
  while (queue.length > 0) {
    const chunk = takeSpeechChunk(queue, budgetFor(chunks.length))
    if (!chunk) break
    chunks.push(chunk)
  }
  return chunks
}

export function splitSpeechChunks(text: string, maxChars: number = KOKORO_MAX_CHUNK_CHARS): string[] {
  const limit = Math.max(KOKORO_MIN_CHUNK_CHARS, Math.floor(maxChars))
  return drainChunks(speechSentences(text), () => limit)
}

/**
 * Markdown answer -> ordered speakable chunks, with the first chunk kept short
 * so playback starts without a long wait. Empty when nothing is speakable.
 */
export function speechChunksFromAnswer(
  markdown: string,
  maxChars: number = KOKORO_MAX_CHUNK_CHARS
): string[] {
  const limit = Math.max(KOKORO_MIN_CHUNK_CHARS, Math.floor(maxChars))
  const budgetFor = (index: number): number =>
    index === 0 ? Math.min(limit, KOKORO_FIRST_CHUNK_CHARS) : limit
  return drainChunks(speechSentencesFromAnswer(markdown), budgetFor)
}
