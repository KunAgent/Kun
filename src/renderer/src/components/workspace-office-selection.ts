import type {
  OfficeDocumentPreviewFormat,
  WorkspaceOfficeSelection
} from '@shared/office-document'

type OfficeDomLocation = { page?: number; slide?: number }

function anchorRect(range: Range): WorkspaceOfficeSelection['anchorRect'] {
  const maybeRange = range as Range & {
    getClientRects?: () => DOMRectList
    getBoundingClientRect?: () => DOMRect
  }
  const rects = typeof maybeRange.getClientRects === 'function'
    ? Array.from(maybeRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
    : []
  const rect = rects[rects.length - 1] ?? (
    typeof maybeRange.getBoundingClientRect === 'function'
      ? maybeRange.getBoundingClientRect()
      : undefined
  )
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

export function emptyWorkspaceOfficeSelection(
  sourceKind: 'word' | 'presentation' | 'spreadsheet',
  sourceFormat: OfficeDocumentPreviewFormat
): WorkspaceOfficeSelection {
  return { sourceKind, sourceFormat, text: '', charCount: 0 }
}

export function selectionFromOfficeDom(
  root: HTMLElement,
  sourceKind: 'word' | 'presentation',
  sourceFormat: OfficeDocumentPreviewFormat,
  locate: (node: Node | null) => OfficeDomLocation
): WorkspaceOfficeSelection {
  const selection = window.getSelection()
  const empty = emptyWorkspaceOfficeSelection(sourceKind, sourceFormat)
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return empty
  if (
    !selection.anchorNode || !selection.focusNode ||
    !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)
  ) return empty
  const text = selection.toString().trim()
  if (!text) return empty
  const anchorLocation = locate(selection.anchorNode)
  const focusLocation = locate(selection.focusNode)
  const pages = [anchorLocation.page, focusLocation.page].filter((value): value is number => value != null)
  return {
    sourceKind,
    sourceFormat,
    text,
    charCount: Array.from(text).length,
    anchorRect: anchorRect(selection.getRangeAt(0)),
    ...(pages.length
      ? { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) }
      : {}),
    ...(focusLocation.slide ?? anchorLocation.slide
      ? { slide: focusLocation.slide ?? anchorLocation.slide }
      : {})
  }
}

export function pageFromDocxNode(node: Node | null, root: HTMLElement): number | undefined {
  const element = node instanceof Element ? node : node?.parentElement
  const page = element?.closest<HTMLElement>('section.docx')
  if (!page) return undefined
  const pages = Array.from(root.querySelectorAll('section.docx'))
  const index = pages.indexOf(page)
  return index >= 0 ? index + 1 : undefined
}
