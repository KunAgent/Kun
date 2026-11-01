import type { Dispatch, FormEvent, ReactElement, SetStateAction } from 'react'
import {
  MoveThreadDialog,
  SidebarActionDialog,
  SidebarFolderDialog,
  type MoveThreadDialogState,
  type SidebarActionDialogState,
  type SidebarFolderDialogState
} from './SidebarProjectOverlays'
import {
  worktreeRecordForSidebarThread,
  type SidebarThreadWorktrees
} from './sidebar-project-selectors'

type Props = {
  folderDialog: SidebarFolderDialogState | null
  setFolderDialog: Dispatch<SetStateAction<SidebarFolderDialogState | null>>
  submitFolderDialog: (event: FormEvent<HTMLFormElement>) => void
  moveThreadDialog: MoveThreadDialogState | null
  closeMoveThreadDialog: () => void
  confirmThreadWorkspaceMove: (
    thread: MoveThreadDialogState['thread'],
    workspacePath: string,
    record?: ReturnType<typeof worktreeRecordForSidebarThread>
  ) => void
  submitMoveThreadDialog: () => Promise<void>
  actionDialog: SidebarActionDialogState | null
  closeActionDialog: () => void
  submitActionDialog: () => Promise<void>
  threadWorktrees: SidebarThreadWorktrees
  t: (k: string, opts?: Record<string, unknown>) => string
}

/** Folder/move/action dialogs owned by the projects sidebar. */
export function SidebarProjectsDialogs({
  folderDialog,
  setFolderDialog,
  submitFolderDialog,
  moveThreadDialog,
  closeMoveThreadDialog,
  confirmThreadWorkspaceMove,
  submitMoveThreadDialog,
  actionDialog,
  closeActionDialog,
  submitActionDialog,
  threadWorktrees,
  t
}: Props): ReactElement {
  return <>
    {folderDialog ? (
      <SidebarFolderDialog
        state={folderDialog}
        onClose={() => setFolderDialog(null)}
        onValueChange={(value) =>
          setFolderDialog((current) => current ? { ...current, value, error: '' } : current)
        }
        onSubmit={submitFolderDialog}
        t={t}
      />
    ) : null}

    {moveThreadDialog ? (
      <MoveThreadDialog
        state={moveThreadDialog}
        onClose={closeMoveThreadDialog}
        onPickTarget={(targetWorkspace) =>
          confirmThreadWorkspaceMove(
            moveThreadDialog.thread,
            targetWorkspace,
            worktreeRecordForSidebarThread(moveThreadDialog.thread, threadWorktrees)
          )
        }
        onConfirm={submitMoveThreadDialog}
        t={t}
      />
    ) : null}

    {actionDialog ? (
      <SidebarActionDialog
        state={actionDialog}
        onClose={closeActionDialog}
        onConfirm={() => void submitActionDialog()}
        t={t}
      />
    ) : null}
  </>
}
