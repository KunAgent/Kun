export function renderFrontmatter(values: Record<string, string | number | boolean>): string {
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

function formatYamlValue(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
