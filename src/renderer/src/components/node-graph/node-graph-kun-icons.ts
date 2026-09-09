import documentIcon from '../../../../asset/img/document.svg?inline'
import folderIcon from '../../../../asset/img/folder.svg?inline'
import threadIcon from '../../../../asset/img/thread.svg?inline'
import workspaceIcon from '../../../../asset/img/workspace.svg?inline'
import {
  isKunStyledNodeKind,
  KUN_NODE_STYLE_KINDS,
  type KunStyledNodeKind
} from '../../node-graph/kun-node-style'
import type { NodeGraphNodeKind } from '../../node-graph/node-graph-types'

/**
 * Icon sources, shared by the canvas painter and the legend's `<img>` glyphs.
 *
 * Inlined as data URIs rather than emitted as files, because the packaged app
 * loads the renderer from `file://`, where every file is its own opaque origin:
 * drawing a `file://` image taints the canvas, and a tainted canvas makes
 * `toBlob` throw — so Save as PNG would break the moment an icon was painted. A
 * `data:` image has no origin to cross and leaves the export working. Verified
 * in Chromium both ways; the node graph is lazy-loaded, so the bytes only
 * arrive with the view that draws them.
 */
export const KUN_NODE_ICON_SOURCES: Record<KunStyledNodeKind, string> = {
  workspace: workspaceIcon,
  thread: threadIcon,
  folder: folderIcon,
  document: documentIcon
}

const images = new Map<KunStyledNodeKind, HTMLImageElement>()

/**
 * Starts decoding every icon, calling back once each one lands.
 *
 * Idempotent: repeated calls attach the newest callback to whatever is still in
 * flight rather than re-requesting. The callback exists because the canvas
 * paints on demand, not every frame — without it the first Kun-style frame
 * would draw silhouettes and never repaint once the artwork arrived.
 */
export function loadKunNodeIcons(onReady: () => void): void {
  if (typeof Image === 'undefined') return
  for (const kind of KUN_NODE_STYLE_KINDS) {
    const existing = images.get(kind)
    if (existing) {
      if (existing.complete) continue
      existing.addEventListener('load', onReady, { once: true })
      continue
    }
    const image = new Image()
    images.set(kind, image)
    image.addEventListener('load', onReady, { once: true })
    image.src = KUN_NODE_ICON_SOURCES[kind]
  }
}

/**
 * The decoded icon for a kind, or null when there is none, it has not arrived
 * yet, or it failed — in every one of those cases the painter falls back to the
 * silhouette rather than leaving a hole in the graph.
 */
export function kunNodeIcon(kind: NodeGraphNodeKind): CanvasImageSource | null {
  if (!isKunStyledNodeKind(kind)) return null
  const image = images.get(kind)
  if (!image || !image.complete || image.naturalWidth === 0) return null
  return image
}
