import i18n from '../i18n'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { isConversationWorkspacePath } from '../lib/workspace-path'
import { workspaceDirectoryExists } from '../lib/workspace-availability'
import { withNativeDialog } from '../lib/native-dialog-activity'
import {
  addWorkspaceFolderToRegistry,
  extraRootsForPrimary,
  removeWorkspaceFolderFromRegistry,
  type AddWorkspaceFolderError
} from '../lib/code-workspace-folder-sets'
import { folderSetPrimaryForWorkspace } from '../lib/code-workspace-folder-lookup'
import { workspaceRootIdentityKey } from '../lib/workspace-path'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  commitCodeWorkspaceFolderSets,
  syncThreadAdditionalWorkspaces,
  threadFolderSetPrimary
} from './chat-store-workspace-folder-sync'

function addFolderErrorMessage(error: AddWorkspaceFolderError): string {
  if (error === 'same-as-primary') return i18n.t('common:workspaceFolderSameAsPrimary')
  if (error === 'duplicate') return i18n.t('common:workspaceFolderDuplicate')
  if (error === 'nested') return i18n.t('common:workspaceFolderNested')
  if (error === 'limit') return i18n.t('common:workspaceFolderLimit')
  if (error === 'missing-folder') return i18n.t('common:workspaceFolderMissing')
  return i18n.t('common:workspaceFolderMissingPrimary')
}

export function createWorkspaceFolderActions(
  { set, get }: { set: ChatStoreSet; get: ChatStoreGet }
): Pick<ChatState, 'addWorkspaceFolder' | 'removeWorkspaceFolder'> {
  const syncActiveThread = async (primary: string): Promise<void> => {
    const activeId = get().activeThreadId
    if (!activeId) return
    const thread = get().threads.find((candidate) => candidate.id === activeId)
    if (
      !thread ||
      workspaceRootIdentityKey(threadFolderSetPrimary(thread, get().workspaceRoot)) !==
        workspaceRootIdentityKey(primary)
    ) return
    await syncThreadAdditionalWorkspaces({ set, get, threadId: activeId })
  }

  return {
    addWorkspaceFolder: async (workspacePath) => {
      const primary = folderSetPrimaryForWorkspace(workspacePath || get().workspaceRoot)
      if (!primary) {
        set({ error: i18n.t('common:workspaceFolderMissingPrimary') })
        return false
      }
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        set({ error: i18n.t('common:workspacePickerUnavailable') })
        return false
      }
      try {
        const picked = await withNativeDialog(() =>
          window.kunGui.pickWorkspaceDirectory(primary)
        )
        if (picked.canceled || !picked.path) return false
        if (isConversationWorkspacePath(picked.path, get().conversationWorkspaceRoot)) {
          set({ error: i18n.t('common:workspaceInsideConversationDir') })
          return false
        }
        if (!(await workspaceDirectoryExists(picked.path))) {
          set({ error: i18n.t('common:workspaceDirectoryMissingError') })
          return false
        }
        const added = addWorkspaceFolderToRegistry(primary, picked.path, get().codeWorkspaceFolderSets)
        if (added.error) {
          set({ error: addFolderErrorMessage(added.error) })
          return false
        }
        commitCodeWorkspaceFolderSets(set, added.registry)
        set({ error: null })
        await syncActiveThread(primary)
        return true
      } catch (error) {
        set({ error: formatWorkspacePickerError(error) })
        return false
      }
    },

    removeWorkspaceFolder: async (workspacePath, extraRoot) => {
      const primary = folderSetPrimaryForWorkspace(workspacePath || get().workspaceRoot)
      if (!primary || !extraRoot.trim()) return false
      const current = extraRootsForPrimary(primary, get().codeWorkspaceFolderSets)
      if (!current.length) return false
      const removed = removeWorkspaceFolderFromRegistry(primary, extraRoot, get().codeWorkspaceFolderSets)
      commitCodeWorkspaceFolderSets(set, removed.registry)
      set({ error: null })
      await syncActiveThread(primary)
      return true
    }
  }
}
