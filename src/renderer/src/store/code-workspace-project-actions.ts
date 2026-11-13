import i18n from '../i18n'
import {
  codeWorkspaceProjectFor,
  additionalWorkspacesEqual,
  additionalWorkspacesForThread,
  extraRootsForPrimary,
  MAX_ADDITIONAL_WORKSPACES,
  MAX_CODE_WORKSPACE_FOLDER_SETS,
  MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH
} from '../lib/code-workspace-folder-sets'
import {
  saveCodeWorkspaceProjectDraft,
  type CodeProjectSaveDraft,
  type CodeProjectSaveError
} from '../lib/code-workspace-project-save'
import { workspaceDirectoryExists } from '../lib/workspace-availability'
import { saveCodeWorkspaceRoots } from './chat-store-helpers'
import { rememberRootForRestore } from './chat-store-navigation-workspace-removal'
import { workspaceRootIdentityKey } from '../lib/workspace-path'
import { useChatStore } from './chat-store'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  commitCodeWorkspaceFolderSets,
  syncThreadAdditionalWorkspaces,
  threadFolderSetPrimary
} from './chat-store-workspace-folder-sync'

export type CodeProjectDraftFolderError =
  | 'duplicate'
  | 'same-as-primary'
  | 'nested'
  | 'limit'
  | 'directory-missing'
  | 'conversation-dir'

export function codeProjectErrorMessage(
  error: CodeProjectSaveError | CodeProjectDraftFolderError,
  path?: string
): string {
  switch (error) {
    case 'missing-name':
      return i18n.t('common:codeProjectErrorName')
    case 'invalid-name':
      return i18n.t('common:codeProjectErrorNameLong', { count: MAX_CODE_WORKSPACE_PROJECT_NAME_LENGTH })
    case 'missing-primary':
      return i18n.t('common:codeProjectErrorPrimary')
    case 'duplicate-primary':
      return i18n.t('common:codeProjectErrorDuplicatePrimary')
    case 'duplicate':
      return i18n.t('common:codeProjectErrorDuplicate')
    case 'same-as-primary':
      return i18n.t('common:codeProjectErrorSameAsPrimary')
    case 'nested':
      return i18n.t('common:codeProjectErrorNested')
    case 'limit':
      return i18n.t('common:codeProjectErrorLimit', { count: MAX_ADDITIONAL_WORKSPACES })
    case 'project-limit':
      return i18n.t('common:codeProjectErrorProjectLimit', { count: MAX_CODE_WORKSPACE_FOLDER_SETS })
    case 'conversation-dir':
      return i18n.t('common:codeProjectErrorConversationDir')
    default:
      return i18n.t('common:codeProjectErrorDirectoryMissing', { path: path ?? '' })
  }
}

export type CodeProjectSubmitResult =
  | { ok: true; primary: string; syncBlocked?: string }
  | { ok: false; error: string }

type SubmitDeps = {
  get?: ChatStoreGet
  set?: ChatStoreSet
  directoryExists?: (path: string) => Promise<boolean>
}

/**
 * Saves a create/manage draft. Folder existence is re-checked here so a
 * directory deleted while the dialog was open fails before anything is
 * persisted, and the dialog can keep the user's draft.
 */
export async function submitCodeWorkspaceProjectDraft(
  draft: CodeProjectSaveDraft,
  options: { syncCurrentThread?: boolean } = {},
  deps: SubmitDeps = {}
): Promise<CodeProjectSubmitResult> {
  const get = deps.get ?? useChatStore.getState
  const set = deps.set ?? useChatStore.setState
  const directoryExists = deps.directoryExists ?? workspaceDirectoryExists
  const state = get()
  // Managing a legacy single-folder project creates its missing record; the
  // fixed primary still comes from the draft, so this cannot duplicate one.
  const knownProject = codeWorkspaceProjectFor(state.codeWorkspaceFolderSets, draft.primary)
  const saveDraft: CodeProjectSaveDraft = draft.mode === 'manage' && !knownProject
    ? { ...draft, mode: 'create' }
    : draft
  const result = await saveCodeWorkspaceProjectDraft(saveDraft, {
    registry: state.codeWorkspaceFolderSets,
    conversationRoot: state.conversationWorkspaceRoot,
    directoryExists
  })
  if (!result.ok) return { ok: false, error: codeProjectErrorMessage(result.error, result.path) }

  if (get().codeWorkspaceFolderSets !== state.codeWorkspaceFolderSets) {
    return { ok: false, error: i18n.t('common:codeProjectErrorChanged') }
  }
  commitCodeWorkspaceFolderSets(set, result.registry)
  const primary = result.set.primary
  // Keep the new project visible in the sidebar and pickers even before its
  // first conversation exists, and persist that root across restarts.
  set((state) => {
    const roots = rememberRootForRestore(state.codeWorkspaceRoots, primary)
    saveCodeWorkspaceRoots(roots)
    return { codeWorkspaceRoots: roots }
  })
  const rename = draft.mode === 'manage' &&
    workspaceRootIdentityKey(state.workspaceRoot) === workspaceRootIdentityKey(primary)
  if (rename) set({ workspaceLabel: result.set.displayName ?? '' })

  let syncBlocked: string | undefined
  if (draft.mode === 'manage' && options.syncCurrentThread) {
    const outcome = await syncCodeProjectCurrentThread(primary, { get, set })
    if (outcome === 'busy') syncBlocked = i18n.t('common:codeProjectSyncBusy')
    if (outcome === 'failed') syncBlocked = get().error || i18n.t('common:codeProjectSyncFailed')
  }
  set({ error: syncBlocked ?? null })
  return { ok: true, primary, ...(syncBlocked ? { syncBlocked } : {}) }
}

export type CodeProjectThreadSyncOutcome = 'synced' | 'skipped' | 'busy' | 'failed'

/**
 * Explicit, opt-in sync for the project the active conversation belongs to.
 * Never touches a running turn, another project, or thread settings/history.
 */
export async function syncCodeProjectCurrentThread(
  projectPrimary: string,
  deps: {
    get?: ChatStoreGet
    set?: ChatStoreSet
    syncThread?: (threadId: string) => Promise<boolean>
  } = {}
): Promise<CodeProjectThreadSyncOutcome> {
  const get = deps.get ?? useChatStore.getState
  const set = deps.set ?? useChatStore.setState
  const state: ChatState = get()
  const threadId = state.activeThreadId
  if (!threadId) return 'skipped'
  const thread = state.threads.find((candidate) => candidate.id === threadId) ??
    (state.adeThreads ?? []).find((candidate) => candidate.id === threadId)
  if (!thread) return 'skipped'
  if (
    workspaceRootIdentityKey(threadFolderSetPrimary(thread, state.workspaceRoot)) !==
    workspaceRootIdentityKey(projectPrimary)
  ) return 'skipped'
  if (state.busy || thread.status === 'running') return 'busy'
  const project = codeWorkspaceProjectFor(state.codeWorkspaceFolderSets, projectPrimary)
  if (!project) return 'skipped'
  const extras = additionalWorkspacesForThread(thread.workspace ?? projectPrimary,
    extraRootsForPrimary(projectPrimary, state.codeWorkspaceFolderSets))
  if (additionalWorkspacesEqual(thread.additionalWorkspaces, extras)) return 'skipped'
  const syncThread = deps.syncThread ??
    ((id: string) => syncThreadAdditionalWorkspaces({ set, get, threadId: id }))
  return await syncThread(threadId) ? 'synced' : 'failed'
}
