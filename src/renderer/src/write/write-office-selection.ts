import type { WorkspaceOfficeSelection } from '@shared/office-document'
import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'

export function writeSelectionFromOffice(
  selection: WorkspaceOfficeSelection
): WriteEditorSelectionState {
  const text = selection.text.trim()
  if (!text || selection.charCount <= 0) {
    return {
      text: '',
      ranges: [],
      charCount: 0,
      sourceKind: selection.sourceKind,
      sourceFormat: selection.sourceFormat
    }
  }
  const line = selection.pageStart ?? selection.slide ?? 1
  return {
    text,
    ...(selection.annotationAnchor ? { annotationAnchor: selection.annotationAnchor } : {}),
    ranges: [{
      from: 0,
      to: text.length,
      startLine: line,
      startColumn: 1,
      endLine: selection.pageEnd ?? line,
      endColumn: text.length + 1,
      text,
      charCount: selection.charCount,
      ...(selection.pageStart ? { page: selection.pageStart } : {})
    }],
    charCount: selection.charCount,
    sourceKind: selection.sourceKind,
    sourceFormat: selection.sourceFormat,
    ...(selection.anchorRect ? { anchorRect: selection.anchorRect } : {}),
    ...(selection.pageStart != null ? { pageStart: selection.pageStart } : {}),
    ...(selection.pageEnd != null ? { pageEnd: selection.pageEnd } : {}),
    ...(selection.slide != null ? { slide: selection.slide } : {}),
    ...(selection.sheetName ? { sheetName: selection.sheetName } : {}),
    ...(selection.cellRange ? { cellRange: selection.cellRange } : {}),
    ...(selection.formulas?.length ? { formulas: selection.formulas } : {})
  }
}
