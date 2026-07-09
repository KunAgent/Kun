export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
}

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  ext: string
  mtimeMs?: number
  size?: number
}

export type WorkspaceDirectoryTarget = {
  path?: string
  workspaceRoot: string
}

export type WorkspaceFileWritePayload = {
  path: string
  workspaceRoot?: string
  content: string
}

export type WorkspaceFileSaveAsPayload = {
  suggestedName?: string
  sourcePath?: string
  workspaceRoot?: string
  dataBase64?: string
  mimeType?: string
}

export type WorkspaceFileSaveAsResult =
  | {
      ok: true
      path: string
    }
  | {
      ok: false
      canceled?: boolean
      message: string
    }

export type WorkspaceFileCreatePayload = {
  path: string
  workspaceRoot: string
  content?: string
}

export type WorkspaceDirectoryCreatePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceEntryRenamePayload = {
  path: string
  workspaceRoot: string
  newName: string
}

export type WorkspaceEntryDeletePayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceFileWatchPayload = {
  path: string
  workspaceRoot: string
}

export type WorkspaceClipboardImageSavePayload = {
  workspaceRoot: string
  currentFilePath: string
  imageDirectory?: string
}

export type WorkspaceImagePickPayload = {
  workspaceRoot: string
  /** Source file the picker is relative to (so we can return a relative path). */
  currentFilePath?: string
  /** Target directory under the workspace; defaults to `img`. */
  imageDirectory?: string
}

/**
 * Persist raw image bytes (base64-encoded) into the workspace — used by the
 * design-canvas annotation editor to save a flattened PNG (original picture +
 * the user's markup) that the agent then feeds to `generate_image` as a
 * reference. Mirrors the clipboard/picker save flows but takes the bytes
 * directly instead of reading the clipboard or opening a dialog.
 */
export type WorkspaceImageBytesSavePayload = {
  workspaceRoot: string
  /** Base64-encoded image bytes (no `data:` prefix). */
  dataBase64: string
  /** MIME type of the bytes; only `image/png` is currently emitted. */
  mimeType?: string
  /** Target directory under the workspace; defaults to `.deepseekgui-images`. */
  imageDirectory?: string
}

export type WorkspaceImageBytesSaveResult =
  | {
      ok: true
      /** Absolute on-disk path of the saved file. */
      path: string
      /** Path relative to the workspace root, for use as a shape `imageUrl`. */
      workspaceRelativePath: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceImagePickResult =
  | {
      ok: true
      /** Absolute on-disk path of the saved copy. */
      path: string
      /**
       * Path relative to `currentFilePath`'s directory, for use as an HTML `src`.
       * When no `currentFilePath` is provided, this matches `workspaceRelativePath`.
       */
      relativePath: string
      /** Workspace-relative path, for persisted canvas/image references. */
      workspaceRelativePath: string
      width?: number
      height?: number
      createdAt: string
    }
  | { ok: false; canceled?: boolean; message?: string }

export type ClipboardImageReadResult =
  | {
      ok: true
      name: string
      localFilePath: string
      mimeType: string
      dataBase64: string
      byteSize: number
      width?: number
      height?: number
    }
  | { ok: false; message: string }

export type WorkspaceFileReadResult =
  | {
      ok: true
      path: string
      content: string
      size: number
      truncated: boolean
      line?: number
      column?: number
    }
  | { ok: false; message: string }

export type WorkspaceImageReadResult =
  | {
      ok: true
      path: string
      dataUrl: string
      mimeType: string
      size: number
    }
  | { ok: false; message: string }

export type WorkspacePdfReadResult =
  | {
      ok: true
      path: string
      dataBase64: string
      mimeType: 'application/pdf'
      size: number
      mtimeMs: number
    }
  | { ok: false; message: string }

export type LocalPdfTextTarget = {
  path: string
}

export type LocalPdfTextReadResult =
  | {
      ok: true
      path: string
      size: number
      mtimeMs: number
      pageCount: number
      text: string
      hasText: boolean
      ocrApplied?: boolean
      ocrPageCount?: number
      truncated: boolean
    }
  | { ok: false; message: string }

export type WorkspaceFileResolveResult =
  | {
      ok: true
      path: string
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryListResult =
  | {
      ok: true
      root: string
      entries: WorkspaceEntry[]
    }
  | { ok: false; message: string }

export type WorkspaceFileWriteResult =
  | {
      ok: true
      path: string
      savedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceDirectoryCreateResult =
  | {
      ok: true
      path: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryRenameResult =
  | {
      ok: true
      path: string
      previousPath: string
      renamedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceEntryDeleteResult =
  | {
      ok: true
      path: string
      deletedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileWatchResult =
  | {
      ok: true
      watchId: string
      path: string
      content: string
      size: number
      truncated: boolean
      startedAt: string
    }
  | { ok: false; message: string }

export type WorkspaceClipboardImageSaveResult =
  | {
      ok: true
      path: string
      markdownPath: string
      createdAt: string
    }
  | { ok: false; message: string }

export type WorkspaceFileChangePayload =
  | {
      ok: true
      watchId: string
      workspaceRoot: string
      path: string
      content: string
      size: number
      truncated: boolean
      changedAt: string
    }
  | {
      ok: false
      watchId: string
      workspaceRoot: string
      path: string
      message: string
      changedAt: string
    }
