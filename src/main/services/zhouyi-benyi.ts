import rawData from './data/zhouyi-benyi.json'

export type ZhouyiLinePosition = 1 | 2 | 3 | 4 | 5 | 6

const CANONICAL_NAMES = [
  '乾', '坤', '屯', '蒙', '需', '訟', '師', '比', '小畜', '履', '泰', '否', '同人', '大有', '謙', '豫',
  '隨', '蠱', '臨', '觀', '噬嗑', '賁', '剝', '復', '无妄', '大畜', '頤', '大過', '坎', '離', '咸', '恆',
  '遯', '大壯', '晉', '明夷', '家人', '睽', '蹇', '解', '損', '益', '夬', '姤', '萃', '升', '困', '井',
  '革', '鼎', '震', '艮', '漸', '歸妹', '豐', '旅', '巽', '兌', '渙', '節', '中孚', '小過', '既濟', '未濟'
] as const
const LINE_LABELS_BY_POSITION: readonly (readonly string[])[] = [
  ['初九', '初六'],
  ['九二', '六二'],
  ['九三', '六三'],
  ['九四', '六四'],
  ['九五', '六五'],
  ['上九', '上六']
]

export interface ZhouyiBenyiLine {
  readonly position: ZhouyiLinePosition
  readonly label: string
  readonly text: string
  readonly commentary: string
}

export interface ZhouyiBenyiEntry {
  readonly ordinal: number
  readonly glyph: string
  readonly name: string
  readonly statement: string
  readonly statementCommentary: string
  readonly lines: readonly ZhouyiBenyiLine[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid Zhouyi Benyi data: ${context} must be a nonempty string`)
  }
  return value
}

function validateLine(value: unknown, ordinal: number, index: number): ZhouyiBenyiLine {
  const expectedPosition = index + 1 as ZhouyiLinePosition
  if (!isRecord(value) || value.position !== expectedPosition) {
    throw new Error(
      `Invalid Zhouyi Benyi data: hexagram ${ordinal} line ${expectedPosition} has an invalid position`
    )
  }
  const label = requireNonEmptyString(
    value.label,
    `hexagram ${ordinal} line ${expectedPosition} label`
  )
  if (!LINE_LABELS_BY_POSITION[index].includes(label)) {
    throw new Error(
      `Invalid Zhouyi Benyi data: hexagram ${ordinal} line ${expectedPosition} has invalid label ${label}`
    )
  }

  return Object.freeze({
    position: expectedPosition,
    label,
    text: requireNonEmptyString(value.text, `hexagram ${ordinal} line ${expectedPosition} text`),
    commentary: requireNonEmptyString(
      value.commentary,
      `hexagram ${ordinal} line ${expectedPosition} commentary`
    )
  })
}

function validateEntry(value: unknown, index: number, ordinals: Set<number>): ZhouyiBenyiEntry {
  const expectedOrdinal = index + 1
  if (!isRecord(value) || value.ordinal !== expectedOrdinal || ordinals.has(value.ordinal)) {
    throw new Error(
      `Invalid Zhouyi Benyi data: expected unique ordinal ${expectedOrdinal} at index ${index}`
    )
  }
  ordinals.add(value.ordinal)

  if (!Array.isArray(value.lines) || value.lines.length !== 6) {
    throw new Error(`Invalid Zhouyi Benyi data: hexagram ${expectedOrdinal} must have exactly 6 lines`)
  }

  const expectedName = CANONICAL_NAMES[index]
  const name = requireNonEmptyString(value.name, `hexagram ${expectedOrdinal} name`)
  if (name !== expectedName) {
    throw new Error(
      `Invalid Zhouyi Benyi data: hexagram ${expectedOrdinal} must use canonical name ${expectedName}`
    )
  }

  const expectedGlyph = String.fromCodePoint(0x4dbf + expectedOrdinal)
  const glyph = requireNonEmptyString(value.glyph, `hexagram ${expectedOrdinal} glyph`)
  if (glyph !== expectedGlyph) {
    throw new Error(
      `Invalid Zhouyi Benyi data: hexagram ${expectedOrdinal} must use canonical glyph ${expectedGlyph}`
    )
  }

  return Object.freeze({
    ordinal: expectedOrdinal,
    glyph,
    name,
    statement: requireNonEmptyString(value.statement, `hexagram ${expectedOrdinal} statement`),
    statementCommentary: requireNonEmptyString(
      value.statementCommentary,
      `hexagram ${expectedOrdinal} statement commentary`
    ),
    lines: Object.freeze(
      value.lines.map((line, lineIndex) => validateLine(line, expectedOrdinal, lineIndex))
    )
  })
}

function validateData(value: unknown): readonly ZhouyiBenyiEntry[] {
  if (!Array.isArray(value) || value.length !== 64) {
    throw new Error('Invalid Zhouyi Benyi data: expected exactly 64 hexagrams')
  }

  const ordinals = new Set<number>()
  const entries = value.map((entry, index) => validateEntry(entry, index, ordinals))
  if (ordinals.size !== 64) {
    throw new Error('Invalid Zhouyi Benyi data: expected unique ordinals 1 through 64')
  }

  return Object.freeze(entries)
}

export const ZHOUYI_BENYI: readonly ZhouyiBenyiEntry[] = validateData(rawData)

export function zhouyiBenyiFor(ordinal: number): ZhouyiBenyiEntry {
  const entry = ZHOUYI_BENYI[ordinal - 1]
  if (!entry || entry.ordinal !== ordinal) {
    throw new Error(`Zhouyi Benyi has no hexagram ${ordinal}`)
  }
  return entry
}
