import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import {
  derivePresentationFileArtifacts,
  isPresentationArtifactPath,
  MAX_PRESENTATION_ARTIFACTS_PER_TURN,
  PRESENTATION_STUDIO_ARTIFACT_PRODUCER,
  presentationArtifactKindForPath,
  presentationFileArtifactsForTurn
} from './presentation-file-artifacts'

const HTML_SHA256 = 'a'.repeat(64)

describe('presentation file artifacts', () => {
  it('recognizes supported presentation paths without accepting suffix tricks', () => {
    expect(presentationArtifactKindForPath('slides/brief.PPTX')).toEqual({
      kind: 'powerpoint',
      extension: 'PPTX'
    })
    expect(presentationArtifactKindForPath('brief.kun-ppt.HTML')).toEqual({
      kind: 'kun-html',
      extension: 'HTML'
    })
    expect(presentationArtifactKindForPath('slides/brief.ppt')).toEqual({
      kind: 'powerpoint',
      extension: 'PPT'
    })
    expect(isPresentationArtifactPath('brief.pptx.exe')).toBe(false)
    expect(isPresentationArtifactPath('brief.pptm')).toBe(false)
    expect(isPresentationArtifactPath('brief.odp')).toBe(false)
    expect(isPresentationArtifactPath('brief.html')).toBe(false)
    expect(isPresentationArtifactPath(`${'a'.repeat(4097)}.pptx`)).toBe(false)
  })

  it('collects only successful write outputs and explicit generated presentation files', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'ppt',
        summary: 'ppt_master_run',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/workspace/presentations/brief.pptx',
        meta: {
          generatedFiles: [{
            name: 'Leadership brief.pptx',
            relativePath: 'presentations/brief.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            byteSize: 4096
          }]
        }
      },
      {
        kind: 'tool',
        id: 'html',
        summary: 'presentation-apply',
        status: 'success',
        toolKind: 'file_change',
        filePath: 'brief.kun-ppt.html',
        meta: {
          presentationArtifactProducer: PRESENTATION_STUDIO_ARTIFACT_PRODUCER,
          presentationArtifactSha256: HTML_SHA256
        }
      },
      {
        kind: 'tool',
        id: 'failed',
        summary: 'ppt_master_run',
        status: 'error',
        toolKind: 'file_change',
        filePath: 'presentations/failed.pptx'
      },
      {
        kind: 'tool',
        id: 'read',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call',
        filePath: 'presentations/not-generated.pptx'
      }
    ]

    expect(derivePresentationFileArtifacts(blocks, '/workspace')).toEqual([
      {
        path: 'presentations/brief.pptx',
        name: 'Leadership brief.pptx',
        kind: 'powerpoint',
        extension: 'PPTX',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        byteSize: 4096
      },
      {
        path: 'brief.kun-ppt.html',
        name: 'brief.kun-ppt.html',
        kind: 'kun-html',
        extension: 'HTML',
        contentSha256: HTML_SHA256
      }
    ])
  })

  it('deduplicates path aliases and bounds a turn', () => {
    const blocks: ChatBlock[] = Array.from(
      { length: MAX_PRESENTATION_ARTIFACTS_PER_TURN + 4 },
      (_, index) => ({
        kind: 'tool' as const,
        id: `ppt-${index}`,
        summary: 'export',
        status: 'success' as const,
        toolKind: 'file_change' as const,
        filePath: `presentations/deck-${index}.pptx`
      })
    )
    blocks.unshift({
      kind: 'tool',
      id: 'alias',
      summary: 'export',
      status: 'success',
      toolKind: 'file_change',
      filePath: '/workspace/presentations/deck-0.pptx'
    })
    blocks.unshift({
      kind: 'tool',
      id: 'dot-alias',
      summary: 'export',
      status: 'success',
      toolKind: 'file_change',
      filePath: 'presentations/./deck-0.pptx'
    })

    const artifacts = derivePresentationFileArtifacts(blocks, '/workspace')
    expect(artifacts).toHaveLength(MAX_PRESENTATION_ARTIFACTS_PER_TURN)
    expect(artifacts.filter((artifact) => artifact.name.toLowerCase() === 'deck-0.pptx')).toHaveLength(1)
  })

  it('uses platform-aware case semantics for distinct presentation files', () => {
    const blocks: ChatBlock[] = ['Deck.pptx', 'deck.pptx'].map((filePath, index) => ({
      kind: 'tool',
      id: `ppt-${index}`,
      summary: 'export',
      status: 'success',
      toolKind: 'file_change',
      filePath
    }))

    expect(derivePresentationFileArtifacts(blocks, '/workspace', 'linux')).toHaveLength(2)
    expect(derivePresentationFileArtifacts(blocks, 'C:/workspace', 'win32')).toHaveLength(1)
  })

  it('rejects paths outside the owning workspace and parent traversal', () => {
    const blocks: ChatBlock[] = [
      '/outside/leak.pptx',
      '../leak.pptx',
      '~/leak.pptx',
      'file:///outside/leak.pptx',
      'safe/deck.pptx'
    ].map(
      (filePath, index) => ({
        kind: 'tool',
        id: `ppt-${index}`,
        summary: 'export',
        status: 'success',
        toolKind: 'file_change',
        filePath
      })
    )

    expect(derivePresentationFileArtifacts(blocks, '/workspace', 'linux').map(({ path }) => path)).toEqual([
      'safe/deck.pptx'
    ])
    expect(derivePresentationFileArtifacts(blocks, '', 'linux')).toEqual([])
  })

  it('only accepts standalone HTML decks from trusted Presentation Studio writes', () => {
    const untrusted: ChatBlock = {
      kind: 'tool',
      id: 'generic-write',
      summary: 'write',
      status: 'success',
      toolKind: 'file_change',
      filePath: 'evil.kun-ppt.html',
      meta: {
        generatedFiles: [{ relativePath: 'also-evil.kun-ppt.html' }]
      }
    }
    const trusted: ChatBlock = {
      ...untrusted,
      id: 'presentation-studio',
      filePath: 'deck.kun-ppt.html',
      meta: {
        presentationArtifactProducer: PRESENTATION_STUDIO_ARTIFACT_PRODUCER,
        presentationArtifactSha256: HTML_SHA256
      }
    }

    expect(derivePresentationFileArtifacts([untrusted, trusted], '/workspace')).toEqual([
      expect.objectContaining({
        path: 'deck.kun-ppt.html',
        kind: 'kun-html',
        contentSha256: HTML_SHA256
      })
    ])
  })

  it('requires a valid write-time digest for trusted standalone HTML', () => {
    const block: ChatBlock = {
      kind: 'tool',
      id: 'presentation-studio',
      summary: 'presentation-create',
      status: 'success',
      toolKind: 'file_change',
      filePath: 'deck.kun-ppt.html',
      meta: { presentationArtifactProducer: PRESENTATION_STUDIO_ARTIFACT_PRODUCER }
    }

    expect(derivePresentationFileArtifacts([block], '/workspace')).toEqual([])
  })

  it('keeps presentation handoff hidden until the turn completes', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'ppt',
      summary: 'ppt_master_run',
      status: 'success',
      toolKind: 'file_change',
      filePath: 'presentations/brief.pptx'
    }]

    expect(presentationFileArtifactsForTurn(blocks, '/workspace', true)).toEqual([])
    expect(presentationFileArtifactsForTurn(blocks, '/workspace', false)).toHaveLength(1)
  })
})
