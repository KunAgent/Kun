export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
}

export type WorkspaceFileRevealTarget = WorkspaceFileTarget & {
  workspaceRoot: string
}

export const WORKSPACE_TEXT_ENCODINGS = [
  'utf-8',
  'gb18030',
  'big5',
  'shift_jis',
  'utf-16le',
  'utf-16be',
  'windows-1252'
] as const

export type WorkspaceTextEncoding = (typeof WORKSPACE_TEXT_ENCODINGS)[number]

/** First read of a text preview. Larger reads are an explicit "load more". */
export const WORKSPACE_TEXT_PREVIEW_HEAD_BYTES = 1_500_000
export const WORKSPACE_TEXT_PREVIEW_MAX_BYTES = 16 * 1024 * 1024

export type WorkspaceFileReadPayload = WorkspaceFileTarget & {
  /** Reopen with this encoding instead of detecting one. */
  encoding?: WorkspaceTextEncoding
  /** Bytes to read from the start, capped at WORKSPACE_TEXT_PREVIEW_MAX_BYTES. */
  maxBytes?: number
}

export type WorkspaceFileReadFailureCode = 'binary' | 'not_found' | 'directory'

/** Every file under a workspace, as relative forward-slash paths, for quick search. */
export type WorkspaceFileListResult =
  | { ok: true; root: string; files: string[]; truncated: boolean }
  | { ok: false; message: string }

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
  expectedMtimeMs?: number
  force?: boolean
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
  /**
   * Content watches return a text/image preview payload. Signal watches only
   * report stable file metadata, which keeps binary Office files out of IPC.
   */
  mode?: WorkspaceFileWatchMode
}

export type WorkspaceFileWatchMode = 'content' | 'signal'

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
  /** MIME type of the bytes; supports PNG and SVG image exports. */
  mimeType?: string
  /** Target directory under the workspace; defaults to `.kun/images`. */
  imageDirectory?: string
  /** Optional exact PNG/SVG basename for deterministic renderer-backed exports. */
  fileName?: string
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

export type ClipboardImageWritePayload = {
  path?: string
  workspaceRoot?: string
  dataBase64?: string
  mimeType?: string
}

export type ClipboardImageWriteResult =
  | { ok: true }
  | { ok: false; message: string }

export type WorkspaceFileReadResult =
  | {
      ok: true
      path: string
      content: string
      size: number
      mtimeMs?: number
      truncated: boolean
      line?: number
      column?: number
      /** Detected (or forced) encoding; absent from older producers, which read UTF-8. */
      encoding?: WorkspaceTextEncoding
      /** Bytes decoded into `content`. */
      bytesRead?: number
    }
  | {
      ok: false
      message: string
      code?: WorkspaceFileReadFailureCode
      path?: string
      size?: number
      mtimeMs?: number
      /** First 4 KB of a binary file, for a read-only hex view. */
      headBase64?: string
    }

export type WorkspaceImageReadResult =
  | {
      ok: true
      path: string
      dataUrl: string
      mimeType: string
      size: number
      /** The source format cannot be shown by Chromium and was converted to PNG. */
      convertedFrom?: string
    }
  | { ok: false; message: string; code?: 'not_found' | 'too_large' | 'unsupported' }

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

export type WorkspaceFileOpenResult =
  | { ok: true }
  | { ok: false; message: string }

export type WorkspacePreviewLeaseTarget = {
  path: string
  workspaceRoot: string
}

export type WorkspacePreviewLeaseResult =
  | {
      ok: true
      leaseId: string
      url: string
      mimeType: string
      size: number
      mtimeMs: number
      expiresAt: string
    }
  | { ok: false; message: string }

export type WorkspacePreviewLeaseReleasePayload = {
  leaseId: string
}

export type WorkspacePreviewLeaseReleaseResult =
  | { ok: true }
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
      mtimeMs?: number
    }
  | {
      ok: false
      code?: 'modified_on_disk'
      message: string
      mtimeMs?: number
    }

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
      /** Omitted at runtime for legacy content watches. */
      mode?: 'content'
      watchId: string
      path: string
      content: string
      size: number
      truncated: boolean
      startedAt: string
    }
  | {
      ok: true
      /** No file bytes are read or transferred for signal watches. */
      mode: 'signal'
      watchId: string
      path: string
      /** Kept empty so existing content-watch callers remain source-compatible. */
      content: ''
      size: number
      mtimeMs: number
      truncated: false
      startedAt: string
    }
  | { ok: false; message: string; mode?: WorkspaceFileWatchMode }

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
      /** Omitted at runtime for legacy content watches. */
      mode?: 'content'
      watchId: string
      workspaceRoot: string
      path: string
      content: string
      size: number
      truncated: boolean
      changedAt: string
    }
  | {
      ok: true
      /** No file bytes are read or transferred for signal watches. */
      mode: 'signal'
      watchId: string
      workspaceRoot: string
      path: string
      /** Kept empty so existing content-watch callers remain source-compatible. */
      content: ''
      size: number
      mtimeMs: number
      truncated: false
      changedAt: string
    }
  | {
      ok: false
      mode?: WorkspaceFileWatchMode
      watchId: string
      workspaceRoot: string
      path: string
      message: string
      changedAt: string
    }
