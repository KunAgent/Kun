export type RendererCommandLine = {
  appendSwitch: (switchName: string, value?: string) => void
}

export type RendererCacheSession = {
  clearCache: () => Promise<void>
}

export type ReloadableRendererContents = {
  reload: () => void
  reloadIgnoringCache: () => void
}

export function hasDevelopmentRenderer(
  rendererUrl: string | undefined = process.env.ELECTRON_RENDERER_URL
): boolean {
  return Boolean(rendererUrl?.trim())
}

export function configureDevelopmentRendererHttpCache(
  commandLine: RendererCommandLine,
  rendererUrl: string | undefined = process.env.ELECTRON_RENDERER_URL
): boolean {
  if (!hasDevelopmentRenderer(rendererUrl)) return false
  commandLine.appendSwitch('disable-http-cache')
  return true
}

export async function clearDevelopmentRendererHttpCache(
  cacheSession: RendererCacheSession,
  rendererUrl: string | undefined = process.env.ELECTRON_RENDERER_URL
): Promise<boolean> {
  if (!hasDevelopmentRenderer(rendererUrl)) return false
  await cacheSession.clearCache()
  return true
}

export function reloadRenderer(
  contents: ReloadableRendererContents,
  rendererUrl: string | undefined = process.env.ELECTRON_RENDERER_URL
): void {
  if (hasDevelopmentRenderer(rendererUrl)) {
    contents.reloadIgnoringCache()
    return
  }
  contents.reload()
}
