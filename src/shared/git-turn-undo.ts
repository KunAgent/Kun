/**
 * Per-turn file undo. Instead of resetting the whole workspace to a Git
 * checkpoint, undo restores only the files Kun's file tools changed in a turn
 * (or a range of turns), and only when each file still matches the content the
 * turn left behind. Anything else is reported and nothing is written.
 */

/** One file the turn range changed through Kun's file tools. */
export type GitTurnUndoFileInput = {
  /** Absolute path as reported by the tool (repository-relative is accepted too). */
  path: string
  /**
   * sha256 (hex) of the file right after the last Kun write in the range.
   * `null` when the runtime did not record it (older turns, external agents).
   */
  afterSha256: string | null
}

export type GitTurnUndoTarget = {
  /** Checkpoint taken before the first turn of the range. */
  checkpointId: string
  expectedThreadId?: string
  expectedWorkspaceRoot?: string
}

export type GitTurnUndoPreflightRequest = GitTurnUndoTarget & {
  files: GitTurnUndoFileInput[]
  /**
   * True when the range ran shell commands. Main then lists other files that
   * changed since the checkpoint as ignored (Kun cannot attribute them).
   */
  shellCommandsRan?: boolean
  /** Checkpoint of the turn after the range; bounds shell-change attribution. */
  windowEndCheckpointId?: string
}

export type GitTurnUndoRequest = GitTurnUndoPreflightRequest & {
  /** `turn` for the card's Undo, `rewind` for edit-message resets. */
  scope?: 'turn' | 'rewind'
}

export type GitTurnUndoUnsafeReason =
  /** The file changed after the turn ended (by the user or a later turn). */
  | 'modified_after_turn'
  /** The checkpoint was removed by retention or the storage quota. */
  | 'checkpoint_missing'
  /** The file was too large to be stored in the checkpoint snapshot. */
  | 'not_in_snapshot'
  /** Git ignores the file, so the checkpoint never covered it. */
  | 'gitignored'
  /** The path resolves outside the checkpoint's repository. */
  | 'outside_workspace'
  /** The current file or its checkpoint copy could not be read. */
  | 'unreadable'

export type GitTurnUndoIgnoredReason =
  /** The file already matches its pre-turn content. */
  | 'no_net_change'
  /** Changed outside Kun's file tools (shell command or manual edit). */
  | 'shell_changed'
  /**
   * The tool recorded no end state (older turns, external agents, generated
   * files), so undo cannot verify the file and leaves it as is.
   */
  | 'end_state_unknown'

export type GitTurnUndoSafeFile = {
  path: string
  /** `restore` writes the pre-turn content; `delete` removes a file the turn created. */
  action: 'restore' | 'delete'
}

export type GitTurnUndoUnsafeFile = {
  path: string
  reason: GitTurnUndoUnsafeReason
  detail?: string
}

export type GitTurnUndoIgnoredFile = {
  path: string
  reason: GitTurnUndoIgnoredReason
}

/** Paths are repository-relative with `/` separators unless outside the repository. */
export type GitTurnUndoPreflight = {
  checkpointId: string
  repositoryRoot: string | null
  safe: GitTurnUndoSafeFile[]
  unsafe: GitTurnUndoUnsafeFile[]
  ignored: GitTurnUndoIgnoredFile[]
  /** Shell-changed files beyond the listed cap. */
  ignoredOverflow: number
  /** True only when at least one file is safe and none is unsafe. */
  canUndo: boolean
}

export type GitTurnUndoFailureReason =
  | 'no_workspace'
  | 'not_git_repo'
  | 'git_unavailable'
  | 'busy'
  | 'error'

export type GitTurnUndoPreflightResult =
  | { ok: true; preflight: GitTurnUndoPreflight }
  | { ok: false; reason: GitTurnUndoFailureReason; message: string }

export type GitTurnUndoResult =
  | {
      ok: true
      undoId: string
      restored: string[]
      deleted: string[]
      preflight: GitTurnUndoPreflight
    }
  | { ok: false; reason: 'unsafe' | 'nothing_to_undo'; message: string; preflight: GitTurnUndoPreflight }
  | { ok: false; reason: GitTurnUndoFailureReason; message: string }

export type GitTurnReapplyRequest = GitTurnUndoTarget & { undoId: string }

export type GitTurnReapplyConflict = {
  path: string
  reason: 'modified_after_undo' | 'snapshot_missing' | 'unreadable'
}

export type GitTurnReapplyResult =
  | { ok: true; restored: string[]; deleted: string[] }
  | { ok: false; reason: 'unsafe'; message: string; conflicts: GitTurnReapplyConflict[] }
  | { ok: false; reason: 'not_found' | GitTurnUndoFailureReason; message: string }

export type GitTurnUndoStatusRequest = { checkpointId: string }

export type GitTurnUndoStatus =
  | { state: 'none' }
  | { state: 'undone'; undoId: string; undoneAt: string; fileCount: number }

export type KunGuiGitTurnUndoApi = {
  preflightTurnUndo: (params: GitTurnUndoPreflightRequest) => Promise<GitTurnUndoPreflightResult>
  undoTurnFiles: (params: GitTurnUndoRequest) => Promise<GitTurnUndoResult>
  reapplyTurnFiles: (params: GitTurnReapplyRequest) => Promise<GitTurnReapplyResult>
  getTurnUndoStatus: (params: GitTurnUndoStatusRequest) => Promise<GitTurnUndoStatus>
}
