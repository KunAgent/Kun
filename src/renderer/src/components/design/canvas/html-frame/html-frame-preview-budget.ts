import { isRunningAppFrame, type CanvasShape } from '../../../../design/canvas/canvas-types'

export const HTML_FRAME_WEBVIEW_BUDGET = 10
export const HTML_FRAME_OVERVIEW_ZOOM = 0.35
export const HTML_FRAME_THUMBNAIL_MAX_EDGE = 768
export const HTML_FRAME_THUMBNAIL_MAX_BYTES = 1024 * 1024

/** Reserve capture slots without increasing the number of native guest renderers. */
export function selectHtmlFramePreviewBudget(
  frames: CanvasShape[],
  priorityIds: ReadonlySet<string>,
  pendingIds: ReadonlySet<string>,
  zoom: number
): { liveIds: Set<string>; captureIds: Set<string> } {
  const ranked = [...frames].reverse().sort((a, b) =>
    Number(priorityIds.has(b.id)) - Number(priorityIds.has(a.id)))
  const overview = zoom < HTML_FRAME_OVERVIEW_ZOOM
  const liveLimit = overview ? HTML_FRAME_WEBVIEW_BUDGET - 2 : HTML_FRAME_WEBVIEW_BUDGET - 1
  const live = ranked.filter((frame) => !overview || priorityIds.has(frame.id) || isRunningAppFrame(frame)).slice(0, liveLimit)
  const liveIds = new Set(live.map((frame) => frame.id))
  const captureLimit = Math.min(overview ? 2 : 1, HTML_FRAME_WEBVIEW_BUDGET - live.length)
  const captureIds = new Set(ranked
    .filter((frame) => pendingIds.has(frame.id) && !liveIds.has(frame.id))
    .slice(0, captureLimit)
    .map((frame) => frame.id))
  return { liveIds, captureIds }
}

/** Session-only, bounded bitmap storage; never write captures into the user's document. */
export class HtmlFrameThumbnailCache {
  private images = new Map<string, string>()
  private bytes = 0

  constructor(private readonly maxBytes = 24 * 1024 * 1024, private readonly maxEntries = 128) {}

  get(key: string): string | undefined { return this.images.get(key) }

  set(key: string, image: string): void {
    if (image.length * 2 > this.maxBytes) return
    this.delete(key)
    this.images.set(key, image)
    this.bytes += image.length * 2
    while (this.bytes > this.maxBytes || this.images.size > this.maxEntries) {
      const oldest = this.images.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
  }

  retain(keys: ReadonlySet<string>): void {
    for (const key of this.images.keys()) if (!keys.has(key)) this.delete(key)
  }

  delete(key: string): void {
    this.bytes -= (this.images.get(key)?.length ?? 0) * 2
    this.images.delete(key)
  }
}
