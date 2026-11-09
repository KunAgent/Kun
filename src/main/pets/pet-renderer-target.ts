import path from 'node:path'

export function petRendererTarget(input: {
  appPath: string
  developmentUrl?: string | null
  platform?: NodeJS.Platform
}): { kind: 'file'; path: string } | { kind: 'url'; url: string } {
  if (input.developmentUrl) {
    const target = new URL(input.developmentUrl)
    target.pathname = '/pet-overlay.html'
    target.search = ''
    target.hash = ''
    return { kind: 'url', url: target.toString() }
  }
  // Main modules can live in out/main/chunks. Use the application root rather
  // than the calling chunk's directory, including inside Windows app.asar.
  const paths = (input.platform ?? process.platform) === 'win32' ? path.win32 : path.posix
  return { kind: 'file', path: paths.join(input.appPath, 'out', 'renderer', 'pet-overlay.html') }
}
