/**
 * [INPUT]: 依赖报告句、AtomicClaim 和 EvidenceSpan 中的文本
 * [OUTPUT]: 对外提供排除 claim/structured-claim/evidence 机器占位符与“几十年/数十年”等不定数量后的原始数字 token 差异、英文不定冠词时间数量、英文月份、percentage points/points 与中文“个百分点”及 times 与“倍/x”的数字单位等价校验、仅供成品跨语言译写使用的同币种金额数学等价校验、用户数量范围仅在证据不足边界句中的安全豁免，以及领域中立 claim 忠实评估，检测无依据数量或单位换算、匿名主体归属、实现状态、适用性/建议、绝对化结论和原文半词截断
 * [POS]: research/evidence 的确定性 claim-support 校验器，被 Worker、EvidenceStore、Writer 和 QualityVerifier 复用；证据入库继续要求数字原样，金额换算豁免只经显式翻译接口开放
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Unicode 单词边界会漏掉紧贴 CJK 的数字，如“第24次”。
// 这里只让 ASCII 标识符字符阻断数字匹配。
const NUMERIC_TOKEN_RE = /(?<!\d)(?:[$￥¥€£]\s*)?(\d+(?:[.,]\d+)*)(?:\s*(percentage(?:\s+|-)points?|points?|个百分点|%|％|percent(?!age)|times?|倍|x))?(?!\d)/giu
const CHINESE_COUNT_RE = /(?<![零〇一二两三四五六七八九十百千万几数])(?:第|前)?([零〇一二两三四五六七八九十百]{1,5})(?=次|届|名|位|年|月|日)/gu
const ENGLISH_COUNTS = new Map<string, number>([
  ['one', 1], ['first', 1], ['two', 2], ['second', 2], ['three', 3], ['third', 3],
  ['four', 4], ['fourth', 4], ['five', 5], ['fifth', 5], ['six', 6], ['sixth', 6],
  ['seven', 7], ['seventh', 7], ['eight', 8], ['eighth', 8], ['nine', 9], ['ninth', 9],
  ['ten', 10], ['tenth', 10], ['eleven', 11], ['eleventh', 11], ['twelve', 12], ['twelfth', 12]
])
const ENGLISH_COUNT_RE = /\b(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth|eleven|eleventh|twelve|twelfth)\b/giu
const ENGLISH_INDEFINITE_TIME_COUNT_RE = /\ban?\s+(?=years?|months?|weeks?|days?|hours?|minutes?|seconds?)\b/iu
const ENGLISH_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
] as const
const MONETARY_AMOUNT_RE = /(?:(US\$|HK\$|USD|RMB|CNY|HKD|EUR|GBP|JPY|[$￥¥€£])\s*)?(\d+(?:[.,]\d+)*)\s*(trillion|billion|million|thousand|兆|亿|万|千)?\s*(美元|人民币|港元|欧元|英镑|日元|元|yuan|dollars?|euros?|pounds?|yen)?/giu

export type CrossLanguageMonetaryTokenEquivalence = {
  sourceTokens: Set<string>
  translatedTokens: Set<string>
}

export function numericTokens(text: string): string[] {
  const normalized = text
    .replace(/<sup[\s\S]*?<\/sup>/giu, ' ')
    .replace(/\[\d+\](?!:)/gu, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gi, ' ')
    .replace(/^\s*\d+[.)、]\s*/gmu, '')
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(NUMERIC_TOKEN_RE)) {
    const rawNumber = (match[1] ?? '').replace(/,/g, '')
    if (!rawNumber) continue
    const number = normalizeNumber(rawNumber)
    const suffix = normalizeSuffix(match[2] ?? '')
    tokens.add(`${number}${suffix}`)
  }
  for (const match of normalized.matchAll(CHINESE_COUNT_RE)) {
    const number = parseChineseInteger(match[1] ?? '')
    if (number !== undefined) tokens.add(String(number))
  }
  for (const match of normalized.matchAll(ENGLISH_COUNT_RE)) {
    const number = ENGLISH_COUNTS.get((match[1] ?? '').toLowerCase())
    if (number !== undefined) tokens.add(String(number))
  }
  if (ENGLISH_INDEFINITE_TIME_COUNT_RE.test(normalized)) tokens.add('1')
  return [...tokens]
}

export function unsupportedNumericTokens(text: string, supportTexts: string[]): string[] {
  const supportTokens = new Set(supportTexts.flatMap(numericTokens))
  const calendarEquivalentTokens = equivalentCalendarMonthTokens(text, supportTexts)
  return numericTokens(text).filter((token) => (
    !supportTokens.has(token) &&
    !calendarEquivalentTokens.has(token)
  ))
}

/**
 * Only the user-visible translation path may treat mathematically identical
 * monetary forms as equivalent. Generic claim admission intentionally remains
 * strict so a worker cannot silently change the source's units.
 */
export function unsupportedTranslatedNumericTokens(text: string, supportTexts: string[]): string[] {
  const translatedEquivalentTokens = new Set(supportTexts.flatMap((supportText) => (
    [...equivalentCrossLanguageMonetaryTokens(supportText, text).translatedTokens]
  )))
  return unsupportedNumericTokens(text, supportTexts)
    .filter((token) => !translatedEquivalentTokens.has(token))
}

export function equivalentCrossLanguageMonetaryTokens(
  sourceText: string,
  translatedText: string
): CrossLanguageMonetaryTokenEquivalence {
  if (containsCjk(sourceText) === containsCjk(translatedText)) {
    return { sourceTokens: new Set(), translatedTokens: new Set() }
  }
  const sourceAmounts = normalizedMonetaryAmounts(sourceText)
  const translatedAmounts = normalizedMonetaryAmounts(translatedText)
  const sourceKeys = new Set(sourceAmounts.map((amount) => amount.key))
  const translatedKeys = new Set(translatedAmounts.map((amount) => amount.key))
  return {
    sourceTokens: new Set(sourceAmounts
      .filter((amount) => translatedKeys.has(amount.key))
      .flatMap((amount) => amount.tokens)),
    translatedTokens: new Set(translatedAmounts
      .filter((amount) => sourceKeys.has(amount.key))
      .flatMap((amount) => amount.tokens))
  }
}

export function isUserScopeNumericBoundary(
  reportText: string,
  token: string,
  scopeTexts: string[]
): boolean {
  if (!/(?:无法|不能|不足以|未(?:覆盖|提供|量化|验证|说明)|没有(?:覆盖|提供|量化|验证|说明)|证据不足)/u.test(reportText)) {
    return false
  }
  const scopePhrases = scopeTexts.flatMap(extractExplicitQuantityScopePhrases)
  const normalizedReport = normalizeScopePhrase(reportText)
  return scopePhrases.some((phrase) => (
    numericTokens(phrase).includes(token) && normalizedReport.includes(normalizeScopePhrase(phrase))
  ))
}

function extractExplicitQuantityScopePhrases(text: string): string[] {
  const chinese = text.match(/(?:过去|近|最近|未来|前|后)?\s*(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]{1,5})\s*(?:年|个月|月|周|天|日|季度|项|个|种|家|次)/gu) ?? []
  const english = text.match(/\b(?:(?:over\s+the\s+)?(?:past|last|next|future|previous)\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:years?|months?|weeks?|days?|quarters?|items?|options?|companies|times?)\b/giu) ?? []
  return [...new Set([...chinese, ...english].map((phrase) => phrase.trim()).filter(Boolean))]
}

function normalizeScopePhrase(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s，,。.!！?？:：;；"“”'‘’`*_]/gu, '')
}

function equivalentCalendarMonthTokens(text: string, supportTexts: string[]): Set<string> {
  const candidateMonths = new Set([...text.matchAll(/(?<!\d)(1[0-2]|[1-9])\s*月/gu)]
    .map((match) => String(Number(match[1]))))
  if (candidateMonths.size === 0) return candidateMonths
  const support = supportTexts.join('\n').toLowerCase()
  return new Set([...candidateMonths].filter((token) => {
    const month = ENGLISH_MONTHS[Number(token) - 1]
    return month ? new RegExp(`\\b${month}\\b`, 'iu').test(support) : false
  }))
}

type NormalizedMonetaryAmount = {
  key: string
  tokens: string[]
}

function normalizedMonetaryAmounts(text: string): NormalizedMonetaryAmount[] {
  const amounts: NormalizedMonetaryAmount[] = []
  for (const match of text.matchAll(MONETARY_AMOUNT_RE)) {
    const prefix = match[1] ?? ''
    const numberText = (match[2] ?? '').replace(/,/g, '')
    const scale = match[3] ?? ''
    const suffix = match[4] ?? ''
    const currency = normalizedCurrency(prefix, suffix)
    if (!currency || !numberText) continue
    const value = Number(numberText) * monetaryScale(scale)
    if (!Number.isFinite(value)) continue
    amounts.push({
      key: `${currency}:${value.toFixed(6)}`,
      tokens: numericTokens(match[0])
    })
  }
  return amounts
}

function normalizedCurrency(prefix: string, suffix: string): string {
  const value = `${prefix} ${suffix}`.toLowerCase()
  if (/HK\$|HKD|港元/iu.test(value)) return 'HKD'
  if (/US\$|USD|\$|美元|dollars?/iu.test(value)) return 'USD'
  if (/RMB|CNY|￥|¥|人民币|元|yuan/iu.test(value)) return 'CNY'
  if (/EUR|€|欧元|euros?/iu.test(value)) return 'EUR'
  if (/GBP|£|英镑|pounds?/iu.test(value)) return 'GBP'
  if (/JPY|日元|yen/iu.test(value)) return 'JPY'
  return ''
}

function monetaryScale(scale: string): number {
  const scales: Record<string, number> = {
    trillion: 1_000_000_000_000,
    billion: 1_000_000_000,
    million: 1_000_000,
    thousand: 1_000,
    '兆': 1_000_000_000_000,
    '亿': 100_000_000,
    '万': 10_000,
    '千': 1_000
  }
  return scales[scale.toLowerCase()] ?? 1
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}

export type ClaimFaithfulnessAssessment = {
  faithful: boolean
  reasons: string[]
}

export function assessClaimFaithfulness(claimText: string, supportTexts: string[]): ClaimFaithfulnessAssessment {
  const support = supportTexts.join('\n')
  const reasons: string[] = []
  const unsupportedNumbers = unsupportedNumericTokens(claimText, supportTexts)
  if (unsupportedNumbers.length > 0) reasons.push(`unsupported_numbers:${unsupportedNumbers.join(',')}`)
  if (addsSubjectToAnonymousEntityProfile(claimText, supportTexts)) {
    reasons.push('anonymous_entity_subject_not_supported')
  }

  const predicateRules: Array<{ claim: RegExp; support: RegExp; code: string }> = [
    {
      claim: /(?:已采用|已应用|已部署|已建立|已构建|正在使用|\bimplemented\b|\badopted\b|\bdeployed\b|\bbuilt\b)/iu,
      support: /(?:已采用|已应用|已部署|已建立|已构建|正在使用|\bimplemented\b|\badopted\b|\bdeployed\b|\bbuilt\b|\bis used\b|\bhas been used\b)/iu,
      code: 'implementation_not_supported'
    }
  ]
  for (const rule of predicateRules) {
    if (rule.claim.test(claimText) && !rule.support.test(support)) reasons.push(rule.code)
  }

  const applicabilityClaim = /(?:适用于|更适合|更合适|合理选择|理想选择|最佳实践|建议|推荐|优先(?:使用|采用|选择)|\b(?:suitable|appropriate|recommended|best practice)\b)/iu
  const applicabilitySupport = /(?:适用于|适合|合适|可以使用|可采用|建议|推荐|优先|\b(?:suitable|appropriate|recommended|best practice|you can use|can be used)\b)/iu
  if (applicabilityClaim.test(claimText) && !applicabilitySupport.test(support)) {
    reasons.push('applicability_not_supported')
  }

  const absoluteClaim = /(?:始终|从未|所有|必然|唯一|完全|绝对|\balways\b|\bnever\b|\ball\b|\bonly\b)/iu
  if (absoluteClaim.test(claimText) && !absoluteClaim.test(support)) reasons.push('absolute_strength_not_supported')
  if (isExactSupportSubstringCutMidWord(claimText, supportTexts)) reasons.push('claim_boundary_truncated')
  return { faithful: reasons.length === 0, reasons }
}

function addsSubjectToAnonymousEntityProfile(claimText: string, supportTexts: string[]): boolean {
  const normalizedClaim = normalizeFaithfulnessText(claimText)
  return supportTexts.some((supportText) => {
    const normalizedSupport = normalizeFaithfulnessText(supportText)
    if (!isAnonymousEntityProfileStart(normalizedSupport)) return false
    const supportIndex = normalizedClaim.indexOf(normalizedSupport)
    if (supportIndex <= 0) return false
    const prefix = normalizedClaim.slice(0, supportIndex)
      .replace(/^(?:因此|所以|据此|由此|同时|此外|而且|并且|报告显示|资料显示)[，,:：\s]*/u, '')
      .trim()
    return prefix.length >= 2
  })
}

function isAnonymousEntityProfileStart(text: string): boolean {
  return /^(?:一家|一间|一个)[^。！？!?；;]{4,120}[，,]/u.test(text) ||
    /^(?:a|an|one)\s+[^.!?;]{4,120}\b(?:based|founded|located|headquartered|established)\b/iu.test(text)
}

function normalizeFaithfulnessText(text: string): string {
  return text.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function isExactSupportSubstringCutMidWord(claimText: string, supportTexts: string[]): boolean {
  const needle = claimText.replace(/\s+/gu, ' ').trim()
  if (needle.length < 12) return false
  let foundExact = false
  let foundAligned = false
  for (const supportText of supportTexts) {
    const support = supportText.replace(/\s+/gu, ' ')
    let cursor = 0
    while (cursor <= support.length - needle.length) {
      const index = support.indexOf(needle, cursor)
      if (index < 0) break
      foundExact = true
      const before = support[index - 1] ?? ''
      const after = support[index + needle.length] ?? ''
      const startsAligned = !/[A-Za-z0-9]/u.test(before) || !/[A-Za-z0-9]/u.test(needle[0] ?? '')
      const endsAligned = !/[A-Za-z0-9]/u.test(after) || !/[A-Za-z0-9]/u.test(needle.at(-1) ?? '')
      if (startsAligned && endsAligned) foundAligned = true
      cursor = index + 1
    }
  }
  return foundExact && !foundAligned
}

function normalizeNumber(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return String(parsed)
}

function normalizeSuffix(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === '%' || normalized === '％' || normalized === 'percent') return '%'
  if (/^(?:percentage(?:\s+|-)points?|points?|个百分点)$/u.test(normalized)) return 'pt'
  if (normalized === '倍' || normalized === 'x' || normalized === 'time' || normalized === 'times') return 'x'
  return ''
}

function parseChineseInteger(value: string): number | undefined {
  const digits: Record<string, number> = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
  }
  if (!value) return undefined
  if (!/[十百]/u.test(value)) {
    const parsed = [...value].map((char) => digits[char])
    return parsed.some((digit) => digit === undefined) ? undefined : Number(parsed.join(''))
  }
  let total = 0
  let current = 0
  for (const char of value) {
    if (char === '百') {
      total += (current || 1) * 100
      current = 0
    } else if (char === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (digits[char] !== undefined) {
      current = digits[char]
    } else {
      return undefined
    }
  }
  return total + current
}
