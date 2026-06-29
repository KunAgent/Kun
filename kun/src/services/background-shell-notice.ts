import type { BackgroundShellRecord } from '../contracts/background-shell.js'

export type BackgroundShellCompletionNotice = {
  sessionId: string
  command: string
  exitCode: number
  outputPreview: string
  hint: string
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function summarizeOutput(output: string, max = 400): string {
  const trimmed = output.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function readXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  if (!match) return null
  return unescapeXml(match[1].trim())
}

export function formatBackgroundShellCompletionNotice(record: BackgroundShellRecord): string {
  const sessionId = record.id
  const outputPreview = summarizeOutput(record.output) || '(empty)'
  const hint = record.outputFilePath
    ? `Full output is saved at ${record.outputFilePath}. Use background_shell action="read" with session_id="${sessionId}" for a fresh summary.`
    : `Use background_shell action="read" with session_id="${sessionId}" to inspect the full output.`
  const lines = [
    '<background_shell_completed>',
    `<session_id>${escapeXml(sessionId)}</session_id>`,
    `<command>${escapeXml(record.command)}</command>`,
    `<exit_code>${record.exitCode ?? 0}</exit_code>`,
    `<output_preview>${escapeXml(outputPreview)}</output_preview>`,
    ...(record.outputFilePath ? [`<output_file>${escapeXml(record.outputFilePath)}</output_file>`] : []),
    `<hint>${escapeXml(hint)}</hint>`,
    '</background_shell_completed>'
  ]
  return lines.join('\n')
}

export function parseBackgroundShellCompletionNotice(text: string): BackgroundShellCompletionNotice | null {
  const trimmed = text.trim()
  if (!trimmed.includes('<background_shell_completed>')) return null
  const sessionId = readXmlTag(trimmed, 'session_id')
  const command = readXmlTag(trimmed, 'command')
  const exitCodeRaw = readXmlTag(trimmed, 'exit_code')
  const outputPreview = readXmlTag(trimmed, 'output_preview')
  const hint = readXmlTag(trimmed, 'hint')
  if (!sessionId || !command || exitCodeRaw === null || outputPreview === null || !hint) return null
  const exitCode = Number.parseInt(exitCodeRaw, 10)
  if (!Number.isFinite(exitCode)) return null
  return { sessionId, command, exitCode, outputPreview, hint }
}

export function backgroundShellNoticeDisplayText(sessionId: string): string {
  return `Background shell ${sessionId} completed`
}
