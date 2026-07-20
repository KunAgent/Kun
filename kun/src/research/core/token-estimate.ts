/**
 * [INPUT]: 依赖模型请求的 system/user 文本和最大输出 token
 * [OUTPUT]: 对外提供 estimateResearchRequestTokens，用保守估算支持并发前预算预留
 * [POS]: research/core 的成本估算工具，只用于硬预算预留，不替代 provider 返回的真实 usage
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export function estimateResearchRequestTokens(text: string, maxOutputTokens: number): number {
  const cjkChars = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length
  const otherChars = Math.max(0, text.length - cjkChars)
  const estimatedInput = Math.ceil(cjkChars / 1.4 + otherChars / 3.5)
  return Math.max(1, estimatedInput + Math.max(0, Math.floor(maxOutputTokens)))
}
