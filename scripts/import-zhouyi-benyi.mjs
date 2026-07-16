// Development-only importer. Kun runtime code reads only the generated JSON file.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'

const API_URL = 'https://zh.wikisource.org/w/api.php'
const USER_AGENT = 'Kun-Zhouyi-import/1.0'
const PAGES = [
  {
    title: '周易本義 (四庫全書本)/卷1',
    revision: 528287,
    firstOrdinal: 1,
    count: 30
  },
  {
    title: '周易本義 (四庫全書本)/卷2',
    revision: 737053,
    firstOrdinal: 31,
    count: 34
  }
]
const CANONICAL_NAMES = [
  '乾', '坤', '屯', '蒙', '需', '訟', '師', '比', '小畜', '履', '泰', '否', '同人', '大有', '謙', '豫',
  '隨', '蠱', '臨', '觀', '噬嗑', '賁', '剝', '復', '无妄', '大畜', '頤', '大過', '坎', '離', '咸', '恆',
  '遯', '大壯', '晉', '明夷', '家人', '睽', '蹇', '解', '損', '益', '夬', '姤', '萃', '升', '困', '井',
  '革', '鼎', '震', '艮', '漸', '歸妹', '豐', '旅', '巽', '兌', '渙', '節', '中孚', '小過', '既濟', '未濟'
]
const LINE_LABELS = [
  /(?:初九|初六)/u,
  /(?:九二|六二)/u,
  /(?:九三|六三)/u,
  /(?:九四|六四)/u,
  /(?:九五|六五)/u,
  /(?:上九|上六)/u
]
const PRIMARY_LINE_LABEL = /(?:^|○)(初九|初六|九二|六二|九三|六三|九四|六四|九五|六五|上九|上六)/gu
const LATER_SECTION_BOUNDARY = '○文言曰'
const SOURCE_NAME_VARIANTS = new Map([
  [27, '頥'],
  [29, '習坎'],
  [32, '恒'],
  [34, '大壮']
])
const SOURCE_HEADER_CORRECTION = {
  expectedOrdinal: 39,
  sourceGlyph: '䷮',
  headerNote: '艮下坎上'
}

function compact(value) {
  return value.replace(/[〈〉\s]/gu, '').trim()
}

function cleanField(value) {
  return compact(value).replace(/^○/u, '')
}

function glyphFor(ordinal) {
  return String.fromCodePoint(0x4dbf + ordinal)
}

function textNotePairs(text, context) {
  const markerPattern = /⟦NOTE:([^⟧]*)⟧/gu
  const pairs = []
  let textStart = 0
  for (const marker of text.matchAll(markerPattern)) {
    pairs.push({
      text: text.slice(textStart, marker.index),
      commentary: marker[1]
    })
    textStart = marker.index + marker[0].length
  }

  if (text.slice(textStart).includes('⟦NOTE:')) {
    throw new Error(`Unterminated commentary marker for ${context}`)
  }
  if (textStart < text.length) {
    pairs.push({
      text: text.slice(textStart),
      commentary: null
    })
  }
  return pairs
}

function parsePrimaryLines(body, statementNoteEnd, ordinal, name) {
  const lines = []
  let reachedLaterSection = false

  for (const pair of textNotePairs(body.slice(statementNoteEnd), `${ordinal} ${name}`)) {
    if (reachedLaterSection) {
      continue
    }

    const segment = compact(pair.text)
    const laterSectionStart = segment.indexOf(LATER_SECTION_BOUNDARY)
    const primaryText = laterSectionStart === -1 ? segment : segment.slice(0, laterSectionStart)
    const matches = [...primaryText.matchAll(PRIMARY_LINE_LABEL)]

    if (matches.length > 1) {
      throw new Error(`Multiple primary line labels share one commentary for ${ordinal} ${name}`)
    }
    if (matches.length === 1) {
      const match = matches[0]
      if (lines.length === 6) {
        throw new Error(`Unexpected seventh primary line for ${ordinal} ${name}`)
      }

      const expectedPosition = lines.length
      const label = match[1]
      if (!LINE_LABELS[expectedPosition].test(label)) {
        throw new Error(
          `Expected line ${expectedPosition + 1} for ${ordinal} ${name}, found ${label}`
        )
      }
      if (pair.commentary === null) {
        throw new Error(`Missing commentary for line ${expectedPosition + 1} of ${ordinal} ${name}`)
      }

      const labelStart = match.index + (match[0].startsWith('○') ? 1 : 0)
      lines.push({
        position: expectedPosition + 1,
        label,
        text: cleanField(primaryText.slice(labelStart + label.length)),
        commentary: cleanField(pair.commentary)
      })
    }

    if (laterSectionStart !== -1) {
      reachedLaterSection = true
    }
  }

  if (lines.length !== 6) {
    throw new Error(`Expected 6 primary lines for ${ordinal} ${name}, parsed ${lines.length}`)
  }
  return lines
}

function parseHexagramBlock(block, expectedOrdinal) {
  const header = block.match(/^([\u4DC0-\u4DFF])⟦NOTE:([^⟧]+)⟧([\s\S]*)$/u)
  if (!header) {
    throw new Error(`Malformed hexagram block: ${block.slice(0, 40)}`)
  }

  const [, sourceGlyph, headerNote, body] = header
  const glyph = glyphFor(expectedOrdinal)
  const usesDocumentedCorrection =
    expectedOrdinal === SOURCE_HEADER_CORRECTION.expectedOrdinal &&
    sourceGlyph === SOURCE_HEADER_CORRECTION.sourceGlyph &&
    headerNote === SOURCE_HEADER_CORRECTION.headerNote

  if (sourceGlyph !== glyph && !usesDocumentedCorrection) {
    const sourceOrdinal = sourceGlyph.codePointAt(0) - 0x4dbf
    throw new Error(
      `Unexpected source glyph ${sourceGlyph} (ordinal ${sourceOrdinal}) for expected ordinal ${expectedOrdinal}`
    )
  }

  const name = CANONICAL_NAMES[expectedOrdinal - 1]
  if (!name) {
    throw new Error(`No canonical name for ordinal ${expectedOrdinal}`)
  }

  const statementNoteStart = body.indexOf('⟦NOTE:')
  if (statementNoteStart === -1) {
    throw new Error(`Missing statement commentary for ${expectedOrdinal} ${name}`)
  }

  const statementWithName = cleanField(body.slice(0, statementNoteStart))
  const sourceName = SOURCE_NAME_VARIANTS.get(expectedOrdinal) ?? name
  if (!statementWithName.startsWith(sourceName)) {
    throw new Error(
      `Statement for ${expectedOrdinal} ${name} does not begin with source name ${sourceName}: ${statementWithName}`
    )
  }

  const statementMarker = /^⟦NOTE:([^⟧]*)⟧/u.exec(body.slice(statementNoteStart))
  if (!statementMarker) {
    throw new Error(`Malformed statement commentary for ${expectedOrdinal} ${name}`)
  }

  const statement = statementWithName.slice(sourceName.length)
  const statementCommentary = cleanField(statementMarker[1])
  const statementNoteEnd = statementNoteStart + statementMarker[0].length
  const lines = parsePrimaryLines(body, statementNoteEnd, expectedOrdinal, name)

  return {
    entry: {
      ordinal: expectedOrdinal,
      glyph,
      name,
      statement,
      statementCommentary,
      lines
    },
    correctedHeader: usesDocumentedCorrection
  }
}

function syntheticBlock({
  labels,
  statementCommentary = 'statement commentary',
  beforeLines = '',
  afterLine,
  afterLines = ''
}) {
  const linePairs = labels
    .map(
      (label, index) =>
        `○${label}line${index + 1}⟦NOTE:commentary${index + 1}⟧${afterLine?.(index) ?? ''}`
    )
    .join('')
  return `䷀⟦NOTE:乾下乾上⟧乾statement⟦NOTE:${statementCommentary}⟧${beforeLines}${linePairs}${afterLines}`
}

function runParserSelfChecks() {
  const labels = ['初九', '九二', '九三', '九四', '九五', '上九']

  assert.throws(
    () => parseHexagramBlock(syntheticBlock({ labels: labels.slice(1), statementCommentary: '初九' }), 1),
    /Expected line 1/,
    'a line label inside a NOTE must not count as a primary line'
  )
  assert.throws(
    () => parseHexagramBlock(syntheticBlock({ labels: [labels[0], ...labels] }), 1),
    /Expected line 2/,
    'a duplicate primary line must fail'
  )
  assert.throws(
    () => parseHexagramBlock(syntheticBlock({ labels: [labels[0], labels[2], labels[1], ...labels.slice(3)] }), 1),
    /Expected line 2/,
    'out-of-order primary lines must fail'
  )
  assert.throws(
    () => parseHexagramBlock(syntheticBlock({ labels, afterLines: '○初九seventh' }), 1),
    /Unexpected seventh primary line/,
    'a seventh primary line before a later section must fail'
  )

  const withInterveningCommentary = parseHexagramBlock(
    syntheticBlock({
      labels,
      beforeLines: '○彖曰synthetic⟦NOTE:初九appears only in a NOTE⟧',
      afterLine: (index) => `○象曰line${index + 1}⟦NOTE:image commentary${index + 1}⟧`
    }),
    1
  )
  assert.deepEqual(
    withInterveningCommentary.entry.lines.map(({ label }) => label),
    labels
  )

  const withLaterReference = parseHexagramBlock(
    syntheticBlock({ labels, afterLines: '○文言曰○初九later reference⟦NOTE:later commentary⟧' }),
    1
  )
  assert.equal(withLaterReference.entry.lines.length, 6)
}

function sanitizedApiErrorField(value, fallback) {
  if (typeof value !== 'string') {
    return fallback
  }
  const printable = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character
    })
    .join('')
  return printable.replace(/\s+/gu, ' ').trim().slice(0, 500) || fallback
}

function parsePage(html, page) {
  const $ = cheerio.load(html)
  $('style, script').remove()
  $('small').each((_, element) => {
    $(element).replaceWith(`⟦NOTE:${compact($(element).text())}⟧`)
  })
  $('br').replaceWith('\n')

  const poemText = $('.poem').text()
  const blocks = poemText.match(
    /[\u4DC0-\u4DFF]⟦NOTE:[^⟧]*⟧[\s\S]*?(?=[\u4DC0-\u4DFF]⟦NOTE:|$)/gu
  ) ?? []
  if (blocks.length !== page.count) {
    throw new Error(`Expected ${page.count} blocks in ${page.title}, parsed ${blocks.length}`)
  }

  return blocks.map((block, index) => parseHexagramBlock(block, page.firstOrdinal + index))
}

async function fetchPage(page) {
  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    oldid: String(page.revision),
    prop: 'text|revid'
  }).toString()

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  })
  if (!response.ok) {
    throw new Error(`Wikisource request failed for ${page.title}: HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (payload?.error) {
    const code = sanitizedApiErrorField(payload.error.code, 'unknown')
    const info = sanitizedApiErrorField(payload.error.info, 'No details provided')
    throw new Error(`Wikisource API error for ${page.title}: ${code}: ${info}`)
  }
  if (!payload.parse?.text || !Number.isInteger(payload.parse.revid)) {
    throw new Error(`Wikisource returned an invalid parse response for ${page.title}`)
  }
  if (payload.parse.title !== page.title || payload.parse.revid !== page.revision) {
    throw new Error(
      `Expected ${page.title} revision ${page.revision}, received ${payload.parse.title} revision ${payload.parse.revid}`
    )
  }

  return {
    ...page,
    parsed: parsePage(payload.parse.text, page)
  }
}

function validateEntries(entries, correctionCount) {
  if (entries.length !== 64) {
    throw new Error(`Expected 64 hexagrams, parsed ${entries.length}`)
  }
  if (correctionCount !== 1) {
    throw new Error(`Expected exactly one documented header correction, applied ${correctionCount}`)
  }

  const expectedOrdinals = Array.from({ length: 64 }, (_, index) => index + 1)
  const actualOrdinals = entries.map((entry) => entry.ordinal)
  if (actualOrdinals.some((ordinal, index) => ordinal !== expectedOrdinals[index])) {
    throw new Error(`Expected exact ordinals 1..64, parsed ${actualOrdinals.join(', ')}`)
  }

  for (const entry of entries) {
    if (!entry.glyph || !entry.name || !entry.statement || !entry.statementCommentary) {
      throw new Error(`Empty hexagram data for ${entry.ordinal} ${entry.name}`)
    }
    if (entry.lines.length !== 6) {
      throw new Error(`Expected 6 lines for ${entry.ordinal} ${entry.name}, parsed ${entry.lines.length}`)
    }
    for (const line of entry.lines) {
      if (!line.label || !line.text || !line.commentary) {
        throw new Error(`Empty line ${line.position} data for ${entry.ordinal} ${entry.name}`)
      }
    }
  }
}

runParserSelfChecks()

if (process.argv.includes('--self-check')) {
  console.log('Zhouyi Benyi importer self-check passed')
  process.exit(0)
}

const pages = await Promise.all(PAGES.map(fetchPage))
const parsed = pages.flatMap((page) => page.parsed)
const entries = parsed.map(({ entry }) => entry)
const correctionCount = parsed.filter(({ correctedHeader }) => correctedHeader).length
validateEntries(entries, correctionCount)

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const target = resolve(scriptDirectory, '../src/main/services/data/zhouyi-benyi.json')
await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')

console.log(`Wrote ${target}`)
for (const page of pages) {
  console.log(`${page.title} revision ${page.revision} (${page.parsed.length} hexagrams)`)
}
console.log(`Applied ${correctionCount} documented source header correction`)
