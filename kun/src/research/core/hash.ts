/**
 * [INPUT]: 依赖 node:crypto 的 SHA-256 能力
 * [OUTPUT]: 对外提供 hashText、hashJson、stableStringify 和 slugify
 * [POS]: research/core 的稳定标识工具，被 run、source、evidence 和模型请求哈希复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from 'node:crypto'

export function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function hashJson(value: unknown): string {
  return hashText(stableStringify(value))
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'undefined')
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'research'
}
