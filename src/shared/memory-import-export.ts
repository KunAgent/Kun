import { z } from 'zod'

export const MEMORY_IMPORT_PROFILE_PROMPT = `请帮我整理一份我的个人使用画像，用途是让我在不同 AI 工具之间保持一致的协作体验。请基于你当前能访问到的、与我相关的长期信息和本次会话上下文进行整理。在涉及我的指令和偏好时，请尽量保留我原本的表述方式，不要过度改写。

分类（按以下顺序输出）
指令：我明确要求遵循的规则，包括语气、格式、风格、"始终做 X"、"绝不做 Y" 以及对助手行为的纠正。仅整理可从长期记忆中明确识别并客观存在的规则，不临时新增、不强加、不脑补未明确提出的要求。

身份：姓名、年龄、所在地、教育背景、家庭、人际关系、语言能力和个人兴趣（仅包含我主动分享过的非敏感信息，不输出证件号、联系方式、账号等隐私数据）。

职业：当前和过往的职位、公司以及主要技能领域。

项目：我实际参与构建或投入精力的项目。每个项目一条。包含项目功能、当前状态以及关键决策。以项目名称或简短描述作为条目开头。

偏好：广泛适用的观点、品味和工作风格偏好。

格式
使用分类标题作为每个类别的节标题。每个类别内，每行一条记录，按日期从早到晚排列。每行格式：

[YYYY-MM-DD] - 条目内容

如果日期未知，使用 [unknown] 代替。

输出
将整个画像包裹在一个代码块中，方便我复制。
代码块之后，简要说明：这是否已覆盖你当前能整理出的全部相关信息；若还有未纳入的维度或你不确定的条目，请列出来，由我判断是否补充。`

export const MEMORY_PROFILE_CATEGORIES = ['指令', '身份', '职业', '项目', '偏好'] as const
export type MemoryProfileCategory = typeof MEMORY_PROFILE_CATEGORIES[number]

const CATEGORY_SET = new Set<string>(MEMORY_PROFILE_CATEGORIES)
const CATEGORY_TAGS: Record<MemoryProfileCategory | '其他', string> = {
  指令: 'instruction',
  身份: 'identity',
  职业: 'career',
  项目: 'project',
  偏好: 'preference',
  其他: 'other'
}

export type MemoryImportEntry = {
  date: string
  category: MemoryProfileCategory | '其他'
  content: string
  tags: string[]
}

const MemoryPortableSourceSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['user', 'tool', 'inference', 'file', 'web', 'imported', 'legacy']),
  threadId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional(),
  itemId: z.string().min(1).max(256).optional(),
  locator: z.string().min(1).max(1_024).optional(),
  excerpt: z.string().min(1).max(512).optional(),
  contentHash: z.string().min(1).max(128).optional(),
  trust: z.enum(['explicit-user', 'observed', 'inferred', 'imported', 'legacy'])
}).strict()

const MemoryPortableRecordSchema = z.object({
  schemaVersion: z.literal(2),
  content: z.string().min(1),
  scope: z.enum(['user', 'workspace', 'project']),
  workspace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  type: z.enum(['fact', 'preference', 'decision', 'episode', 'relationship', 'insight']),
  authority: z.literal('reference'),
  importance: z.number().min(0).max(1),
  observedAt: z.string().datetime(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  sources: z.array(MemoryPortableSourceSchema).max(8),
  disabled: z.boolean()
}).strict().superRefine((record, context) => {
  if (record.validFrom && record.validTo && Date.parse(record.validFrom) > Date.parse(record.validTo)) {
    context.addIssue({ code: 'custom', path: ['validTo'], message: 'validFrom must not be after validTo' })
  }
  const sourceIds = new Set<string>()
  for (let index = 0; index < record.sources.length; index += 1) {
    const id = record.sources[index].id
    if (sourceIds.has(id)) {
      context.addIssue({ code: 'custom', path: ['sources', index, 'id'], message: 'source ids must be unique' })
    }
    sourceIds.add(id)
  }
})

const MemoryPortableArchiveSchema = z.object({
  format: z.literal('kun-memory-v2'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  records: z.array(MemoryPortableRecordSchema)
}).strict()

export type MemoryPortableRecord = z.infer<typeof MemoryPortableRecordSchema>
export type MemoryImportParseResult =
  | { kind: 'portable'; records: MemoryPortableRecord[] }
  | { kind: 'profile'; entries: MemoryImportEntry[] }
  | { kind: 'invalid-portable'; message: string }

export type MemoryExportRecord = {
  schemaVersion?: 2
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  tags?: string[]
  confidence?: number
  type?: 'fact' | 'preference' | 'decision' | 'episode' | 'relationship' | 'insight'
  authority?: 'reference'
  importance?: number
  observedAt?: string
  validFrom?: string
  validTo?: string
  expiresAt?: string
  sources?: Array<{
    id: string
    kind: 'user' | 'tool' | 'inference' | 'file' | 'web' | 'imported' | 'legacy'
    threadId?: string
    turnId?: string
    itemId?: string
    locator?: string
    excerpt?: string
    contentHash?: string
    trust: 'explicit-user' | 'observed' | 'inferred' | 'imported' | 'legacy'
  }>
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type MemoryMarkdownExportPayload = {
  records: MemoryExportRecord[]
  exportedAt?: string
}

export type MemoryMarkdownExportSavePayload = {
  markdown: string
  defaultFileName?: string
}

export type MemoryMarkdownExportSaveResult =
  | { ok: true; path: string; exportedAt: string }
  | { ok: false; canceled: true; message?: string }
  | { ok: false; canceled: false; message: string }

const IMPORT_LINE_PATTERN = /^\[([0-9]{4}-[0-9]{2}-[0-9]{2}|unknown)\]\s*[-－]\s*(.+)$/
const CODE_BLOCK_PATTERN = /```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/m
const PORTABLE_CODE_BLOCK_PATTERN = /```kun-memory-v2\s*\r?\n([\s\S]*?)```/im
const PORTABLE_CODE_BLOCK_MARKER_PATTERN = /```kun-memory-[^\s`]*/i

export function extractMemoryImportText(raw: string): string {
  const match = CODE_BLOCK_PATTERN.exec(raw)
  return (match?.[1] ?? raw).trim()
}

export function parseMemoryProfileImport(raw: string): MemoryImportEntry[] {
  const source = extractMemoryImportText(raw)
  const entries: MemoryImportEntry[] = []
  let category: MemoryImportEntry['category'] = '其他'

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const heading = normalizeCategoryHeading(trimmed)
    if (heading) {
      category = heading
      continue
    }

    const match = IMPORT_LINE_PATTERN.exec(trimmed)
    if (!match) continue

    const content = match[2].trim()
    if (!content) continue

    entries.push({
      date: match[1],
      category,
      content,
      tags: ['imported', category, CATEGORY_TAGS[category]]
    })
  }

  return entries
}

export function parseMemoryImport(raw: string): MemoryImportParseResult {
  const portableBlock = PORTABLE_CODE_BLOCK_PATTERN.exec(raw)
  if (portableBlock) {
    try {
      const parsed = MemoryPortableArchiveSchema.safeParse(JSON.parse(portableBlock[1]))
      if (parsed.success) return { kind: 'portable', records: parsed.data.records }
      return { kind: 'invalid-portable', message: 'Invalid kun-memory-v2 archive.' }
    } catch {
      return { kind: 'invalid-portable', message: 'Invalid kun-memory-v2 archive.' }
    }
  }
  if (PORTABLE_CODE_BLOCK_MARKER_PATTERN.test(raw)) {
    return { kind: 'invalid-portable', message: 'Unsupported Kun memory archive version.' }
  }
  return { kind: 'profile', entries: parseMemoryProfileImport(raw) }
}

export function buildMemoryImportContent(entry: MemoryImportEntry): string {
  return `[${entry.date}] ${entry.category}: ${entry.content}`
}

export function memoryImportObservedAt(date: string): string | undefined {
  if (date === 'unknown') return undefined
  const candidate = `${date}T00:00:00.000Z`
  const parsed = new Date(candidate)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? parsed.toISOString()
    : undefined
}

export function defaultMemoryExportFileName(now = new Date()): string {
  return `kun-memory-export-${now.toISOString().slice(0, 10)}.md`
}

export function buildMemoryMarkdownExport({ records, exportedAt = new Date().toISOString() }: MemoryMarkdownExportPayload): string {
  const activeRecords = records.filter((record) => !record.deletedAt)
  const grouped = groupRecordsByCategory(activeRecords)
  const lines = [
    '# Kun 记忆导出',
    '',
    `导出时间: ${exportedAt}`,
    `记录数量: ${activeRecords.length}`,
    ''
  ]

  for (const category of [...MEMORY_PROFILE_CATEGORIES, '其他'] as const) {
    lines.push(`## ${category}`)
    const group = grouped[category]
    if (group.length === 0) {
      lines.push('')
      continue
    }
    for (const record of group) {
      lines.push(formatExportRecord(record))
    }
    lines.push('')
  }

  const archive = MemoryPortableArchiveSchema.parse({
    format: 'kun-memory-v2',
    version: 1,
    exportedAt,
    records: activeRecords.map(toPortableRecord)
  })
  lines.push('## Kun Memory V2', '', '```kun-memory-v2', JSON.stringify(archive, null, 2), '```', '')

  return `${lines.join('\n').trimEnd()}\n`
}

function toPortableRecord(record: MemoryExportRecord): MemoryPortableRecord {
  return MemoryPortableRecordSchema.parse({
    schemaVersion: 2,
    content: record.content,
    scope: record.scope,
    ...(record.workspace ? { workspace: record.workspace } : {}),
    ...(record.project ? { project: record.project } : {}),
    tags: record.tags ?? [],
    confidence: record.confidence ?? 1,
    type: record.type ?? inferPortableType(record),
    authority: 'reference',
    importance: record.importance ?? 0.5,
    observedAt: record.observedAt ?? record.updatedAt ?? record.createdAt,
    ...(record.validFrom ? { validFrom: record.validFrom } : {}),
    ...(record.validTo ? { validTo: record.validTo } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    sources: record.sources ?? [],
    disabled: Boolean(record.disabledAt)
  })
}

function inferPortableType(record: MemoryExportRecord): MemoryPortableRecord['type'] {
  const tags = new Set((record.tags ?? []).map((tag) => tag.trim().toLowerCase()))
  if (tags.has('preference') || tags.has('preferences') || tags.has('偏好')) return 'preference'
  if (tags.has('decision') || tags.has('决定')) return 'decision'
  if (tags.has('episode') || tags.has('经历')) return 'episode'
  if (tags.has('relationship') || tags.has('关系')) return 'relationship'
  if (tags.has('insight') || tags.has('洞察')) return 'insight'
  return 'fact'
}

function normalizeCategoryHeading(value: string): MemoryImportEntry['category'] | null {
  const normalized = value
    .replace(/^#{1,6}\s*/, '')
    .replace(/[:：]\s*.*$/, '')
    .trim()
  if (!CATEGORY_SET.has(normalized)) return null
  return normalized as MemoryProfileCategory
}

function groupRecordsByCategory(records: MemoryExportRecord[]): Record<MemoryProfileCategory | '其他', MemoryExportRecord[]> {
  const grouped: Record<MemoryProfileCategory | '其他', MemoryExportRecord[]> = {
    指令: [],
    身份: [],
    职业: [],
    项目: [],
    偏好: [],
    其他: []
  }
  for (const record of records) {
    grouped[inferRecordCategory(record)].push(record)
  }
  for (const group of Object.values(grouped)) {
    group.sort((a, b) => recordDateForSort(a).localeCompare(recordDateForSort(b)))
  }
  return grouped
}

function inferRecordCategory(record: MemoryExportRecord): MemoryProfileCategory | '其他' {
  const tags = (record.tags ?? []).map((tag) => tag.toLowerCase())
  if (tags.includes('指令') || tags.includes('instruction') || tags.includes('instructions')) return '指令'
  if (tags.includes('身份') || tags.includes('identity') || tags.includes('profile')) return '身份'
  if (tags.includes('职业') || tags.includes('career') || tags.includes('work')) return '职业'
  if (tags.includes('项目') || tags.includes('project')) return '项目'
  if (tags.includes('偏好') || tags.includes('preference') || tags.includes('preferences')) return '偏好'

  const content = record.content
  if (/^(指令|身份|职业|项目|偏好)[:：]/.test(content)) {
    return content.slice(0, 2) as MemoryProfileCategory
  }
  return '其他'
}

function formatExportRecord(record: MemoryExportRecord): string {
  const imported = importedContentParts(record.content)
  const date = imported?.date ?? record.createdAt?.slice(0, 10) ?? 'unknown'
  const disabled = record.disabledAt ? ' [disabled]' : ''
  const scope = record.scope !== 'user' ? ` (${record.scope}${record.project || record.workspace ? `: ${record.project ?? record.workspace}` : ''})` : ''
  return `[${date}] - ${imported?.content ?? record.content.trim()}${disabled}${scope}`
}

function importedContentParts(content: string): { date: string; content: string } | null {
  const match = /^\[([0-9]{4}-[0-9]{2}-[0-9]{2}|unknown)\]\s+(指令|身份|职业|项目|偏好|其他)[:：]\s*(.+)$/s.exec(content.trim())
  if (!match) return null
  return {
    date: match[1],
    content: match[3].trim()
  }
}

function recordDateForSort(record: MemoryExportRecord): string {
  const date = importedContentParts(record.content)?.date ?? record.createdAt?.slice(0, 10)
  return date && date !== 'unknown' ? date : '9999-99-99'
}
