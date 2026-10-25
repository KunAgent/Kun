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
  toolLiveActionSearch: 'Searching',
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

describe('MessageTimeline tool summaries', () => {
  function WorkspaceConsumer() {
    return createElement('span', null, useTimelineFilePreviewWorkspaceRoot())
  }

  it('uses the active thread workspace for file previews before falling back to the global workspace', () => {
    expect(timelineFilePreviewWorkspaceRoot(
      { workspace: ' /tmp/thread-workspace ' },
      '/tmp/global-workspace'
    )).toBe('/tmp/thread-workspace')

    expect(timelineFilePreviewWorkspaceRoot(
      { workspace: '   ' },
      '/tmp/global-workspace'
    )).toBe('/tmp/global-workspace')
  })

  it('provides the timeline workspace through context instead of the global active thread', () => {
    const html = renderToStaticMarkup(
      createElement(
        TimelineFilePreviewWorkspaceProvider,
        {
          workspaceRoot: '/tmp/embedded-thread',
          children: createElement(WorkspaceConsumer)
        }
      )
    )

    expect(html).toContain('/tmp/embedded-thread')
  })

  it('retries generated workspace images that are requested before the export is written', async () => {
    const readImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'File not found' })
      .mockResolvedValueOnce({
        ok: true,
        path: '/tmp/thread-workspace/.deepseekgui-images/diagram.png',
        dataUrl: 'data:image/png;base64,ZGlhZ3JhbQ==',
        mimeType: 'image/png',
        size: 7
      })
    const wait = vi.fn(async () => undefined)

    await expect(readGeneratedWorkspaceImagePreview({
      path: '.deepseekgui-images/diagram.png',
      workspaceRoot: '/tmp/thread-workspace',
      readImage,
      retryDelaysMs: [0, 25],
      wait
    })).resolves.toBe('data:image/png;base64,ZGlhZ3JhbQ==')

    expect(readImage).toHaveBeenCalledTimes(2)
    expect(readImage).toHaveBeenNthCalledWith(1, {
      path: '.deepseekgui-images/diagram.png',
      workspaceRoot: '/tmp/thread-workspace'
    })
    expect(wait).toHaveBeenCalledWith(25)
  })

  it('summarizes built-in read/write/edit tools with their file path', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'read: file',
          meta: { toolName: 'read' },
          filePath: '/tmp/readme.md'
        }),
        t
      )
    ).toBe('Read /tmp/readme.md')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'write: file',
          meta: { toolName: 'write' },
          filePath: '/tmp/out.ts'
        }),
        t
      )
    ).toBe('Write /tmp/out.ts')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'edit: file',
          meta: { toolName: 'edit' },
          filePath: '/tmp/app.ts'
        }),
        t
      )
    ).toBe('Edit /tmp/app.ts')
  })

  it('summarizes built-in grep/find with pattern context', () => {
    const grep = summarizeToolBlock(
      toolBlock({
        summary: 'grep: search',
        meta: { toolName: 'grep', pattern: 'needle' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(grep).toBe('Search needle · /tmp/src')

    const find = summarizeToolBlock(
      toolBlock({
        summary: 'find: files',
        meta: { toolName: 'find', pattern: '*.ts' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(find).toBe('Find *.ts · /tmp/src')
  })

  it('summarizes fast_context with its short UI title', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'fast_context',
          meta: { toolName: 'fast_context' },
          detail: JSON.stringify({
            title: 'Voice transcription flow',
            query: 'Trace speech transcription wiring'
          })
        }),
        t
      )
    ).toBe('Fast context Voice transcription flow')
  })

  it('does not repeat a raw summary that matches the generated tool label', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'Create plan',
          meta: { toolName: 'create_plan' }
        }),
        t
      )
    ).toBe('Create plan')
  })

  it('summarizes built-in ls with its path and bash with its command', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'ls: list',
          meta: { toolName: 'ls' },
          filePath: '/tmp/project'
        }),
        t
      )
    ).toBe('List /tmp/project')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'bash: exec',
          toolKind: 'command_execution',
          meta: { toolName: 'bash', command: 'npm test' }
        }),
        t
      )
    ).toBe('Ran command npm test')
  })

  it('summarizes background_shell with action, session id, and command', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'background_shell',
          meta: {
            toolName: 'background_shell',
            action: 'read',
            session_id: '2mcorxhe',
            command: 'sleep 15 && echo "Hello from background!"'
          },
          detail: JSON.stringify(
            {
              action: 'read',
              session_id: '2mcorxhe',
              command: 'sleep 15 && echo "Hello from background!"',
              exit_code: 0,
              status: 'completed'
            },
            null,
            2
          )
        }),
        t
      )
    ).toBe('Read background shell 2mcorxhe sleep 15 && echo "Hello from background!"')
  })

  it('folds adjacent non-text work while preserving assistant text boundaries', () => {
    const sections = groupProcessSections([
      { kind: 'reasoning', id: 'reasoning_1', text: 'inspect the code' },
      toolBlock({ id: 'tool_read', summary: 'read: file', meta: { toolName: 'read' } }),
      { kind: 'reasoning', id: 'reasoning_2', text: 'check one more path' },
      { kind: 'assistant', id: 'assistant_1', text: 'I found the relevant component.' },
      toolBlock({ id: 'tool_test', summary: 'bash: test', meta: { toolName: 'bash' } })
    ])

    expect(sections.map((section) => ({
      kind: section.kind,
      ids: section.blocks.map((block) => block.id)
    }))).toEqual([
      {
        kind: 'execution',
        ids: ['reasoning_1', 'tool_read', 'reasoning_2']
      },
      {
        kind: 'output',
        ids: ['assistant_1']
      },
      {
        kind: 'execution',
        ids: ['tool_test']
      }
    ])
  })

  it('keeps compaction as a hard boundary between execution phases', () => {
    const sections = groupProcessSections([
      toolBlock({ id: 'tool_before', summary: 'read: before', meta: { toolName: 'read' } }),
      {
        kind: 'compaction',
        id: 'compaction_1',
        summary: 'Context compacted',
        status: 'success',
        auto: true
      },
      toolBlock({ id: 'tool_after', summary: 'read: after', meta: { toolName: 'read' } })
    ])

    expect(sections.map((section) => ({
      id: section.id,
      ids: section.blocks.map((block) => block.id)
    }))).toEqual([
      { id: 'execution-tool_before', ids: ['tool_before'] },
      { id: 'compaction-compaction_1', ids: ['compaction_1'] },
      { id: 'execution-tool_after', ids: ['tool_after'] }
    ])
  })

  it('summarizes a collapsed phase by its work and its active operation', () => {
    const readBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: app',
      meta: { toolName: 'read' },
      filePath: '/tmp/app.ts'
    })
    const searchBlock = toolBlock({
      id: 'tool_search',
      summary: 'grep: app',
      status: 'running',
      meta: { toolName: 'grep', pattern: 'phase summary' }
    })
    const editBlock = toolBlock({
      id: 'tool_edit',
      summary: 'edit: app',
      toolKind: 'file_change',
      meta: { toolName: 'edit' }
    })
    const commandBlock = toolBlock({
      id: 'tool_command',
      summary: 'bash: test',
      toolKind: 'command_execution',
      meta: { toolName: 'bash', command: 'npm test' }
    })

    expect(summarizeProcessWork([readBlock, searchBlock, editBlock, commandBlock], t)).toBe(
      'Read 1 file · Searched once · Edited 1 file · Ran 1 command'
    )
    expect(
      describeProcessSection(
        { id: 'execution_active', kind: 'execution', blocks: [readBlock, searchBlock] },
        t,
        { processing: true, singleReasoningSection: false }
      )
    ).toBe('Working Searching · Read 1 file · Searched once')
  })

  it('folds live reasoning into a preceding non-text tool batch', () => {
    const sections = groupProcessSections([
      toolBlock({ id: 'tool_read', summary: 'read: file', meta: { toolName: 'read' } }),
      toolBlock({ id: 'tool_grep', summary: 'grep: search', meta: { toolName: 'grep' } }),
      { kind: 'reasoning', id: 'live-reasoning', text: 'next plan' }
    ])

    expect(sections.map((section) => ({
      kind: section.kind,
      ids: section.blocks.map((block) => block.id)
    }))).toEqual([
      {
        kind: 'execution',
        ids: ['tool_read', 'tool_grep', 'live-reasoning']
      }
    ])
  })

  it('keeps sibling fast_context calls as independent subagent sections', () => {
    const sections = groupProcessSections([
      toolBlock({
        id: 'explore_1',
        summary: 'explore packaging',
        meta: {
          toolName: 'fast_context',
          child: {
            parentThreadId: 'thread_parent',
            parentTurnId: 'turn_1',
            childId: 'child_1',
            childProfile: 'explore',
            childSeq: 1
          }
        }
      }),
      toolBlock({
        id: 'explore_2',
        summary: 'explore workflow',
        meta: {
          toolName: 'fast_context',
          child: {
            parentThreadId: 'thread_parent',
            parentTurnId: 'turn_1',
            childId: 'child_2',
            childProfile: 'explore',
            childSeq: 2
          }
        }
      }),
      toolBlock({
        id: 'explore_3',
        summary: 'explore runtime',
        meta: {
          toolName: 'fast_context',
          child: {
            parentThreadId: 'thread_parent',
            parentTurnId: 'turn_1',
            childId: 'child_3',
            childProfile: 'explore',
            childSeq: 3
          }
        }
      })
    ])

    expect(sections.map((section) => ({
      kind: section.kind,
      ids: section.blocks.map((block) => block.id)
    }))).toEqual([
      { kind: 'subagent', ids: ['explore_1'] },
      { kind: 'subagent', ids: ['explore_2'] },
      { kind: 'subagent', ids: ['explore_3'] }
    ])
  })

  it('still coalesces sibling non-explore delegate_task calls into one swarm section', () => {
    const sections = groupProcessSections([
      toolBlock({
        id: 'delegate_1',
        summary: 'General Agent 1',
        meta: {
          toolName: 'delegate_task',
          child: {
            parentThreadId: 'thread_parent',
            parentTurnId: 'turn_1',
            childId: 'child_a',
            childProfile: 'general',
            childSeq: 1
          }
        }
      }),
      toolBlock({
        id: 'delegate_2',
        summary: 'General Agent 2',
        meta: {
          toolName: 'delegate_task',
          child: {
            parentThreadId: 'thread_parent',
            parentTurnId: 'turn_1',
            childId: 'child_b',
            childProfile: 'general',
            childSeq: 2
          }
        }
      })
    ])

    expect(sections.map((section) => ({
      kind: section.kind,
      ids: section.blocks.map((block) => block.id)
    }))).toEqual([
      { kind: 'subagent', ids: ['delegate_1', 'delegate_2'] }
    ])
  })
})
