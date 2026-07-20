/**
 * [INPUT]: 接收结构化键值和 Markdown 正文
 * [OUTPUT]: 对外提供 renderFrontmatter
 * [POS]: research/markdown 的 YAML frontmatter 轻量渲染工具
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function renderFrontmatter(values: Record<string, string | number | boolean>): string {
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

function formatYamlValue(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
