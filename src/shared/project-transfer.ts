export type ProjectTransferResult =
  | {
      ok: true
      path: string
      copiedFiles: number
      copiedBytes: number
      skippedPaths: string[]
    }
  | {
      ok: false
      canceled?: boolean
      message: string
    }
