/**
 * [INPUT]: 依赖用户原题和澄清答案中的中英文括号、顶层标点及连接词
 * [OUTPUT]: 对外提供只在括号外拆分研究范围列表的 splitTopLevelScopeList
 * [POS]: research/core 的领域无关范围列表解析器，被 Frame 和 Preflight 共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const CLOSING_BY_OPENING = new Map<string, string>([
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['【', '】'],
  ['{', '}'],
  ['「', '」'],
  ['“', '”']
])

const TOP_LEVEL_PUNCTUATION = new Set(['、', ',', '，', ';', '；', '/'])

export function splitTopLevelScopeList(
  value: string,
  options: { wordSeparators?: string[] } = {}
): string[] {
  const parts: string[] = []
  const closingStack: string[] = []
  const wordSeparators = [...(options.wordSeparators ?? [])].sort((left, right) => right.length - left.length)
  let current = ''

  const flush = () => {
    const normalized = current.trim()
    if (normalized) parts.push(normalized)
    current = ''
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    const closing = CLOSING_BY_OPENING.get(character)
    if (closing) {
      closingStack.push(closing)
      current += character
      continue
    }
    if (closingStack.at(-1) === character) {
      closingStack.pop()
      current += character
      continue
    }
    if (closingStack.length > 0) {
      current += character
      continue
    }
    if (TOP_LEVEL_PUNCTUATION.has(character)) {
      flush()
      continue
    }

    const wordSeparator = wordSeparators.find((candidate) => {
      if (!value.startsWith(candidate, index)) return false
      return candidate !== '及' || value[index + candidate.length] !== '其'
    })
    if (wordSeparator) {
      flush()
      index += wordSeparator.length - 1
      continue
    }
    current += character
  }
  flush()
  return parts
}
