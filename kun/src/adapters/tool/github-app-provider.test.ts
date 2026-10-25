import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { fixture as credentials, SCOPE } from '../../github-app/github-app.test-support.js'
import type { GitHubReadMcp } from '../../github-app/mcp.js'
import { buildGitHubAppProvider } from './github-app-provider.js'

async function fixture() {
  const f = await credentials(), threads = new InMemoryThreadStore()
  const thread = createThreadRecord({ id: 'github-task', title: 'GitHub', workspace: '/tmp', model: 'test' })
  thread.turns.push(createTurnRecord({ id: 'turn-1', threadId: thread.id, prompt: 'Read GitHub', status: 'running', clientSurface: 'gui' }))
  await threads.upsert(thread)
  const context: ToolHostContext = { threadId: thread.id, turnId: 'turn-1', activeToolCallId: 'call-1',
    workspace: '/tmp', clientSurface: 'gui', sandboxMode: 'workspace-write', approvalPolicy: 'auto',
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
  const run = vi.fn(async () => ({ content: [{ type: 'text', text: 'reference' }], untrusted: true }))
  const tools = buildGitHubAppProvider(f.service, threads, { run } as unknown as GitHubReadMcp).tools!
  return { ...f, context, threads, run, tool: (name: string) => tools.find((tool) => tool.name === name)! }
}
describe('GitHub App tools', () => {
  it('produces a host-bound card without starting browser authorization or fetching repository data', async () => {
    const f = await fixture()
    try {
      expect(await f.tool('github_connect').execute({ reason: 'Read selected repository' }, f.context)).toMatchObject({
        output: { githubConnection: { threadId: 'github-task', sourceTurnId: 'turn-1', toolCallId: 'call-1', scopeId: SCOPE } }
      })
      expect(f.opened).toEqual([]); expect(f.calls).toEqual([])
    } finally { await f.cleanup() }
  })
  it('enforces conversation grants, native desktop scope and read-only operations before MCP dispatch', async () => {
    const f = await fixture()
    try {
      const read = f.tool('github_read'), args = { name: 'list_issues', arguments: { owner: 'fixture', repo: 'repository' } }
      expect(await read.execute(args, f.context)).toMatchObject({ isError: true })
      await f.seed()
      for (const context of [{ ...f.context, turnId: 'other' }, { ...f.context, blockedProviderIds: ['github-app'] },
        { ...f.context, clientSurface: 'im' as const }, { ...f.context, harnessId: 'external' }]) {
        expect(await read.execute(args, context)).toMatchObject({ isError: true })
      }
      expect(await read.execute({ name: 'create_issue', arguments: {} }, f.context)).toMatchObject({ isError: true })
      expect(f.run).not.toHaveBeenCalled()
      expect(await read.execute(args, f.context)).toMatchObject({ output: { untrusted: true } })
      expect(f.run).toHaveBeenCalledOnce()
      f.run.mockRejectedValueOnce(new Error('Bearer synthetic-secret-error'))
      expect(JSON.stringify(await read.execute(args, f.context))).not.toContain('synthetic-secret-error')
    } finally { await f.cleanup() }
  })
})
