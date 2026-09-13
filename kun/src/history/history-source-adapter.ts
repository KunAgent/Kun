import { discoverClaudeSessions } from './claude-discovery.js'
export { discoverClaudeSessions } from './claude-discovery.js'
import type { HistorySourceProvider } from '../contracts/history-reference.js'
import { indexCodexFile } from './codex-index.js'
import { indexClaudeFile } from './claude-index.js'
import { discoverCodexSessions } from './codex-discovery.js'
import { projectCodexRecord } from './codex-projection.js'
import { projectClaudeRecord } from './claude-projection.js'

export function historySourceAdapter(provider: HistorySourceProvider) {
  if (provider === 'opencode') throw new Error('OpenCode uses the record-backed source reader, not a JSONL adapter.')
  return provider === 'claude-code'
    ? { index: indexClaudeFile, project: projectClaudeRecord, discover: discoverClaudeSessions }
    : { index: indexCodexFile, project: projectCodexRecord, discover: discoverCodexSessions }
}
