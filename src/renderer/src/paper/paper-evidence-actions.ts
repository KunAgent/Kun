import type { PaperComparisonMatrix, PaperEvidence } from '@shared/paper/paper-evidence-types'
import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { flushPaperMarks } from './use-paper-marks'
import { usePaperMarksStore } from './paper-marks-store'

export async function promotePaperEvidence(workspaceRoot: string, unitDir: string, markId: string): Promise<void> {
  await flushPaperMarks(workspaceRoot, unitDir)
  const marks = usePaperMarksStore.getState()
  if (marks.workspaceRoot === workspaceRoot && marks.unitDir === unitDir && marks.dirty) throw new Error('Annotation changes are not saved yet. Retry before creating evidence.')
  const read = await window.kunGui.paperEvidenceRead({ workspaceRoot })
  if (!read.ok) throw new Error(read.message)
  const saved = await window.kunGui.paperEvidencePromote({ workspaceRoot, unitDir, markId, expectedRevision: read.revision })
  if (!saved.ok) throw new Error(saved.message)
}

/** Check the persisted snapshot against current bytes before navigating. */
export async function inspectPaperEvidence(workspaceRoot: string, evidence: PaperEvidence): Promise<void> {
  const before = useWriteWorkspaceStore.getState()
  const activeFilePath = before.activeFilePath
  const source = await window.kunGui.paperEvidenceSource({ workspaceRoot, evidenceId: evidence.id })
  if (!source.ok) throw new Error(source.message)
  if (source.status !== 'current' || !source.pdfFile) throw new Error(source.message)
  const current = useWriteWorkspaceStore.getState()
  if (current.workspaceRoot !== before.workspaceRoot || current.activeFilePath !== activeFilePath) throw new Error('The active document changed while checking evidence. Retry from the current view.')
  const filePath = writeJoinPath(writeJoinPath(workspaceRoot, source.unitDir), source.pdfFile)
  await useWriteWorkspaceStore.getState().openFile(workspaceRoot, filePath, { groupId: 'primary' })
  requestKnowledgeSourceNavigation({ filePath, location: { kind: 'pdf', pageStart: source.page, pageEnd: source.page, expectedSha256: source.expectedSha256 } })
}

function markdownText(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** Original quote remains byte-for-byte intact in the evidence store. */
export function paperEvidenceCitation(evidence: PaperEvidence): string {
  const version = evidence.paperVersion
  const path = `${evidence.unitDir}/${version.pdfFile}`.split('/').map(encodeURIComponent).join('/')
  return [
    evidence.originalQuote ? `> ${evidence.originalQuote.replace(/\n/g, '\n> ')}` : '> [Image annotation]',
    `[@${version.citeKey}] [p.${evidence.anchor.page}](${path}#page=${evidence.anchor.page})`,
    `Evidence: ${evidence.id}; ${version.canonicalId}; ${version.arxivVersion ?? 'revision unknown'}; SHA-256: ${version.pdfSha256}`,
    `Source binding: ${evidence.mechanical.versionBinding}; quote: ${evidence.mechanical.quoteMatch}; semantic review: ${evidence.verification}`,
    `Claim type: ${evidence.claimKind}`,
    evidence.interpretation && `Interpretation: ${evidence.interpretation}`,
    evidence.conditions && `Conditions: ${evidence.conditions}`,
    evidence.question && `Research question: ${evidence.question}`
  ].filter(Boolean).join('\n\n')
}

export function paperMatrixMarkdown(matrix: PaperComparisonMatrix, evidence: readonly PaperEvidence[]): string {
  const used = new Set<string>()
  const header = ['Paper', ...matrix.axes]
  const rows = matrix.rows.map((row) => [row.title, ...matrix.axes.map((axis) => {
    const cell = matrix.cells.find((item) => item.unitDir === row.unitDir && item.axis === axis)
    if (!cell || cell.status === 'not-reported') return 'Not reported'
    cell.evidenceIds.forEach((id) => used.add(id))
    return `${cell.value} (${cell.comparability}: ${cell.comparabilityReason || 'not assessed'}; evidence ${cell.evidenceIds.join(', ')})`
  })])
  return [
    `# ${matrix.title}`, '',
    'Values are not a leaderboard. Dataset versions, splits, metrics and conditions may differ.', '',
    `| ${header.map(markdownText).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownText).join(' | ')} |`), '',
    '## Source evidence', '',
    ...evidence.filter((item) => used.has(item.id)).map(paperEvidenceCitation)
  ].join('\n')
}
