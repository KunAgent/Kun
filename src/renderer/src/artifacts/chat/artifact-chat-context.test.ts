import { describe, expect, it } from 'vitest'
import type { WorkspacePresentationViewReference } from '@shared/office-document'
import { isWorkspaceOfficeViewPositionAttachment } from '../../lib/workspace-office-view-context'
import {
  ARTIFACT_SELECTION_CHIP_ID,
  ARTIFACT_VIEW_CHIP_ID,
  EMPTY_ARTIFACT_CHAT_VIEW,
  artifactContextChips,
  artifactSelectionQuote,
  artifactTurnContexts,
  artifactTurnPrompt,
  type ArtifactChatView
} from './artifact-chat-context'

const t = (key: string, options?: Record<string, unknown>): string => `${key}:${JSON.stringify(options ?? {})}`
const artifact = { path: 'presentations/paper.pptx', workspaceRoot: '/repo', ext: '.pptx' }
const slide7: WorkspacePresentationViewReference = {
  kind: 'presentation',
  path: '/repo/presentations/paper.pptx',
  sourceName: 'paper.pptx',
  sourceFormat: 'pptx',
  sourceSha256: 'a'.repeat(64),
  slide: 7,
  slideCount: 9
}

describe('artifact chat context', () => {
  it('shows the slide on screen until a selection takes over', () => {
    const view: ArtifactChatView = { ...EMPTY_ARTIFACT_CHAT_VIEW, presentation: slide7 }
    expect(artifactContextChips(view, t)).toEqual([
      { id: ARTIFACT_VIEW_CHIP_ID, kind: 'design-target', label: 'artifactChatChipSlide:{"slide":7}', removable: true }
    ])
    const selected = {
      ...view,
      selection: { sourceKind: 'spreadsheet' as const, sourceFormat: 'xlsx' as const, text: '1\t2', charCount: 3, sheetName: 'Ablation', cellRange: 'C2:D9' }
    }
    expect(artifactContextChips(selected, t)).toEqual([
      { id: ARTIFACT_SELECTION_CHIP_ID, kind: 'document-quote', label: 'artifactChatChipRange:{"range":"Ablation!C2:D9"}', removable: true }
    ])
    expect(artifactContextChips({ ...selected, detached: true }, t)).toEqual([])
  })

  it('keeps pinned quotes ahead of the live chip', () => {
    const quote = artifactSelectionQuote({ sourceKind: 'word', sourceFormat: 'docx', text: '为避免奖励投机，我们对每个样本记录执行轨迹', charCount: 21, pageStart: 2 }, artifact)
    expect(quote).toMatchObject({ sourceKind: 'word', pageStart: 2, pageEnd: 2, sourceTitle: 'presentations/paper.pptx' })
    const chips = artifactContextChips({ ...EMPTY_ARTIFACT_CHAT_VIEW, quotes: [quote!], presentation: slide7 }, t)
    expect(chips.map((chip) => chip.id)).toEqual([quote!.id, ARTIFACT_VIEW_CHIP_ID])
  })

  it('sends the file as a writable resource, the selection as a quote and the slide as the view', async () => {
    const contexts = await artifactTurnContexts({
      artifact,
      view: {
        ...EMPTY_ARTIFACT_CHAT_VIEW,
        presentation: slide7,
        selection: { sourceKind: 'presentation', sourceFormat: 'pptx', text: 'RLOO 优于 GRPO', charCount: 12, slide: 7 }
      },
      query: 'make bars wider',
      now: 1
    })
    const kinds = contexts.map((context) => context.reference.kind)
    expect(kinds).toEqual(['work-reference-resource', 'work-reference-quotes', 'office-view-position'])
    expect(contexts[0]!.reference).toMatchObject({ locator: 'presentations/paper.pptx', access: 'read-write', resourceKind: 'office' })
    expect(contexts[1]!.reference).toMatchObject({ quotes: [{ slide: 7, text: 'RLOO 优于 GRPO' }] })
    expect(isWorkspaceOfficeViewPositionAttachment(contexts[2]!)).toBe(true)
  })

  it('names the target file in the prompt and drops the slide once detached', () => {
    const view = { ...EMPTY_ARTIFACT_CHAT_VIEW, presentation: slide7 }
    expect(artifactTurnPrompt(' 柱子加粗 ', artifact, view)).toBe(
      '柱子加粗\n\n(Target file: `presentations/paper.pptx` in this workspace. Apply requested changes to that file directly; the open viewer reloads it. The user is looking at slide 7 of 9.)'
    )
    expect(artifactTurnPrompt('x', artifact, { ...view, detached: true })).not.toContain('slide 7')
  })
})
