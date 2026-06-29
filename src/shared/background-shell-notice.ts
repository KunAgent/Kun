export type BackgroundShellCompletionNotice = {
  sessionId: string
  command: string
  exitCode: number
  outputPreview: string
  outputFile?: string
  hint: string
}

function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function readXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  if (!match) return null
  return unescapeXml(match[1].trim())
}

export function parseBackgroundShellCompletionNotice(text: string): BackgroundShellCompletionNotice | null {
  const trimmed = text.trim()
  if (!trimmed.includes('<background_shell_completed>')) return null
  const sessionId = readXmlTag(trimmed, 'session_id')
  const command = readXmlTag(trimmed, 'command')
  const exitCodeRaw = readXmlTag(trimmed, 'exit_code')
  const outputPreview = readXmlTag(trimmed, 'output_preview')
  const outputFile = readXmlTag(trimmed, 'output_file') ?? undefined
  const hint = readXmlTag(trimmed, 'hint')
  if (!sessionId || !command || exitCodeRaw === null || outputPreview === null || !hint) return null
  const exitCode = Number.parseInt(exitCodeRaw, 10)
  if (!Number.isFinite(exitCode)) return null
  return { sessionId, command, exitCode, outputPreview, ...(outputFile ? { outputFile } : {}), hint }
}

export function isBackgroundShellNoticeSource(
  messageSource: unknown
): messageSource is 'background_shell' {
  return messageSource === 'background_shell'
}

export type ClientUserMessageSource = 'background_shell'

/** Client-only hint derived from persisted user_message text, not from server metadata. */
export function inferClientUserMessageSource(text: string): ClientUserMessageSource | undefined {
  return parseBackgroundShellCompletionNotice(text) ? 'background_shell' : undefined
}

export function applyClientUserMessageSourceMeta(
  meta: Record<string, unknown>,
  text: string
): void {
  const messageSource = inferClientUserMessageSource(text)
  if (messageSource) meta.messageSource = messageSource
  else delete meta.messageSource
}

export function isBackgroundShellNoticeUserMessage(input: {
  text: string
  meta?: Record<string, unknown> | null
}): boolean {
  if (isBackgroundShellNoticeSource(input.meta?.messageSource)) return true
  return inferClientUserMessageSource(input.text) === 'background_shell'
}
