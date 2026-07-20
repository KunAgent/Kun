/**
 * [INPUT]: 依赖用户原题/澄清文本和可选显式对比对象
 * [OUTPUT]: 对外提供标签式/枚举式/括号示例显式对手列表和带时间/范围修饰语的命名实体对提取，支持混合文字对比后缀，并提供忽略书写空格与标点的对比对象证据匹配、对比判定、抽象维度排除、由实体自身写法派生的别名归一化，以及从多对象标签式材料中投影出用户指定对象段落的通用清理
 * [POS]: research/core 的领域中立对比语义解析器，只把用户明确命名的对象归一化到 Frame.alternativesToCompare，不维护国家、行业或技术主题词典
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const COMPARISON_SIGNAL_RE = /对比|比较|区别|差异|异同|哪个|哪家|谁更|相比|区分|\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b|\bdifference\b/iu
const LATIN_ENTITY = String.raw`[A-Za-z0-9][A-Za-z0-9+#.&:_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+#.&:_-]*){0,3}`
const LATIN_PAIR_RE = new RegExp(`(${LATIN_ENTITY})\\s*(?:和|与|及|\\bvs\\.?\\b|\\bversus\\b)\\s*(${LATIN_ENTITY})`, 'giu')
const QUOTED_PAIR_RE = /[「“"]([^」”"\n]{1,40})[」”"]\s*(?:和|与|及|\/|\bvs\.?\b|\bversus\b)\s*[「“"]([^」”"\n]{1,40})[」”"]/giu
const DIRECT_PAIR_RE = /(?:对比|比较)\s+([\p{L}\p{N}+#.&:_/ -]{2,40}?)\s+(?:和|与|及|\bvs\.?\b|\bversus\b)\s+([\p{L}\p{N}+#.&:_/ -]{2,40}?)(?=\s*(?:在|的|之间|相比|对比|比较|区别|差异|异同|哪个|哪家|谁|更|用于|重点|[，。！？?；;\n]|$))/giu
const HAN_PAIR_RE = /([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9+#.&:_-]{0,15})\s*(?:和|与|\bvs\.?\b|\bversus\b)\s*([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9+#.&:_-]{0,15})(?=\s*(?:在|的|之间|相比|对比|比较|区别|差异|异同|哪个|哪家|谁|更|[，。！？?；;\n]|$))/giu
const ENUMERATED_OPPONENTS_RE = /(?:^|[，。！？?；;\n]|需要|需|重点|并|同时)\s*(?:与|和)\s*([^。！？?；;\n]{2,80}?)等(?:主要)?(?:对手|国家|地区|对象)[^。！？?；;\n]{0,30}(?:对比|比较)/giu
const NAMED_OPPONENTS_RE = /(?:^|[，。！？?；;\n]|需要|需|重点|并|同时)\s*(?:与|和)\s*([^。！？?；;\n]{2,80}?)(?:主要)?对手(?:及全球整体水平)?(?:进行)?(?:对比|比较)/giu
const ENUMERATED_COMPARISON_RE = /(?:^|[，。！？?；;\n]|需要|需|重点|并|同时)\s*(?:与|和)\s*([^。！？?；;\n]{2,80}?)(?=(?:进行)?(?:对比|比较))/giu
const LABELED_COMPARISON_RE = /(?:比较|对比)对象[：:]\s*([^。！？?；;\n]{2,80})/giu
const PARENTHETICAL_OPPONENT_EXAMPLES_RE = /(?:与|和)\s*[^。！？?；;\n（）()]{0,40}?(?:主要)?对手\s*[（(](?:如|例如)?\s*([^）)\n]{2,80})[）)]/giu

const SUFFIX_COMPARISON_PAIR_RE = /([\p{L}\p{N}+#.&:_/ -]{2,40}?)\s*(?:和|与|及|\bvs\.?\b|\bversus\b)\s*([\p{L}\p{N}+#.&:_/ -]{2,40}?)(?=\s*(?:之间)?的?\s*(?:对比|比较|区别|差异|异同))/giu

export function extractComparisonTargets(text: string, explicit: string[] = []): string[] {
  const explicitTargets = uniqueTargets(explicit.map(cleanComparisonTarget).filter(Boolean))
  if (explicitTargets.length >= 2) return explicitTargets.slice(0, 5)
  const comparisonText = stripContextPhrases(stripAudiencePhrases(stripNegatedComparisonPhrases(text)))
  if (!COMPARISON_SIGNAL_RE.test(comparisonText)) return explicitTargets

  const enumerated = extractEnumeratedOpponents(comparisonText)
  if (enumerated.length >= 2) return uniqueTargets([...explicitTargets, ...enumerated]).slice(0, 5)

  const extracted: string[] = []
  for (const pattern of [QUOTED_PAIR_RE, DIRECT_PAIR_RE, SUFFIX_COMPARISON_PAIR_RE, LATIN_PAIR_RE, HAN_PAIR_RE]) {
    pattern.lastIndex = 0
    for (const match of comparisonText.matchAll(pattern)) {
      if (pattern !== DIRECT_PAIR_RE && pattern !== SUFFIX_COMPARISON_PAIR_RE && !hasNearbyComparisonSignal(comparisonText, match.index ?? 0, match[0]?.length ?? 0)) {
        continue
      }
      const left = cleanComparisonTarget(match[1] ?? '')
      const right = cleanComparisonTarget(match[2] ?? '')
      if (!isPlausibleComparisonTarget(left) || !isPlausibleComparisonTarget(right)) continue
      extracted.push(left, right)
      if (uniqueTargets(extracted).length >= 2) return uniqueTargets([...explicitTargets, ...extracted]).slice(0, 5)
    }
  }
  return explicitTargets.slice(0, 5)
}

function extractEnumeratedOpponents(text: string): string[] {
  for (const pattern of [PARENTHETICAL_OPPONENT_EXAMPLES_RE, LABELED_COMPARISON_RE, ENUMERATED_OPPONENTS_RE, NAMED_OPPONENTS_RE, ENUMERATED_COMPARISON_RE]) {
    const targets: string[] = []
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const values = (match[1] ?? '').split(/[、，,]|\s*(?:与|和|及)\s*/u)
      for (const value of values) {
        const target = cleanComparisonTarget(value.replace(/(?:等)?(?:主要)?(?:对手|国家|地区|对象).*$/u, ''))
        if (/^全球(?:整体)?(?:水平)?$/u.test(target)) continue
        if (isPlausibleComparisonTarget(target)) {
          targets.push(target)
        }
      }
    }
    if (uniqueTargets(targets).length >= 2) return uniqueTargets(targets)
  }
  return []
}

function stripNegatedComparisonPhrases(text: string): string {
  return text
    .replace(
      /(?:不|无需|无须|不用|不必|并非|不是为了)\s*(?:做|进行)?\s*(?:比较|对比|区分)[^，。！？?；;\n]{0,50}/gu,
      ' '
    )
    .replace(
      /(?:竞争对手|覆盖范围)[：:]\s*[^。！？?；;\n]{2,120}?(?:全部|均|都)(?:需要|需)?覆盖/gu,
      ' '
    )
    .replace(
      /不把[^。！？?；;\n]{0,80}?(?:当成|视为)(?:独立)?(?:比较|对比)对象/gu,
      ' '
    )
}

function stripAudiencePhrases(text: string): string {
  return text
    .replace(/(?:面向|受众(?:为|是|包括)?|读者(?:为|是|包括)?|供)\s*[^，。！？?；;\n]{1,80}(?=[，。！？?；;\n]|$)/gu, ' ')
    .replace(/\b(?:for|targeting)\s+(?:developers?|architects?|readers?|audiences?|users?|executives?|managers?)(?:\s*(?:,|and|or|&)\s*(?:developers?|architects?|readers?|audiences?|users?|executives?|managers?))*\b[^.!?;\n]{0,40}(?=[.!?;\n]|$)/giu, ' ')
}

function stripContextPhrases(text: string): string {
  return text.replace(/(?:包含|涵盖|覆盖)\s*[^，。！？?；;\n]{1,80}?(?:使用|应用|业务|技术|典型)?场景/gu, ' ')
}

function hasNearbyComparisonSignal(text: string, index: number, matchLength: number): boolean {
  const before = text.slice(Math.max(0, index - 36), index)
  const pair = text.slice(index, index + matchLength)
  const after = text.slice(index + matchLength, Math.min(text.length, index + matchLength + 20))
  return /(?:对比|比较)[^。！？?；;\n]{0,24}$/u.test(before)
    || COMPARISON_SIGNAL_RE.test(pair)
    || /^\s*(?:之间)?(?:的)?\s*(?:对比|比较|区别|差异|异同|哪个|哪家|谁更)/u.test(after)
}

export function isComparisonText(text: string, explicit: string[] = []): boolean {
  return COMPARISON_SIGNAL_RE.test(text) && extractComparisonTargets(text, explicit).length >= 2
}

export function comparisonTargetAliases(target: string): string[] {
  const normalized = target.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) return []
  const parenthetical = [...normalized.matchAll(/([^()（）]{1,60})\s*[（(]([^()（）]{1,60})[）)]/gu)]
    .flatMap((match) => [match[1]?.trim(), match[2]?.trim()])
    .filter((value): value is string => Boolean(value))
  const slashVariants = normalized.includes('/')
    ? normalized.split('/').map((value) => value.trim()).filter(Boolean)
    : []
  const latinWords = normalized.match(/[A-Za-z][A-Za-z0-9+#.&_-]*/g) ?? []
  const acronym = latinWords.length >= 2 && latinWords.length <= 6
    ? latinWords.map((word) => word[0]).join('').toUpperCase()
    : ''
  return uniqueTargets([
    normalized,
    normalized.replace(/[\s.:_-]+/g, ''),
    ...parenthetical,
    ...slashVariants,
    acronym
  ])
}

export function comparisonTargetMatchesText(target: string, text: string): boolean {
  const normalizedText = normalizeComparisonMatchText(text)
  if (!normalizedText) return false
  return comparisonTargetAliases(target).some((alias) => {
    const normalizedAlias = normalizeComparisonMatchText(alias)
    return normalizedAlias.length >= 2 && normalizedText.includes(normalizedAlias)
  })
}

export function projectComparisonEvidenceText(text: string, allowedTargets: string[]): string {
  if (allowedTargets.length < 2 || !text.trim()) return text
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) ?? [text]
  const labels = sentences.map((sentence) => sentence.match(/^\s*([^：:\n]{1,24})\s*[：:]/u)?.[1]?.trim())
  const allowedLabelKeys = new Set(labels
    .filter((label): label is string => Boolean(label))
    .flatMap((label) => allowedTargets
      .filter((target) => comparisonTargetMatchesText(target, label))
      .map((target) => normalizeComparisonMatchText(target))))
  // Only treat labels as peer objects when at least two user-requested objects
  // are explicitly present. This avoids deleting ordinary labels such as
  // "risk:" or "method:" in non-enumerated prose.
  if (allowedLabelKeys.size < 2) return text

  let keepActiveLabel = true
  const kept: string[] = []
  for (const [index, sentence] of sentences.entries()) {
    const label = labels[index]
    if (label) {
      keepActiveLabel = allowedTargets.some((target) => comparisonTargetMatchesText(target, label))
    }
    if (keepActiveLabel) kept.push(sentence.trim())
  }
  return kept.join(' ').replace(/\s+([，。；：！？,.!?:;])/gu, '$1').trim()
}

function normalizeComparisonMatchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.&]+/gu, '')
}

function cleanComparisonTarget(value: string): string {
  const cleaned = value
    .replace(/[「」“”"']/g, '')
    .replace(/^(?:请|帮我|帮忙|研究|调研|调查|分析|解释|说明|判断|评估|讨论|比较|对比|区分|了解|围绕)\s*/u, '')
    .replace(/^(?:过去|最近|近)\s*(?:\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:年|季度|月|周|天)\s*/u, '')
    .replace(/\s+(?:在|的|之间|相比|对比|比较|区别|差异|异同|哪个|哪家|谁|更)\b.*$/u, '')
    .replace(/[，。！？?；;：:、]+$/u, '')
    .replace(/(?:哪个|哪家|谁|更).*/u, '')
    .replace(/(?:之间|相比|对比|比较|区别|差异|异同|哪个|哪家|谁|更)$/u, '')
    .replace(/(?:全部|均|都)(?:需要|需)?覆盖$/u, '')
    .replace(/(?:进行)?分析$/u, '')
    .replace(/的(?:区别|差异|异同|关系|边界)?$/u, '')
    .replace(/^(.{2,30})的[^的]{2,12}$/u, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const latinPrefix = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9+#.&:/_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+#.&:/_-]*){0,4})\s+[\p{Script=Han}]/u)?.[1]
  return latinPrefix && latinPrefix.length >= 2 ? latinPrefix : cleaned
}

function isPlausibleComparisonTarget(value: string): boolean {
  if (value.length < 2 || value.length > 40) return false
  if (/^[a-z][a-z-]*$/.test(value)) return false
  if (/^(?:强|弱|高|低|新|旧|内|外|前|后|正|反)[\p{Script=Han}]{2,20}$/u.test(value)) return false
  if (/(?:策略|机制|方法|流程|模式|场景|维度|字段|属性|指标)$/u.test(value)) return false
  if (/(?:场景|适用性|实践|中|下)的?(?:差异|区别|异同|适用性)?$/u.test(value)) return false
  if (/^(?:全球|全球水平|全球整体水平|行为|场景|影响|区别|差异|异同|方面|维度|体系|系统|生态|结构|模式|优势|风险|结论|建议|指标|实体标签)$/u.test(value)) return false
  if (/(?:行为|场景(?:中|下|内)?|影响|区别|差异|异同|方面|维度|体系|系统|生态|结构|模式|差距|优势|风险|结论|建议|启示|口径|机制|表现|领域|证据|判断|问题|事实|信息|数据|材料|职责|排名|基准|分析|覆盖|背景下|条件下|情况下|维度上|层面上|代表案例)$/u.test(value)) return false
  if (/^(?:什么|如何|怎么|是否|有哪些|为什么|本质|适用|不把|并|以及|同时|最能|需要|先|再|按|提供|从|以)/u.test(value)) return false
  if (/^(?:面向|受众|读者|用户)$/u.test(value)) return false
  return true
}

function uniqueTargets(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}
