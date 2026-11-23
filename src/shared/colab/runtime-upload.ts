export type RuntimeUploadProgress = {
  fileName: string
  fileIndex: number
  fileCount: number
  transferredBytes: number
  totalBytes: number
}

export type RuntimeUploadEvent = RuntimeUploadProgress & { sessionId: string }

export type RuntimeUploadResult =
  | { ok: true; uploadedCount: number }
  | { ok: false; uploadedCount: number; canceled: true }
  | { ok: false; uploadedCount: number; message: string; canceled?: false }
