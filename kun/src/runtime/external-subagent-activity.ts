import { clipExternalText } from '../contracts/external-subagent.js'

const TARGET_KEYS = [
  'file_path', 'filePath', 'path', 'file', 'pattern', 'query', 'command', 'cmd', 'url', 'description', 'prompt'
] as const

/**
 * One short "now doing" line for a subagent's tool step: the tool plus the
 * most identifying argument (path, pattern, command or URL). Never output.
 */
export function describeToolActivity(toolName: string, input: unknown): string {
  const name = toolName.replace(/^mcp__[^_]+__/, '').trim() || 'tool'
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  for (const key of TARGET_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      return clipExternalText(`${name} ${value.replace(/\s+/g, ' ')}`, 160) ?? name
    }
  }
  return name
}
