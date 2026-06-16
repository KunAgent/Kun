import type {
  WriteEditorSelectionState,
  WriteSelectionPageRect
} from '../components/write/WriteMarkdownEditor'
import type { WriteRetrievalContext, WriteRetrievalSnippet } from '@shared/write-retrieval'

export const WRITE_QUOTE_ORIGINAL_START = '[引用原文]'
export const WRITE_QUOTE_ORIGINAL_END = '[/引用原文]'
export const WRITE_CONTEXT_HEADING = '[写作上下文]'
export const WRITE_QUOTE_HEADING = '[引用片段]'
export const WRITE_RETRIEVAL_HEADING = '[相关文献上下文]'
export const WRITE_RETRIEVAL_END = '[/相关文献上下文]'

const WRITE_ASSISTANT_INTERACTION_RULE =
  '交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。\n' +
  '改稿约定: 当用户要求修改、改写、润色、翻译、续写、扩写或整理“当前文件”所指的文档时，你必须用 edit 或 write 工具把改动直接写入该文件（建议先用 read 取到准确原文，再 edit/write），完成后只用一两句话说明改了什么——绝不要只在回复里贴出修改后的文本却不落盘。用户会在编辑器里以行级红绿 Diff 审阅你的改动、逐行接受或拒绝，所以请放心直接改。仅当用户只是提问、讨论、或处理的是只读引用片段时，才用纯文本回答、不改文件。'

export type WriteQuotedSelection = {
  id: string
  text: string
  sourceKind?: 'text' | 'pdf'
  sourceTitle: string
  sourceFilePath: string
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  rects?: WriteSelectionPageRect[]
  charCount: number
  createdAt: string
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

export function relativeWritePath(workspaceRoot: string, filePath: string): string {
  const root = normalizePath(workspaceRoot)
  const file = normalizePath(filePath)
  const prefix = `${root}/`
  if (root && file.startsWith(prefix)) return file.slice(prefix.length)
  return basenameFromPath(filePath)
}

export function quotedSelectionFromEditor(
  selection: WriteEditorSelectionState,
  filePath: string,
  workspaceRoot: string,
  now = Date.now()
): WriteQuotedSelection | null {
  const text = selection.text.trim()
  if (!text || selection.charCount <= 0) return null
  const first = selection.ranges[0]
  const last = selection.ranges[selection.ranges.length - 1]
  return {
    id: `quote-${now}-${Math.random().toString(36).slice(2)}`,
    text,
    sourceKind: selection.sourceKind === 'pdf' ? 'pdf' : 'text',
    sourceTitle: relativeWritePath(workspaceRoot, filePath),
    sourceFilePath: filePath,
    ...(selection.sourceKind === 'pdf'
      ? {
          pageStart: selection.pageStart ?? first?.page,
          pageEnd: selection.pageEnd ?? last?.page,
          ...(selection.rects?.length ? { rects: selection.rects } : {})
        }
      : {
          ...(first ? { lineStart: first.startLine } : {}),
          ...(last ? { lineEnd: last.endLine } : {})
        }),
    charCount: selection.charCount,
    createdAt: new Date(now).toISOString()
  }
}

export function formatWriteQuotedSelectionForPrompt(selection: WriteQuotedSelection): string {
  if (selection.sourceKind === 'pdf' && selection.pageStart != null && selection.pageEnd != null) {
    const pageLabel = selection.pageStart === selection.pageEnd
      ? `第${selection.pageStart}页`
      : `第${selection.pageStart}-${selection.pageEnd}页`
    return [
      `[引用片段] ${selection.sourceTitle}（${pageLabel}，共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  if (selection.lineStart != null && selection.lineEnd != null) {
    return [
      `[引用片段] ${selection.sourceTitle}（第${selection.lineStart}-${selection.lineEnd}行，共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  return [
    `[引用片段] ${selection.sourceTitle}（共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
    WRITE_QUOTE_ORIGINAL_START,
    selection.text,
    WRITE_QUOTE_ORIGINAL_END
  ].join('\n')
}

type WritePromptContext = {
  workspaceRoot?: string
  activeFilePath?: string | null
  retrieval?: WriteRetrievalContext | null
  /** Active writing-agent persona; folded into the context block so it frames the
   * model without showing as raw text in the user's message bubble. */
  agentPersona?: string
}

export type WritePromptDisplayContext = {
  workspaceRoot?: string
  activeFile?: string
  lines: string[]
}

export type WritePromptDisplayQuote = {
  sourceTitle: string
  sourceFilePath?: string
  sourceKind?: 'text' | 'pdf'
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  charCount?: number
  text: string
}

export type WritePromptDisplayRetrievalSnippet = {
  location: string
  title?: string
  keywords?: string
  text: string
}

export type WritePromptDisplayRetrieval = {
  source?: string
  keywords?: string
  snippets: WritePromptDisplayRetrievalSnippet[]
}

export type WritePromptDisplay = {
  userInput: string
  context: WritePromptDisplayContext | null
  quotes: WritePromptDisplayQuote[]
  retrieval: WritePromptDisplayRetrieval | null
}

function formatWriteRetrievalSnippetLocation(snippet: WriteRetrievalSnippet): string {
  if (snippet.location.kind === 'pdf') {
    const page = snippet.location.pageStart === snippet.location.pageEnd
      ? `第${snippet.location.pageStart}页`
      : `第${snippet.location.pageStart}-${snippet.location.pageEnd}页`
    return `${snippet.path} ${page}`
  }
  return snippet.location.lineStart === snippet.location.lineEnd
    ? `${snippet.path}:${snippet.location.lineStart}`
    : `${snippet.path}:${snippet.location.lineStart}-${snippet.location.lineEnd}`
}

export function formatWriteRetrievalContextForPrompt(retrieval: WriteRetrievalContext | null | undefined): string {
  if (!retrieval?.snippets.length) return ''
  const lines = [
    WRITE_RETRIEVAL_HEADING,
    `检索来源: ${retrieval.source}; 查询关键词: ${retrieval.keywords.join(', ')}`
  ]
  retrieval.snippets.forEach((snippet, index) => {
    lines.push('')
    lines.push(`[${index + 1}] ${formatWriteRetrievalSnippetLocation(snippet)}`)
    if (snippet.title) lines.push(`标题: ${snippet.title}`)
    lines.push(`匹配: ${snippet.keywords.join(', ')}`)
    lines.push(snippet.text)
  })
  // Closing marker keeps the retrieval block unambiguously separable from the
  // user's message so the timeline can collapse it (snippet text may contain
  // blank lines, which would otherwise make the boundary a guess).
  lines.push(WRITE_RETRIEVAL_END)
  return lines.join('\n')
}

export function composeWritePrompt(
  input: string,
  selections: WriteQuotedSelection[],
  context: WritePromptContext = {}
): string {
  const body = input.trim()
  const contextLines: string[] = []
  contextLines.push(WRITE_ASSISTANT_INTERACTION_RULE)
  if (context.agentPersona?.trim()) {
    contextLines.push(`当前写作 Agent 人设（请严格遵循）：${context.agentPersona.trim()}`)
  }
  if (context.workspaceRoot?.trim()) {
    contextLines.push(`工作空间: ${context.workspaceRoot.trim()}`)
  }
  if (context.activeFilePath?.trim()) {
    contextLines.push(`当前文件: ${relativeWritePath(context.workspaceRoot ?? '', context.activeFilePath)}`)
  }
  const contextText = contextLines.length > 0
    ? `[写作上下文]\n${contextLines.join('\n')}`
    : ''
  const quoteText = selections.map(formatWriteQuotedSelectionForPrompt).join('\n\n')
  const retrievalText = formatWriteRetrievalContextForPrompt(context.retrieval)
  return [contextText, quoteText, retrievalText, body].filter(Boolean).join('\n\n')
}

function parseContextBlock(text: string): WritePromptDisplayContext {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  let workspaceRoot: string | undefined
  let activeFile: string | undefined

  for (const line of lines) {
    const workspaceMatch = line.match(/^工作空间:\s*(.+)$/)
    if (workspaceMatch?.[1]) {
      workspaceRoot = workspaceMatch[1].trim()
      continue
    }
    const fileMatch = line.match(/^当前文件:\s*(.+)$/)
    if (fileMatch?.[1]) {
      activeFile = fileMatch[1].trim()
    }
  }

  return {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(activeFile ? { activeFile } : {}),
    lines
  }
}

function splitFirstSection(text: string): { head: string; rest: string } {
  const separator = text.search(/\n{2,}/)
  if (separator < 0) return { head: text.trim(), rest: '' }
  return {
    head: text.slice(0, separator).trim(),
    rest: text.slice(separator).trimStart()
  }
}

function parseQuoteHeader(header: string): Omit<WritePromptDisplayQuote, 'text'> {
  const body = header.replace(WRITE_QUOTE_HEADING, '').trim()
  const pathSplit = body.match(/^(.*?)\s*路径:\s*(.+)$/)
  const titleAndMeta = (pathSplit?.[1] ?? body).trim()
  const sourceFilePath = pathSplit?.[2]?.trim()
  const pdfMetaMatch = titleAndMeta.match(/^(.*?)（第(\d+)(?:[-–—](\d+))?页，共(\d+)字）$/)
  if (pdfMetaMatch) {
    const pageStart = Number.parseInt(pdfMetaMatch[2] ?? '', 10)
    const pageEnd = Number.parseInt(pdfMetaMatch[3] ?? pdfMetaMatch[2] ?? '', 10)
    const charCount = Number.parseInt(pdfMetaMatch[4] ?? '', 10)
    return {
      sourceTitle: (pdfMetaMatch[1] ?? titleAndMeta).trim(),
      sourceKind: 'pdf',
      ...(sourceFilePath ? { sourceFilePath } : {}),
      ...(Number.isFinite(pageStart) ? { pageStart } : {}),
      ...(Number.isFinite(pageEnd) ? { pageEnd } : {}),
      ...(Number.isFinite(charCount) ? { charCount } : {})
    }
  }

  const metaMatch = titleAndMeta.match(/^(.*?)（(?:第(\d+)[-–—](\d+)行，)?共(\d+)字）$/)
  const sourceTitle = (metaMatch?.[1] ?? titleAndMeta).trim()
  const lineStart = metaMatch?.[2] ? Number.parseInt(metaMatch[2], 10) : undefined
  const lineEnd = metaMatch?.[3] ? Number.parseInt(metaMatch[3], 10) : undefined
  const charCount = metaMatch?.[4] ? Number.parseInt(metaMatch[4], 10) : undefined

  return {
    sourceTitle,
    sourceKind: 'text',
    ...(sourceFilePath ? { sourceFilePath } : {}),
    ...(Number.isFinite(lineStart) ? { lineStart } : {}),
    ...(Number.isFinite(lineEnd) ? { lineEnd } : {}),
    ...(Number.isFinite(charCount) ? { charCount } : {})
  }
}

function parseRetrievalBlock(text: string): WritePromptDisplayRetrieval {
  const lines = text.split('\n')
  let source: string | undefined
  let keywords: string | undefined
  const snippets: WritePromptDisplayRetrievalSnippet[] = []
  let current: { location: string; title?: string; keywords?: string; textLines: string[] } | null = null

  const commit = (): void => {
    if (!current) return
    snippets.push({
      location: current.location,
      ...(current.title ? { title: current.title } : {}),
      ...(current.keywords ? { keywords: current.keywords } : {}),
      text: current.textLines.join('\n').trim()
    })
    current = null
  }

  for (const line of lines) {
    const snippetStart = line.match(/^\[(\d+)\]\s+(.+)$/)
    if (snippetStart) {
      commit()
      current = { location: (snippetStart[2] ?? '').trim(), textLines: [] }
      continue
    }
    if (!current) {
      const sourceMatch = line.match(/^检索来源:\s*(.*?)(?:;\s*查询关键词:\s*(.*))?$/)
      if (sourceMatch) {
        source = sourceMatch[1]?.trim() || undefined
        keywords = sourceMatch[2]?.trim() || undefined
      }
      continue
    }
    const beforeBody = current.textLines.every((item) => !item.trim())
    const titleMatch = line.match(/^标题:\s*(.*)$/)
    if (titleMatch && current.title === undefined && beforeBody) {
      current.title = titleMatch[1]?.trim() || undefined
      continue
    }
    const keywordMatch = line.match(/^匹配:\s*(.*)$/)
    if (keywordMatch && current.keywords === undefined && beforeBody) {
      current.keywords = keywordMatch[1]?.trim() || undefined
      continue
    }
    current.textLines.push(line)
  }
  commit()

  return {
    ...(source ? { source } : {}),
    ...(keywords ? { keywords } : {}),
    snippets
  }
}

function consumeQuoteSection(text: string): { quote: WritePromptDisplayQuote | null; rest: string } {
  if (!text.startsWith(WRITE_QUOTE_HEADING)) return { quote: null, rest: text }
  const firstLineEnd = text.indexOf('\n')
  if (firstLineEnd < 0) return { quote: null, rest: text }

  const header = text.slice(0, firstLineEnd).trim()
  let rest = text.slice(firstLineEnd + 1).trimStart()
  if (!rest.startsWith(WRITE_QUOTE_ORIGINAL_START)) {
    return { quote: null, rest: text }
  }

  rest = rest.slice(WRITE_QUOTE_ORIGINAL_START.length).trimStart()
  const originalEnd = rest.indexOf(WRITE_QUOTE_ORIGINAL_END)
  if (originalEnd < 0) return { quote: null, rest: text }

  const quotedText = rest.slice(0, originalEnd).trim()
  const afterQuote = rest.slice(originalEnd + WRITE_QUOTE_ORIGINAL_END.length).trimStart()
  return {
    quote: {
      ...parseQuoteHeader(header),
      text: quotedText
    },
    rest: afterQuote
  }
}

export function parseWritePromptForDisplay(text: string): WritePromptDisplay | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (
    !normalized.includes(WRITE_CONTEXT_HEADING) &&
    !normalized.includes(WRITE_QUOTE_HEADING) &&
    !normalized.includes(WRITE_RETRIEVAL_HEADING)
  ) {
    return null
  }

  let rest = normalized
  let context: WritePromptDisplayContext | null = null
  const quotes: WritePromptDisplayQuote[] = []

  if (rest.startsWith(WRITE_CONTEXT_HEADING)) {
    rest = rest.slice(WRITE_CONTEXT_HEADING.length).trimStart()
    const contextSection = splitFirstSection(rest)
    context = parseContextBlock(contextSection.head)
    rest = contextSection.rest
  }

  while (rest.startsWith(WRITE_QUOTE_HEADING)) {
    const consumed = consumeQuoteSection(rest)
    if (!consumed.quote) break
    quotes.push(consumed.quote)
    rest = consumed.rest
  }

  let retrieval: WritePromptDisplayRetrieval | null = null
  if (rest.startsWith(WRITE_RETRIEVAL_HEADING)) {
    const endIndex = rest.indexOf(WRITE_RETRIEVAL_END)
    if (endIndex >= 0) {
      retrieval = parseRetrievalBlock(rest.slice(WRITE_RETRIEVAL_HEADING.length, endIndex))
      rest = rest.slice(endIndex + WRITE_RETRIEVAL_END.length).trimStart()
    }
  }

  if (!context && quotes.length === 0 && !retrieval) return null

  return {
    userInput: rest.trim(),
    context,
    quotes,
    retrieval
  }
}
