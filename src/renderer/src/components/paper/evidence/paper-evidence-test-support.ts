import type { ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { PaperComparisonMatrix, PaperEvidence, PaperEvidenceMaterialResult, PaperMatrixCell } from '@shared/paper/paper-evidence-types'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

export const hash = 'a'.repeat(64)
export const entry: PaperLibraryEntry = {
  unitDir: 'papers/a', meta: { version: 2, slug: 'a', title: 'Paper A', authors: [], importedAt: 'now', abstract: 'Abstract A' },
  hasPdf: true, hasNotes: false, interpretationCount: 0, group: ''
}
export const evidence: PaperEvidence = {
  id: 'evidence-a', unitDir: entry.unitDir, sourceMarkId: 'mark-a', sourceKind: 'highlight',
  originalQuote: 'The gain was not 10%; it was 2.3 ms.', anchor: { page: 4, rects: [[0, 0, 1, 1]] },
  paperVersion: { canonicalId: 'arxiv:2401.12345', arxivVersion: 'v2', citeKey: 'Author2026', title: entry.meta.title,
    pdfFile: 'paper.pdf', pdfSha256: hash, pdfBytes: 100, capturedAt: 'now' },
  mechanical: { versionBinding: 'bound', quoteMatch: 'matched', textPartial: false, checkedAt: 'now' },
  interpretation: 'Manual interpretation', conditions: 'Held-out split', question: 'Why?',
  claimKind: 'user-judgment', verification: 'unverified', createdAt: 'now', updatedAt: 'now'
}
export const material: PaperEvidenceMaterialResult & { ok: true } = {
  ok: true, paperVersion: evidence.paperVersion, sourceText: '[Page 4]\n' + evidence.originalQuote,
  pageCount: 1, extractedPages: [4], missingTextPages: [], textPartial: false, abstractOnly: false,
  figuresStatus: 'none', figureConfidence: { high: 0, medium: 0, low: 0 }, figuresVersionBound: false
}
export const unknownCell: PaperMatrixCell = {
  unitDir: entry.unitDir, axis: 'method', value: '', status: 'not-reported', evidenceIds: [],
  comparability: 'unknown', comparabilityReason: '', updatedAt: 'now'
}
export const matrix: PaperComparisonMatrix = {
  id: 'matrix-a', title: 'Manual comparison', axes: ['method'],
  rows: [{ unitDir: entry.unitDir, title: entry.meta.title, canonicalId: evidence.paperVersion.canonicalId, citeKey: 'Author2026' }],
  cells: [unknownCell], createdAt: 'now', updatedAt: 'now'
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer
  await act(async () => { tree = create(element) })
  return tree
}
export function nodeText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('')
}
export function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  return tree.root.find((node) => node.type === 'button' && nodeText(node).startsWith(label))
}
export async function click(tree: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => { button(tree, label).props.onClick() })
}
export async function change(node: ReactTestInstance, value: string | boolean): Promise<void> {
  await act(async () => { node.props.onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } }) })
}
