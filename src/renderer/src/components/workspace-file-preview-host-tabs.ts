import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { fileNameFromPath, targetKey } from './workspace-file-preview-support'

/**
 * Open files shown as tabs by the panel that hosts the file preview (the Code
 * right panel), so the preview does not draw a second tab row of its own.
 */
export type FilePreviewHostTab = {
  key: string
  target: WorkspaceFileTarget
  label: string
  title: string
  dirty: boolean
  pinned: boolean
}

export type FilePreviewHostTabs = {
  tabs: FilePreviewHostTab[]
  activeKey: string
}

export type FilePreviewHostTabActions = {
  select: (target: WorkspaceFileTarget) => void
  /** Asks before closing a tab with unsaved edits. */
  requestClose: (target: WorkspaceFileTarget, dirty: boolean) => void
  openMenu?: (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLButtonElement>,
    target: WorkspaceFileTarget
  ) => void
  openInEditor: (target: WorkspaceFileTarget) => void
}

export type FilePreviewHostTabsBridge = {
  publish: (tabs: FilePreviewHostTabs | null) => void
  actionsRef: MutableRefObject<FilePreviewHostTabActions | null>
}

export function buildFilePreviewHostTabs(input: {
  targets: readonly WorkspaceFileTarget[]
  activeKey: string
  dirtyKeys: ReadonlySet<string>
  activeDirty: boolean
  pinnedKeys: ReadonlySet<string>
  workspaceRoot: string
}): FilePreviewHostTabs {
  return {
    activeKey: input.activeKey,
    tabs: input.targets.map((target) => {
      const key = targetKey(target)
      return {
        key,
        target,
        label: fileNameFromPath(target.path),
        title: formatFilePathForDisplay(target.path, target.workspaceRoot ?? input.workspaceRoot) ?? target.path,
        dirty: input.dirtyKeys.has(key) || (key === input.activeKey && input.activeDirty),
        pinned: input.pinnedKeys.has(key)
      }
    })
  }
}

/** Changes whenever what the host draws changes; targets are compared by key. */
export function filePreviewHostTabsSignature(tabs: FilePreviewHostTabs): string {
  return `${tabs.activeKey}\n${tabs.tabs.map((tab) => `${tab.key}|${tab.title}|${tab.dirty ? 1 : 0}|${tab.pinned ? 1 : 0}`).join('\n')}`
}
