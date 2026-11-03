import { visit } from 'unist-util-visit'

/** Scheme that carries a workspace/local image reference past the sanitizer. */
export const LOCAL_IMAGE_SCHEME = 'kun-image:'

type HastNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const REMOTE_IMAGE_RE = /^(https?:|blob:|data:)/i

/**
 * Chat markdown may point at images on disk (a generated cover, a chart saved
 * to the workspace). The sanitizer drops every non-http image, so those are
 * wrapped in a private scheme here and loaded through the workspace image
 * bridge by the `img` renderer, which resolves them against the workspace.
 */
export function rehypeLocalImages(): (tree: HastNode) => void {
  return (tree) => {
    visit(tree as never, 'element', (node: HastNode) => {
      if (node.tagName !== 'img' || !node.properties) return
      const src = node.properties.src
      if (typeof src !== 'string' || !src.trim() || REMOTE_IMAGE_RE.test(src.trim())) return
      node.properties.src = `${LOCAL_IMAGE_SCHEME}${encodeURIComponent(src.trim())}`
    })
  }
}

export function localImageSource(src: string | undefined): string | null {
  if (!src?.startsWith(LOCAL_IMAGE_SCHEME)) return null
  try {
    return decodeURIComponent(src.slice(LOCAL_IMAGE_SCHEME.length))
  } catch {
    return null
  }
}
