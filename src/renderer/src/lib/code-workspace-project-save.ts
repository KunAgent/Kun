import { isConversationWorkspacePath } from './workspace-path'
import {
  saveWorkspaceProject,
  type CodeWorkspaceFolderSet,
  type CodeWorkspaceFolderSetsRegistry,
  type SaveWorkspaceProjectError
} from './code-workspace-folder-sets'

export type CodeProjectSaveDraft = {
  mode: 'create' | 'manage'
  displayName: string
  primary: string
  extraRoots: readonly string[]
}

export type CodeProjectSaveError = SaveWorkspaceProjectError | 'directory-missing' | 'conversation-dir'

export type CodeProjectSaveEnvironment = {
  registry: CodeWorkspaceFolderSetsRegistry
  conversationRoot?: string
  directoryExists: (path: string) => Promise<boolean>
}

export type CodeProjectSaveResult =
  | { ok: true; registry: CodeWorkspaceFolderSetsRegistry; set: CodeWorkspaceFolderSet }
  | { ok: false; error: CodeProjectSaveError; path?: string }

/**
 * Plans a project save against the current registry, then re-verifies every
 * folder on disk before the caller persists it. Nothing is written on error,
 * so the dialog can keep the user's draft intact.
 */
export async function saveCodeWorkspaceProjectDraft(
  draft: CodeProjectSaveDraft,
  environment: CodeProjectSaveEnvironment
): Promise<CodeProjectSaveResult> {
  const planned = saveWorkspaceProject(environment.registry, draft)
  if (planned.error || !planned.set) return { ok: false, error: planned.error ?? 'missing-primary' }

  const folders = [planned.set.primary, ...planned.set.extraRoots]
  for (const folder of folders) {
    if (environment.conversationRoot && isConversationWorkspacePath(folder, environment.conversationRoot)) {
      return { ok: false, error: 'conversation-dir', path: folder }
    }
    if (!(await environment.directoryExists(folder))) {
      return { ok: false, error: 'directory-missing', path: folder }
    }
  }
  return { ok: true, registry: planned.registry, set: planned.set }
}
