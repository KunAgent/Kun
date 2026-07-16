import { Lunar } from 'lunar-typescript'

export interface MeihuaTimeInput {
  yearBranch: number
  lunarMonth: number
  lunarDay: number
  timeBranch: number
}

export interface MeihuaHexagram {
  upperTrigram: number
  lowerTrigram: number
  movingLine: number
  ordinal: number
}

const KING_WEN_TRIPLES = [
  [1, 1, 1],
  [8, 8, 2],
  [6, 4, 3],
  [7, 6, 4],
  [6, 1, 5],
  [1, 6, 6],
  [8, 6, 7],
  [6, 8, 8],
  [5, 1, 9],
  [1, 2, 10],
  [8, 1, 11],
  [1, 8, 12],
  [1, 3, 13],
  [3, 1, 14],
  [8, 7, 15],
  [4, 8, 16],
  [2, 4, 17],
  [7, 5, 18],
  [8, 2, 19],
  [5, 8, 20],
  [3, 4, 21],
  [7, 3, 22],
  [7, 8, 23],
  [8, 4, 24],
  [1, 4, 25],
  [7, 1, 26],
  [7, 4, 27],
  [2, 5, 28],
  [6, 6, 29],
  [3, 3, 30],
  [2, 7, 31],
  [4, 5, 32],
  [1, 7, 33],
  [4, 1, 34],
  [3, 8, 35],
  [8, 3, 36],
  [5, 3, 37],
  [3, 2, 38],
  [6, 7, 39],
  [4, 6, 40],
  [7, 2, 41],
  [5, 4, 42],
  [2, 1, 43],
  [1, 5, 44],
  [2, 8, 45],
  [8, 5, 46],
  [2, 6, 47],
  [6, 5, 48],
  [2, 3, 49],
  [3, 5, 50],
  [4, 4, 51],
  [7, 7, 52],
  [5, 7, 53],
  [4, 2, 54],
  [4, 3, 55],
  [3, 7, 56],
  [5, 5, 57],
  [2, 2, 58],
  [5, 6, 59],
  [6, 2, 60],
  [5, 2, 61],
  [4, 7, 62],
  [6, 3, 63],
  [3, 6, 64]
] as const

const KING_WEN_BY_UPPER_LOWER: ReadonlyMap<string, number> = new Map(
  KING_WEN_TRIPLES.map(([upperTrigram, lowerTrigram, ordinal]) => [
    `${upperTrigram}:${lowerTrigram}`,
    ordinal
  ])
)

function nonZeroRemainder(value: number, divisor: number): number {
  const remainder = value % divisor
  return remainder === 0 ? divisor : remainder
}

export function kingWenOrdinalFor(upperTrigram: number, lowerTrigram: number): number {
  const ordinal = KING_WEN_BY_UPPER_LOWER.get(`${upperTrigram}:${lowerTrigram}`)
  if (ordinal === undefined) {
    throw new Error(
      `Unknown trigram pair: upper ${upperTrigram}, lower ${lowerTrigram}`
    )
  }
  return ordinal
}

export function calculateMeihuaHexagram(input: MeihuaTimeInput): MeihuaHexagram {
  const upperSum = input.yearBranch + Math.abs(input.lunarMonth) + input.lunarDay
  const lowerSum = upperSum + input.timeBranch
  const upperTrigram = nonZeroRemainder(upperSum, 8)
  const lowerTrigram = nonZeroRemainder(lowerSum, 8)

  return {
    upperTrigram,
    lowerTrigram,
    movingLine: nonZeroRemainder(lowerSum, 6),
    ordinal: kingWenOrdinalFor(upperTrigram, lowerTrigram)
  }
}

export function lunarInputFromDate(date: Date): MeihuaTimeInput {
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid date for lunar conversion')
  }

  const lunar = Lunar.fromDate(date)

  return {
    yearBranch: lunar.getYearZhiIndex() + 1,
    lunarMonth: Math.abs(lunar.getMonth()),
    lunarDay: lunar.getDay(),
    timeBranch: lunar.getTimeZhiIndex() + 1
  }
}

export function calculateStartupHexagram(date: Date): MeihuaHexagram {
  return calculateMeihuaHexagram(lunarInputFromDate(date))
}
