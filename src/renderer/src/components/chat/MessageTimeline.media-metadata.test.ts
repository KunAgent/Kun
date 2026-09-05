import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  ConversationTurn,
  MessageTimeline,
  TimelineRuntimeError,
  liveTurnProgressClass,
  timelineBottomPaddingClass,
  resultPreviewSourcesForTurn,
  summarizeToolBlock,
  timelineTurnIsProcessing
} from './MessageTimeline'
import {
  GeneratedFilesPanel,
  MessageBubble,
  generatedMediaScrollAvailability,
  turnMetricsLabel
} from './message-timeline-bubbles'
import {
  describeProcessSection,
  ProcessSectionRow,
  groupProcessSections,
  summarizeProcessWork
} from './message-timeline-process'
import {
  TimelineFilePreviewWorkspaceProvider,
  timelineFilePreviewWorkspaceRoot,
  useTimelineFilePreviewWorkspaceRoot
} from './timeline-file-preview-workspace'
import { readGeneratedWorkspaceImagePreview } from './generated-media-preview'

const labels: Record<string, string> = {
  toolActionCommand: 'Ran command',
  toolBuiltinRead: 'Read',
  toolBuiltinWrite: 'Write',
  toolBuiltinEdit: 'Edit',
  toolBuiltinGrep: 'Search',
  toolBuiltinFind: 'Find',
  toolBuiltinLs: 'List',
  toolBuiltinBash: 'Bash',
  toolBuiltinBackgroundShell: 'Background shell',
  toolActionBackgroundShellRead: 'Read background shell',
  toolActionBackgroundShellList: 'List background shells',
  workingToolAction: 'Working {{action}}',
  thinkingNow: 'Thinking…',
  turnMetricsTtft: 'Avg TTFT {{value}}',
  turnMetricsTps: 'Avg {{value}} tok/s',
  groupReadFiles: 'Read {{count}} files',
  groupReadFile: 'Read 1 file',
  groupSearched: 'Searched {{count}} times',
  groupSearchedOnce: 'Searched once',
  groupEditedFiles: 'Edited {{count}} files',
  groupEditedFile: 'Edited 1 file',
  groupRanCommands: 'Ran {{count}} commands',
  groupRanCommand: 'Ran 1 command'
}

const t = (key: string, opts?: Record<string, unknown>) =>
  (labels[key] ?? (key === 'toolActionCommand' ? 'Ran command' : key)).replace(
    /\{\{(\w+)\}\}/g,
    (_match, name: string) => String(opts?.[name] ?? '')
  )

const activeThread: NormalizedThread = {
  id: 'thr_1',
  title: 'Thread',
  updatedAt: '2026-06-07T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    ...overrides
  }
}

describe('MessageTimeline Kun runtime metadata smoke', () => {
  beforeEach(() => {
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: 'thr_1',
      threads: [activeThread],
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      clawChannels: [],
      activeClawChannelId: ''
    })
  })

  it('renders user image attachments as thumbnails instead of attachment chips', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_1',
      text: '为什么图片完全没有识别啊',
      meta: {
        attachmentIds: ['att_1'],
        attachments: [{
          id: 'att_1',
          name: 'image.png',
          mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,abc'
        }]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).toContain('为什么图片完全没有识别啊')
    expect(html).not.toContain('Attachments 1')
    expect(html).not.toContain('ds-media-printer-reveal')
    expect(html).toContain('data-user-media-gallery')
    expect(html).toContain('data-user-media-count="1"')
    expect(html).toContain('max-w-[min(100%,20rem)]')
    expect(html).not.toContain('data-user-media-carousel')
    expect(html).not.toContain('generatedFileDownload')
  })

  it('keeps two or three user images in a row without carousel controls', () => {
    const attachments = [1, 2, 3].map((index) => ({
      id: `att_${index}`,
      name: `image-${index}.png`,
      mimeType: 'image/png',
      previewUrl: `data:image/png;base64,img${index}`
    }))
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_multi',
      text: '三张图',
      meta: {
        attachmentIds: attachments.map((item) => item.id),
        attachments
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('data-user-media-count="3"')
    expect(html).not.toContain('data-user-media-carousel')
    expect(html).not.toContain('generatedFilesPreviousImages')
    expect(html).not.toContain('generatedFilesNextImages')
    expect(html).toContain('src="data:image/png;base64,img1"')
    expect(html).toContain('src="data:image/png;base64,img3"')
  })

  it('keeps two tool result images in a horizontal scrollable gallery', () => {
    const attachments = [1, 2].map((index) => ({
      id: `tool_image_${index}`,
      name: `tool-image-${index}.png`,
      mimeType: 'image/png',
      previewUrl: `data:image/png;base64,tool${index}`
    }))
    const block = toolBlock({
      id: 'tool_images',
      summary: 'Generated two images',
      meta: { attachments }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('data-tool-media-gallery')
    expect(html).toContain('data-tool-media-count="2"')
    expect(html).toContain('flex-nowrap')
    expect(html).toContain('overflow-x-auto')
    expect(html).not.toContain('flex-wrap')
    expect(html).toContain('src="data:image/png;base64,tool1"')
    expect(html).toContain('src="data:image/png;base64,tool2"')
    expect(html).toContain('aria-label="Download"')
  })

  it('enables the user media carousel only when there are more than three images', () => {
    const attachments = [1, 2, 3, 4].map((index) => ({
      id: `att_${index}`,
      name: `image-${index}.png`,
      mimeType: 'image/png',
      previewUrl: `data:image/png;base64,img${index}`
    }))
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_carousel',
      text: '四张图',
      meta: {
        attachmentIds: attachments.map((item) => item.id),
        attachments
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('data-user-media-gallery')
    expect(html).toContain('data-user-media-count="4"')
    expect(html).toContain('data-user-media-carousel')
    expect(html).toContain('snap-x')
    expect(html).toContain('overflow-x-auto')
  })

  it('renders user file references under the sent prompt', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_files',
      text: '看一下这些文件',
      meta: {
        fileReferences: [
          {
            path: '/workspace/deepseek-gui/src/App.tsx',
            relativePath: 'src/App.tsx',
            name: 'App.tsx',
            kind: 'file'
          },
          {
            path: '/workspace/deepseek-gui/src',
            relativePath: 'src',
            name: 'src',
            kind: 'directory'
          }
        ]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('看一下这些文件')
    expect(html).toContain('Referenced files 2')
    expect(html).toContain('src/App.tsx')
    expect(html).toContain('src/')
  })

  it('renders background subagent completion as a compact result card', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'background_subagent_1',
      text: [
        '<background_subagent_completed>',
        '<child_id>child_ms6z14fk_erng9y</child_id>',
        '<label>Client API</label>',
        '<status>completed</status>',
        '<summary>Checked the shared schema and request payload.</summary>',
        '</background_subagent_completed>'
      ].join('\n'),
      meta: {
        displayText: 'Background subagent Client API completed',
        messageSource: 'background_subagent'
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('data-background-subagent-card="true"')
    expect(html).toContain('data-background-subagent-result="true"')
    expect(html).toContain('Client API')
    expect(html).toContain('child_ms6z14fk_erng9y')
    expect(html).toContain('Checked the shared schema and request payload.')
    expect(html).not.toContain('rgba(79,124,255')
  })

  it('clips verbose background subagent output behind an explicit disclosure', () => {
    const longSummary = Array.from(
      { length: 30 },
      (_, index) => `- Result ${index + 1}: verified contract behavior.`
    ).join('\n')
    const block: ChatBlock = {
      kind: 'user',
      id: 'background_subagent_long',
      text: [
        '<background_subagent_completed>',
        '<child_id>child_long</child_id>',
        '<label>Contract review</label>',
        '<status>completed</status>',
        `<summary>${longSummary}</summary>`,
        '</background_subagent_completed>'
      ].join('\n'),
      meta: { messageSource: 'background_subagent' }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('max-h-[360px]')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/View full output|查看完整输出/)
  })

  it('uses the subagent label and status in the process row instead of runtime prose', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'background_subagent_process',
      text: [
        '<background_subagent_completed>',
        '<child_id>child_process</child_id>',
        '<label>Client API</label>',
        '<status>completed</status>',
        '<summary>Done.</summary>',
        '</background_subagent_completed>'
      ].join('\n'),
      meta: {
        displayText: 'Background subagent Client API completed',
        messageSource: 'background_subagent'
      }
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-background_subagent', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('data-background-subagent-row="true"')
    expect(html).toContain('Client API')
    expect(html).not.toContain('Background subagent Client API completed')
  })

  it('renders generated image previews with the printer reveal effect', () => {
    const block: ToolBlock = toolBlock({
      id: 'tool_img',
      summary: 'generate_image',
      meta: {
        generatedFiles: [
          {
            name: 'painting.png',
            mimeType: 'image/png',
            previewUrl: 'data:image/png;base64,paint'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(GeneratedFilesPanel, { blocks: [block] }))

    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,paint"')
    expect(html).toContain('ds-media-printer-reveal')
    expect(html).toContain('data-generated-media-carousel')
    expect(html).toContain('data-generated-media-strip')
    expect(html).toContain('aspect-square')
    expect(html).toContain('object-cover')
    expect(html).not.toContain('sm:grid-cols-2')
  })

  it('keeps generated media tool results as distinct chronological process sections', () => {
    const before = toolBlock({
      id: 'tool_before_image',
      summary: 'read: source',
      meta: { toolName: 'read' }
    })
    const generated = toolBlock({
      id: 'tool_generate_image',
      summary: 'generate_image: skyline',
      meta: {
        toolName: 'generate_image',
        generatedFiles: [{
          name: 'skyline.png',
          mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,skyline'
        }]
      }
    })
    const after = toolBlock({
      id: 'tool_after_image',
      summary: 'read: output',
      meta: { toolName: 'read' }
    })

    expect(groupProcessSections([before, generated, after]).map((section) =>
      section.blocks.map((block) => block.id)
    )).toEqual([
      ['tool_before_image'],
      ['tool_generate_image'],
      ['tool_after_image']
    ])
  })

  it('renders active text and generated work in chronological order without a duplicate', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn: {
          user: { kind: 'user', id: 'user_generate_image', text: 'Create a skyline' },
          blocks: [
            { kind: 'assistant', id: 'assistant_before_image', text: 'Preparing the image now.' },
            toolBlock({
              id: 'tool_generate_image',
              summary: 'generate_image: skyline',
              meta: {
                toolName: 'generate_image',
                generatedFiles: [{
                  name: 'skyline.png',
                  mimeType: 'image/png',
                  previewUrl: 'data:image/png;base64,skyline'
                }]
              }
            }),
            { kind: 'assistant', id: 'assistant_after_image', text: 'Checking the rendered result.' }
          ]
        },
        isProcessing: true,
        liveReasoning: '',
        live: '',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    const placement = 'data-generated-files-placement="timeline"'
    expect(html).toContain(placement)
    expect(html).not.toContain('data-generated-files-placement="turn"')
    expect((html.match(/data-generated-files-placement=/g) ?? []).length).toBe(1)
    expect(html.indexOf('Preparing the image now.')).toBeLessThan(html.indexOf(placement))
    expect(html.indexOf(placement)).toBeLessThan(html.indexOf('Checking the rendered result.'))
  })

  it('moves a completed generated image below the final assistant content', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn: {
          user: { kind: 'user', id: 'user_complete_image', text: 'Create a skyline' },
          blocks: [
            toolBlock({
              id: 'tool_generate_image_complete',
              summary: 'generate_image: skyline',
              meta: {
                toolName: 'generate_image',
                generatedFiles: [{
                  name: 'skyline.png',
                  mimeType: 'image/png',
                  previewUrl: 'data:image/png;base64,skyline'
                }]
              }
            }),
            {
              kind: 'assistant',
              id: 'assistant_image_complete',
              text: 'The finished skyline is ready.'
            }
          ]
        },
        isProcessing: false,
        liveReasoning: '',
        live: '',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    const placement = 'data-generated-files-placement="turn"'
    expect(html).toContain(placement)
    expect(html).not.toContain('data-generated-files-placement="timeline"')
    expect((html.match(/data-generated-files-placement=/g) ?? []).length).toBe(1)
    expect(html.indexOf('The finished skyline is ready.')).toBeLessThan(html.indexOf(placement))
  })

  it('reports the available directions for the generated image strip', () => {
    expect(generatedMediaScrollAvailability({
      scrollLeft: 0,
      clientWidth: 640,
      scrollWidth: 1_100
    })).toEqual({
      canScrollBackward: false,
      canScrollForward: true
    })
    expect(generatedMediaScrollAvailability({
      scrollLeft: 460,
      clientWidth: 640,
      scrollWidth: 1_100
    })).toEqual({
      canScrollBackward: true,
      canScrollForward: false
    })
  })

  it('renders revoked generated artifacts as explicitly unavailable', () => {
    const block: ToolBlock = toolBlock({
      id: 'tool_revoked_artifact',
      summary: 'video-render',
      meta: {
        generatedFiles: [{
          id: 'artifact_1234567890',
          artifactId: 'artifact_1234567890',
          mediaHandleId: 'media_123456789012',
          availability: 'unavailable',
          name: 'final.mp4',
          mimeType: 'video/mp4'
        }]
      }
    })

    const html = renderToStaticMarkup(createElement(GeneratedFilesPanel, { blocks: [block] }))
    expect(html).toContain('Preview unavailable')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('src="kun-media:')
  })

  it('deduplicates generated files across tool blocks by path', () => {
    const first: ToolBlock = toolBlock({
      id: 'tool_export_1',
      summary: 'export_report',
      meta: {
        generatedFiles: [
          { relativePath: 'reports/summary.md', mimeType: 'text/markdown' }
        ]
      }
    })
    const second: ToolBlock = toolBlock({
      id: 'tool_export_2',
      summary: 'export_report',
      meta: {
        generatedFiles: [
          { relativePath: 'reports/summary.md', mimeType: 'text/markdown' }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(GeneratedFilesPanel, { blocks: [first, second] }))

    expect((html.match(/summary\.md/g) ?? []).length).toBe(2)
    expect((html.match(/type="button"/g) ?? []).length).toBe(2)
  })

  it('leaves Office and PDF outputs to the generated-document handoff', () => {
    const block: ToolBlock = toolBlock({
      id: 'tool_documents',
      summary: 'document export',
      meta: {
        generatedFiles: [
          { relativePath: 'reports/summary.docx' },
          { relativePath: 'reports/data.xlsx' },
          { relativePath: 'presentations/brief.pptx' },
          { relativePath: 'reports/appendix.pdf' }
        ]
      }
    })

    expect(renderToStaticMarkup(createElement(GeneratedFilesPanel, { blocks: [block] }))).toBe('')
  })

  it('restores document cards from completed metadata while keeping image media alongside them', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        threadId: 'thr_1',
        turn: {
          user: { kind: 'user', id: 'user_historical_documents', text: 'Create the report' },
          blocks: [
            toolBlock({
              id: 'tool_historical_documents',
              turnId: 'turn_historical_documents',
              summary: 'export report',
              meta: {
                generatedFiles: [
                  { relativePath: 'reports/summary.docx', byteSize: 35_700 },
                  {
                    relativePath: 'reports/chart.png',
                    name: 'chart.png',
                    mimeType: 'image/png',
                    previewUrl: 'data:image/png;base64,chart'
                  }
                ]
              }
            }),
            { kind: 'assistant', id: 'assistant_historical_documents', text: 'The report is ready.' }
          ]
        },
        isProcessing: false,
        liveReasoning: '',
        live: '',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('data-generated-document-card="true"')
    expect(html).toContain('summary.docx')
    expect(html).toContain('data-generated-document-all="true"')
    expect(html).toContain('data-generated-media-carousel')
    expect(html).toContain('chart.png')
  })

  it('projects only bounded non-secret generated-file metadata to result preview Views', () => {
    const sources = resultPreviewSourcesForTurn({
      user: { kind: 'user', id: 'user_1', text: 'make report' },
      blocks: [toolBlock({
        id: 'tool_preview',
        meta: {
          generatedFiles: [{
            id: 'attachment_1',
            name: 'summary.json',
            mimeType: 'application/json',
            relativePath: 'reports/summary.json',
            absolutePath: '/private/workspace/reports/summary.json',
            previewUrl: 'data:application/json;base64,c2VjcmV0'
          }]
        }
      })]
    })

    expect(sources).toEqual([{
      sourceId: 'tool_preview:attachment_1',
      mimeType: 'application/json',
      name: 'summary.json',
      attachmentId: 'attachment_1',
      relativePath: 'reports/summary.json'
    }])
    expect(JSON.stringify(sources)).not.toContain('/private/workspace')
    expect(JSON.stringify(sources)).not.toContain('base64')
  })

  it('projects durable artifact and media references to result preview Views', () => {
    const sources = resultPreviewSourcesForTurn({
      user: { kind: 'user', id: 'user_1', text: 'render video' },
      blocks: [toolBlock({
        id: 'tool_video',
        meta: {
          generatedFiles: [{
            id: 'artifact_1234567890',
            artifactId: 'artifact_1234567890',
            mediaHandleId: 'media_123456789012',
            availability: 'available',
            name: 'final.mp4',
            mimeType: 'video/mp4',
            byteSize: 4096
          }]
        }
      })]
    })

    expect(sources).toEqual([{
      sourceId: 'tool_video:artifact_1234567890',
      mimeType: 'video/mp4',
      name: 'final.mp4',
      artifactId: 'artifact_1234567890',
      mediaHandleId: 'media_123456789012',
      availability: 'available',
      byteSize: 4096
    }])
  })

})
