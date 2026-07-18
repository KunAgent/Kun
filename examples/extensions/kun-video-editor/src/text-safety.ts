type CharacterMatcher = (code: number) => boolean

const isAsciiControlCode: CharacterMatcher = (code) => code <= 0x1f || code === 0x7f
const isNullOrLineBreakCode: CharacterMatcher = (code) => code === 0 || code === 0x0a || code === 0x0d

function containsMatchingCharacter(value: string, matches: CharacterMatcher): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (matches(value.charCodeAt(index))) return true
  }
  return false
}

function replaceMatchingCharacters(
  value: string,
  replacement: string,
  matches: CharacterMatcher
): string {
  let result = ''
  let unchangedStart = 0
  for (let index = 0; index < value.length; index += 1) {
    if (!matches(value.charCodeAt(index))) continue
    result += value.slice(unchangedStart, index) + replacement
    unchangedStart = index + 1
  }
  return unchangedStart === 0 ? value : result + value.slice(unchangedStart)
}

export function containsAsciiControlCharacters(value: string): boolean {
  return containsMatchingCharacter(value, isAsciiControlCode)
}

export function containsNullOrLineBreak(value: string): boolean {
  return containsMatchingCharacter(value, isNullOrLineBreakCode)
}

export function replaceAsciiControlCharacters(value: string, replacement: string): string {
  return replaceMatchingCharacters(value, replacement, isAsciiControlCode)
}

export function replaceNullOrLineBreaks(value: string, replacement: string): string {
  return replaceMatchingCharacters(value, replacement, isNullOrLineBreakCode)
}
