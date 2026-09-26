/**
 * Conservative, deterministic redaction gate for archive episodes. A false
 * positive skips reclamation; a false negative could persist a credential, so
 * this intentionally errs on the side of refusing the episode.
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /\bAuthorization\s*[:=]\s*Basic\s+[A-Za-z0-9+/=]{12,}/iu,
  /\b(?:password|passwd|pwd|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|secret)\s*(?:is|[:=])\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`]{8,})/iu,
  /(?:密码|密钥|令牌)\s*(?:是|为|[:：=])\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`]{8,})/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/u,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
]

export function containsSensitiveConsolidationData(...values: readonly string[]): boolean {
  const text = values.join('\n')
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
}
