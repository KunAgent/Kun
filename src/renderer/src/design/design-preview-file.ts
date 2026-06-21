import type {
  WorkspaceFileChangePayload,
  WorkspaceFileReadResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult
} from '@shared/workspace-file'

type DesignPreviewPrepareApi = {
  readWorkspaceFile?: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  writeWorkspaceFile?: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
}

type DesignPreviewWatchApi = {
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
}

export type PrepareDesignPreviewFileResult =
  | { ok: true; source: 'base' | 'skeleton' }
  | { ok: false; message: string }

export type StartDesignHtmlPreviewWatchOptions = {
  api?: DesignPreviewWatchApi
  workspaceRoot: string
  path: string
  onRevision: (revision: number) => void
  onError: (message: string) => void
}

const SKELETON_STYLE = `
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8f5ec;
      color: #263238;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 20% 20%, rgba(37, 99, 235, 0.12), transparent 34%),
        linear-gradient(135deg, #fffaf0 0%, #eef6ff 100%);
    }
    main {
      display: grid;
      gap: 14px;
      place-items: center;
      padding: 32px;
      text-align: center;
    }
    .mark {
      width: 44px;
      height: 44px;
      border-radius: 18px;
      border: 1px solid rgba(37, 99, 235, 0.26);
      background: rgba(255, 255, 255, 0.72);
      box-shadow: 0 18px 48px rgba(31, 41, 55, 0.12);
      display: grid;
      place-items: center;
    }
    .pulse {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #2563eb;
      animation: pulse 1.1s ease-in-out infinite;
    }
    h1 {
      margin: 0;
      font-size: clamp(20px, 4vw, 36px);
      line-height: 1.1;
      font-weight: 760;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      max-width: 460px;
      font-size: 14px;
      line-height: 1.6;
      color: #5f6b7a;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(0.82); opacity: 0.42; }
      50% { transform: scale(1); opacity: 1; }
    }
`

function currentPrepareApi(api?: DesignPreviewPrepareApi): DesignPreviewPrepareApi | undefined {
  return api ?? (typeof window !== 'undefined' ? window.kunGui : undefined)
}

function currentWatchApi(api?: DesignPreviewWatchApi): DesignPreviewWatchApi | undefined {
  return api ?? (typeof window !== 'undefined' ? window.kunGui : undefined)
}

export function buildDesignPreviewSkeleton(relativePath: string): string {
  const safePath = relativePath.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Generating design preview</title>
  <style>${SKELETON_STYLE}
  </style>
</head>
<body>
  <main aria-live="polite">
    <div class="mark" aria-hidden="true"><div class="pulse"></div></div>
    <h1>Generating design...</h1>
    <p>Kun is preparing a live preview for <code>${safePath}</code>. The canvas will refresh as the HTML file changes.</p>
  </main>
</body>
</html>
`
}

export async function prepareDesignPreviewFile(
  workspaceRoot: string,
  relativePath: string,
  basePath?: string,
  api?: DesignPreviewPrepareApi
): Promise<PrepareDesignPreviewFileResult> {
  const resolvedApi = currentPrepareApi(api)
  if (!workspaceRoot.trim()) return { ok: false, message: 'Workspace root is required.' }
  if (!relativePath.trim()) return { ok: false, message: 'Preview path is required.' }
  if (typeof resolvedApi?.writeWorkspaceFile !== 'function') {
    return { ok: false, message: 'writeWorkspaceFile is unavailable.' }
  }

  let source: 'base' | 'skeleton' = 'skeleton'
  let content = buildDesignPreviewSkeleton(relativePath)

  if (basePath && typeof resolvedApi.readWorkspaceFile === 'function') {
    const read = await resolvedApi
      .readWorkspaceFile({ path: basePath, workspaceRoot })
      .catch((error: unknown): WorkspaceFileReadResult => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }))
    if (read.ok && read.content.trim()) {
      content = read.content
      source = 'base'
    }
  }

  const write = await resolvedApi
    .writeWorkspaceFile({ path: relativePath, workspaceRoot, content })
    .catch((error: unknown): WorkspaceFileWriteResult => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }))

  return write.ok ? { ok: true, source } : { ok: false, message: write.message }
}

export function startDesignHtmlPreviewWatch(options: StartDesignHtmlPreviewWatchOptions): () => void {
  const api = currentWatchApi(options.api)
  if (
    !api ||
    typeof api.watchWorkspaceFile !== 'function' ||
    typeof api.unwatchWorkspaceFile !== 'function' ||
    typeof api.onWorkspaceFileChanged !== 'function'
  ) {
    options.onError('Workspace file watching is unavailable.')
    return () => undefined
  }

  let cancelled = false
  let revision = 0
  let watchId = ''

  const unwatch = (id: string): void => {
    void api.unwatchWorkspaceFile(id).catch(() => undefined)
  }

  const bumpRevision = (): void => {
    revision += 1
    options.onRevision(revision)
  }

  const offChanged = api.onWorkspaceFileChanged((payload) => {
    if (!watchId || payload.watchId !== watchId) return
    if (payload.ok) {
      bumpRevision()
      return
    }
    options.onError(payload.message)
  })

  void api
    .watchWorkspaceFile({
      path: options.path,
      workspaceRoot: options.workspaceRoot
    })
    .then((result) => {
      if (cancelled) {
        if (result.ok) unwatch(result.watchId)
        return
      }
      if (!result.ok) {
        options.onError(result.message)
        return
      }
      watchId = result.watchId
      bumpRevision()
    })
    .catch((error: unknown) => {
      if (!cancelled) options.onError(error instanceof Error ? error.message : String(error))
    })

  return () => {
    cancelled = true
    offChanged()
    if (watchId) unwatch(watchId)
  }
}
