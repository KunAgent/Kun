import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  deriveGeneratedDocumentArtifacts,
  generatedDocumentArtifactsForTurn,
  generatedDocumentKindForPath,
  isGeneratedDocumentArtifactPath,
  MAX_GENERATED_DOCUMENTS_PER_TURN,
  PRESENTATION_STUDIO_ARTIFACT_PRODUCER
} from './generated-document-artifacts'

const HTML_SHA256 = 'a'.repeat(64)

function fileChange(filePath: string, id = filePath): ToolBlock {
  return {
    kind: 'tool',
    id,
    summary: 'write',
    status: 'success',
    toolKind: 'file_change',
    filePath
  }
}

describe('generated document artifacts', () => {
  it('recognizes the supported Office, PDF, and trusted HTML path shapes', () => {
    expect(generatedDocumentKindForPath('report.DOCX')).toEqual({ kind: 'word', extension: 'DOCX' })
    expect(generatedDocumentKindForPath('book.xls')).toEqual({ kind: 'spreadsheet', extension: 'XLS' })
    expect(generatedDocumentKindForPath('deck.PPTX')).toEqual({ kind: 'presentation', extension: 'PPTX' })
    expect(generatedDocumentKindForPath('export.pdf')).toEqual({ kind: 'pdf', extension: 'PDF' })
    expect(generatedDocumentKindForPath('deck.kun-ppt.HTML')).toEqual({ kind: 'kun-html', extension: 'HTML' })
    expect(isGeneratedDocumentArtifactPath('report.docx.exe')).toBe(false)
    expect(isGeneratedDocumentArtifactPath('notes.md')).toBe(false)
  })

  it('collects successful file changes and explicit generated-file metadata', () => {
    const blocks: ChatBlock[] = [
      fileChange('/workspace/reports/brief.docx', 'docx'),
      {
        kind: 'tool',
        id: 'pdf',
        summary: 'export',
        status: 'success',
        toolKind: 'tool_call',
        meta: {
          generatedFiles: [{
            name: 'Final report.pdf',
            relativePath: 'reports/final.pdf',
            mimeType: 'application/pdf',
            byteSize: 4096
          }]
        }
      },
      {
        ...fileChange('reports/failed.xlsx', 'failed'),
        status: 'error'
      },
      {
        kind: 'tool',
        id: 'read',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call',
        filePath: 'reports/not-written.pptx'
      }
    ]

    expect(deriveGeneratedDocumentArtifacts(blocks, '/workspace', 'linux')).toEqual([
      {
        path: 'reports/final.pdf',
        name: 'Final report.pdf',
        kind: 'pdf',
        extension: 'PDF',
        mimeType: 'application/pdf',
        byteSize: 4096
      },
      {
        path: '/workspace/reports/brief.docx',
        name: 'brief.docx',
        kind: 'word',
        extension: 'DOCX'
      }
    ])
  })

  it('deduplicates aliases and orders artifacts by their last successful write', () => {
    const blocks: ChatBlock[] = [
      fileChange('reports/brief.docx', 'first-doc'),
      fileChange('reports/book.xlsx', 'book'),
      {
        ...fileChange('/workspace/reports/brief.docx', 'updated-doc'),
        meta: {
          generatedFiles: [{
            relativePath: 'reports/brief.docx',
            name: 'Updated brief.docx',
            byteSize: 8192
          }]
        }
      }
    ]

    expect(deriveGeneratedDocumentArtifacts(blocks, '/workspace', 'linux')).toEqual([
      expect.objectContaining({
        path: 'reports/brief.docx',
        name: 'Updated brief.docx',
        byteSize: 8192
      }),
      expect.objectContaining({ path: 'reports/book.xlsx' })
    ])
  })

  it('uses platform-aware path identity and retains only the latest bounded set', () => {
    const caseVariants = [fileChange('Deck.PPTX'), fileChange('deck.pptx')]
    expect(deriveGeneratedDocumentArtifacts(caseVariants, '/workspace', 'linux')).toHaveLength(2)
    expect(deriveGeneratedDocumentArtifacts(caseVariants, 'C:/workspace', 'win32')).toHaveLength(1)

    const many = Array.from(
      { length: MAX_GENERATED_DOCUMENTS_PER_TURN + 4 },
      (_, index) => fileChange(`reports/report-${index}.pdf`)
    )
    const artifacts = deriveGeneratedDocumentArtifacts(many, '/workspace')
    expect(artifacts).toHaveLength(MAX_GENERATED_DOCUMENTS_PER_TURN)
    expect(artifacts[0].path).toBe(`reports/report-${MAX_GENERATED_DOCUMENTS_PER_TURN + 3}.pdf`)
    expect(artifacts.at(-1)?.path).toBe('reports/report-4.pdf')
  })

  it('rejects workspace-external, traversal, URI, home, and oversized paths', () => {
    const blocks = [
      '/outside/leak.docx',
      '../leak.xlsx',
      '~/leak.pptx',
      'file:///outside/leak.pdf',
      `${'a'.repeat(4097)}.pdf`,
      'safe/report.docx'
    ].map((path) => fileChange(path))

    expect(deriveGeneratedDocumentArtifacts(blocks, '/workspace', 'linux').map(({ path }) => path))
      .toEqual(['safe/report.docx'])
    expect(deriveGeneratedDocumentArtifacts(blocks, '', 'linux')).toEqual([])
  })

  it('requires trusted Presentation Studio provenance and digest for Kun HTML', () => {
    const untrusted = fileChange('untrusted.kun-ppt.html', 'untrusted')
    const trusted: ChatBlock = {
      ...fileChange('trusted.kun-ppt.html', 'trusted'),
      meta: {
        presentationArtifactProducer: PRESENTATION_STUDIO_ARTIFACT_PRODUCER,
        presentationArtifactSha256: HTML_SHA256
      }
    }

    expect(deriveGeneratedDocumentArtifacts([untrusted, trusted], '/workspace')).toEqual([
      expect.objectContaining({
        path: 'trusted.kun-ppt.html',
        kind: 'kun-html',
        contentSha256: HTML_SHA256
      })
    ])
  })

  it('keeps the final handoff hidden while the turn is processing', () => {
    const blocks = [fileChange('reports/brief.docx')]
    expect(generatedDocumentArtifactsForTurn(blocks, '/workspace', true)).toEqual([])
    expect(generatedDocumentArtifactsForTurn(blocks, '/workspace', false)).toHaveLength(1)
  })
})
