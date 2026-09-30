import { afterEach, describe, expect, it, vi } from 'vitest'
const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))
import { KunRuntimeProvider } from '../agent/kun-runtime'
import { installDsGui } from '../agent/kun-runtime-test-support'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { createRefreshThreadsAction } from './chat-store-thread-refresh'
import { useChatStore } from './chat-store'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { buildSidebarWorkspaceGroups } from '../components/chat/sidebar-project-selectors'
import { markThreadWorktree, readThreadWorktreeRegistry, saveThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { resolveProjectWorkspacePath } from '../lib/worktree-project-path'

const project = '/Users/test/projects/source'
// Exact directory layout produced by the isolated desktop smoke profile.
const execution = '/var/folders/yw/smoke/T/kun-ade-desktop-smoke/home/.kun/worktrees/tasks/source-5da2d5fe/tws_owner'
afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.unstubAllGlobals() })

describe('public Code inventory to managed-workspace UI projection', () => {
  it('retains the bound path and source project through the real provider mapper and refresh action', async () => {
    const runtimeRequest = vi.fn(async (_path: string) => ({ ok: true, status: 200, body: JSON.stringify({
      threads: [{ id: 'task', title: 'Done.', workspace: execution, model: 'm', mode: 'agent', status: 'idle',
        providerId: 'source', harnessId: 'kun', taskWorkspaceId: 'tws_owner', workspaceMode: 'code',
        agentSurface: 'code', relation: 'primary', updatedAt: '2026-09-30T00:00:00Z' }],
      workbenchScope: 'code', hasMore: false
    }) }))
    installDsGui({ runtimeRequest })
    const values = new Map<string, string>()
    Object.assign(window, { localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
    saveThreadWorktreeRegistry(markThreadWorktree('task', { projectPath: project, worktreePath: execution, branch: 'task' }))
    registry.getProvider.mockReturnValue(new KunRuntimeProvider())
    let state: ChatState = { ...useChatStore.getState(), runtimeConnection: 'ready', route: 'chat',
      activeThreadId: 'task', workspaceRoot: project, codeWorkspaceRoots: [project], threads: [],
      watchTurnCompletion: {}, unreadThreadIds: {} }
    const set: ChatStoreSet = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
    await createRefreshThreadsAction({ set, get: () => state, sseAbortRef: { current: null } })()
    expect(runtimeRequest.mock.calls[0]?.[0]).toContain('workbench_scope=code')
    expect(state.threads[0]).toMatchObject({ id: 'task', workspace: execution, taskWorkspaceId: 'tws_owner', harnessId: 'kun' })
    expect(state.activeThreadId).toBe('task')
    const groups = buildSidebarWorkspaceGroups({ threads: state.threads, searchQuery: '', showArchived: false,
      workspaceRoot: project, workspaceRoots: state.codeWorkspaceRoots, conversationRoot: '/Users/test/conversations',
      threadWorktrees: readThreadWorktreeRegistry().worktrees })
    expect(groups.find(([path]) => path === project)?.[1].map((thread) => thread.id)).toEqual(['task'])
    expect(resolveProjectWorkspacePath(execution, { threadWorktrees: readThreadWorktreeRegistry().worktrees })).toBe(project)
  })

  it('keeps ordinary OS temporary paths excluded while preserving host-managed task identities', () => {
    expect(normalizeWorkspaceRoot('/var/folders/yw/smoke/T/unrelated')).toBe('')
    expect(normalizeWorkspaceRoot(execution)).toBe(execution)
    expect(normalizeWorkspaceRoot('/tmp/example')).toBe('')
  })
})
