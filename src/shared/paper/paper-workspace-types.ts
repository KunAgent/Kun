/** Desktop-owned bootstrap; no renderer-provided path is ever created. */
export type PaperWorkspaceEnsureResult =
  | {
      ok: true
      workspaceRoot: string
      defaultWorkspaceRoot: string
      /** True only when this call created the managed default directory. */
      created: boolean
      libraries: string[]
      activeLibrary: string
    }
  | {
      ok: false
      code: 'missing-root' | 'invalid-root' | 'permission-denied' | 'unconfigured' | 'library-limit' | 'io'
      message: string
      workspaceRoot?: string
      defaultWorkspaceRoot: string
    }
