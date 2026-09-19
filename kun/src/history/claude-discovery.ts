import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CodexSessionSummary } from '../contracts/history-reference.js'
import type { discoverCodexSessions } from './codex-discovery.js'
import { object, readCodexLines, string } from './codex-jsonl.js'
import { isClaudeInput } from './claude-projection.js'

type DiscoveryOptions = Parameters<typeof discoverCodexSessions>[0] & { claudeHome?: string }
const summaries = new Map<string, { signature: string; session: CodexSessionSummary }>()

/** List discovery retains small summaries, never transcript graphs or message bodies. */
async function summarize(path: string): Promise<CodexSessionSummary | undefined> {
  const info = await stat(path, { bigint: true })
  const signature = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
  const cached = summaries.get(path)
  if (cached?.signature === signature) return { ...cached.session }
  let customTitle = '', aiTitle = '', firstPrompt = ''
  const session: CodexSessionSummary = { path, sessionId: '', title: '', workspace: '', updatedAt: '', archived: false }
  let hasMain = false
  for await (const line of readCodexLines(path)) {
    const r = line.value
    if (line.malformed || r.isSidechain === true) continue
    session.sessionId ||= string(r.sessionId)
    if (r.type === 'custom-title') customTitle = string(r.customTitle).slice(0, 120)
    if (r.type === 'ai-title') aiTitle = string(r.aiTitle).slice(0, 120)
    if (!['user', 'assistant'].includes(string(r.type))) continue
    hasMain = true
    session.workspace = string(r.cwd) || session.workspace
    session.updatedAt = string(r.timestamp) || session.updatedAt
    if (!firstPrompt && isClaudeInput(r)) {
      const content = object(r.message).content
      firstPrompt = (typeof content === 'string' ? content : Array.isArray(content)
        ? content.map((part) => string(object(part).text)).join(' ') : '').replace(/\s+/gu, ' ').slice(0, 120)
    }
  }
  if (!hasMain || !session.sessionId) return undefined
  session.title = customTitle || aiTitle || firstPrompt || 'Claude Code conversation'
  session.updatedAt ||= new Date(Number(info.mtimeMs)).toISOString()
  summaries.delete(path); summaries.set(path, { signature, session })
  while (summaries.size > 500) summaries.delete(summaries.keys().next().value!)
  return { ...session }
}

export async function discoverClaudeSessions(options: DiscoveryOptions = {}): Promise<CodexSessionSummary[]> {
  const root = join(resolve(options.claudeHome || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')), 'projects')
  const sessions: CodexSessionSummary[] = []
  let projects
  try { projects = await readdir(root, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const directory = join(root, project.name)
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !/\.jsonl(?:\.zst)?$/iu.test(entry.name) || entry.name.startsWith('agent-')) continue
      try {
        const session = await summarize(join(directory, entry.name))
        if (!session) continue
        if (options.cwd && (!session.workspace || resolve(session.workspace) !== resolve(options.cwd))) continue
        if (options.query && !`${session.title} ${session.sessionId} ${session.workspace}`.toLocaleLowerCase().includes(options.query.toLocaleLowerCase())) continue
        if (options.after && Date.parse(session.updatedAt) < Date.parse(options.after)) continue
        if (options.before && Date.parse(session.updatedAt) > Date.parse(options.before)) continue
        sessions.push(session)
      } catch { /* An unreadable source cannot prevent discovery of other sessions. */ }
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(200, options.limit ?? 100))
}
