import type { AgentProvider } from '../agent/types'
import type { ChatState } from './chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { validateAdeDraftWorkspace, type AdeDraftSendSnapshot } from './chat-store-ade-send-snapshot'

/** Resolve project CAS before a workspace may be allocated for an explicit New action. */
export async function codeThreadWorkspaceIntent(args: {
  state: ChatState
  workspaceRoot: string
  useWorktreePool?: boolean
  worktreeBranch?: string
  provider: AgentProvider
  stillCurrent: () => boolean
}): Promise<{
  isolation: 'local' | 'worktree'
  startFrom?: AdeDraftSendSnapshot['startFrom']
  createFields: Pick<Parameters<AgentProvider['createThread']>[0],
    'routeIntent' | 'projectDefaultsRevision' | 'workspaceIsolation' | 'collaboration'>
} | null> {
  const { state, workspaceRoot } = args
  const displayed = state.composerProjectDefaults?.workspaceRoot === normalizeWorkspaceRoot(workspaceRoot)
    ? state.composerProjectDefaults : undefined
  const loaded = !displayed && typeof window.kunGui?.getAdeProjectDefaults === 'function'
    ? await window.kunGui.getAdeProjectDefaults({ projectPath: workspaceRoot }) : undefined
  if (!args.stillCurrent()) return null
  const project = displayed ?? loaded
  const isolation = args.useWorktreePool !== undefined
    ? args.useWorktreePool ? 'worktree' : 'local'
    : project?.value.isolation === 'worktree' ? 'worktree' : 'local'
  const branch = args.worktreeBranch?.trim()
  const startFrom = isolation === 'worktree'
    ? branch ? { kind: 'branch' as const, name: branch } : { kind: 'current-head' as const }
    : undefined
  if (isolation === 'worktree' && !(await validateAdeDraftWorkspace(workspaceRoot, {
    workspaceRoot, draftOpen: false, draftRevision: 0, isolation, startFrom,
    composer: state
  }, Boolean(args.provider.createTaskWorkspace), args.stillCurrent))) return null
  return {
    isolation, startFrom,
    createFields: {
      workspaceIsolation: isolation,
      ...(!state.activeThreadId && state.workspaceRoot === workspaceRoot &&
        (state.composerCollaborationEnabled || state.composerProjectCollaborationExplicitWorkspaceRoot === workspaceRoot)
        ? { collaboration: { enabled: state.composerCollaborationEnabled } } : {}),
      ...(project ? {
        routeIntent: state.composerRouteExplicitWorkspaceRoot === workspaceRoot ? 'explicit' : 'inherit',
        projectDefaultsRevision: project.revision
      } : {})
    }
  }
}
