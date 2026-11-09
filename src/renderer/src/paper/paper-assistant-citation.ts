import { writeJoinPath } from '../write/write-workspace-store-helpers'

/** Accept only a page link into this reader, never an external or sibling PDF. */
export function paperAssistantCitationPage(href: string, workspaceRoot: string, pdfPath: string): number | null {
  const match = /^(.*?)#page=(\d+)$/.exec(href)
  if (!match) return null
  const page = Number(match[2])
  if (!Number.isSafeInteger(page) || page < 1) return null
  let path: string
  try { path = decodeURIComponent(match[1]) } catch { return null }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[/\\]/i.test(path)) return null
  path = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (path.split('/').includes('..')) return null
  const normalizedPdf = pdfPath.replaceAll('\\', '/')
  if (path === normalizedPdf || writeJoinPath(workspaceRoot, path).replaceAll('\\', '/') === normalizedPdf ||
    (!path.includes('/') && path === normalizedPdf.split('/').at(-1))) return page
  return null
}
