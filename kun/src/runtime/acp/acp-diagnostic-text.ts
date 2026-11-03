import { redactApprovalSensitiveText } from '../../domain/approval.js'
import { stripTerminalEscapes } from '../../session/harness-process.js'

/** Redact before truncating: cutting a token first can defeat credential matching. */
export function acpDiagnosticText(text: string, maxLength = 1_024): string {
  const jsonRedacted = stripTerminalEscapes(text).replace(
    /(["'][\w.-]*(?:key|token|password|secret|authorization|cookie)[\w.-]*["']\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/gi,
    '$1"[redacted]"'
  )
  return redactApprovalSensitiveText(jsonRedacted)
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, maxLength)
}
