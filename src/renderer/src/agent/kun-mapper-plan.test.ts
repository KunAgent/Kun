import { describe, expect, it, vi } from 'vitest'
import {
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  dispatchKunRuntimeEvents,
  mergeChatBlocks,
  runtimeProjectionActionsFromEvent,
  threadFromCore
} from './kun-mapper'
import type { CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type { ThreadErrorOptions, ThreadEventSink } from './types'
import {
  PRESENTATION_STUDIO_EXTENSION_ID,
  presentationStudioCanonicalToolId,
  presentationStudioModelAlias
} from '@shared/presentation-artifact'

function makeSink(): ThreadEventSink {
  return {
    onSeq: () => undefined,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTodos: () => undefined,
    onTurnComplete: () => undefined,
    onError: () => undefined
  }
}

describe('create_plan tool mapping', () => {
  it('surfaces turn failure messages from Kun lifecycle events', async () => {
    let capturedError: string | null = null
    let capturedErrorOptions: ThreadErrorOptions | null = null
    let capturedRuntimeError: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: (event) => {
        capturedRuntimeError = event
      },
      onError: (error, options) => {
        capturedError = error.message
        capturedErrorOptions = options ?? null
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 8,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      message: 'model stream exploded'
    }, sink, async () => undefined)

    expect(capturedRuntimeError).toMatchObject({
      itemId: 'runtime_error_turn_1',
      message: 'model stream exploded',
      severity: 'error'
    })
    expect(JSON.parse(capturedError ?? '{}')).toMatchObject({
      message: 'model stream exploded',
      severity: 'error'
    })
    expect(capturedErrorOptions).toEqual({ terminal: true, scope: 'conversation', threadId: 'thr_1', turnId: 'turn_1', seq: 8 })
  })

  it('settles message-less turn failures without adding a generic duplicate error', async () => {
    let capturedErrorOptions: ThreadErrorOptions | null = null
    let runtimeErrorCount = 0
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: () => {
        runtimeErrorCount += 1
      },
      onError: (_error, options) => {
        capturedErrorOptions = options ?? null
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 8,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1'
    }, sink, async () => undefined)

    expect(runtimeErrorCount).toBe(0)
    expect(capturedErrorOptions).toEqual({ terminal: true, scope: 'conversation', threadId: 'thr_1', turnId: 'turn_1', seq: 8 })
  })

  it('does not finish the parent turn for child lifecycle events', async () => {
    let completed = 0
    let fatalErrors = 0
    let childUpdate: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTurnComplete: () => {
        completed += 1
      },
      onTool: (event) => {
        childUpdate = event
      },
      onError: () => {
        fatalErrors += 1
      }
    }
    const child = {
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      childId: 'child_1',
      childLabel: 'child',
      childProfile: 'security-auditor',
      childProfileName: 'Security Auditor',
      childModel: 'gpt-5.6-sol',
      childStatus: 'completed' as const,
      childSeq: 1,
      detached: true
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_started',
      seq: 8,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'running' }
    }, sink, async () => undefined)
    expect(childUpdate).toMatchObject({
      status: 'running',
      updateOnly: true,
      meta: {
        child: {
          childId: 'child_1',
          childStatus: 'running',
          detached: true,
          childProfile: 'security-auditor',
          childProfileName: 'Security Auditor',
          childModel: 'gpt-5.6-sol'
        }
      }
    })

    await dispatchKunRuntimeEvent({
      kind: 'turn_completed',
      seq: 9,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'turn_aborted',
      seq: 10,
      timestamp: '2024-01-01T00:00:01.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'aborted' }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 11,
      timestamp: '2024-01-01T00:00:02.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: { ...child, childStatus: 'failed' },
      message: 'child failed'
    }, sink, async () => undefined)

    expect(completed).toBe(0)
    expect(fatalErrors).toBe(0)
    expect(childUpdate).toMatchObject({
      status: 'error',
      updateOnly: true,
      meta: {
        child: {
          childId: 'child_1',
          childStatus: 'failed',
          detached: true,
          childProfile: 'security-auditor',
          childProfileName: 'Security Auditor',
          childModel: 'gpt-5.6-sol'
        }
      }
    })
  })

  it('keeps detached delegate_task results running until the child settles', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_completed',
      seq: 12,
      item: {
        id: 'item_delegate',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'tool_result',
        toolName: 'delegate_task',
        callId: 'call_delegate',
        output: {
          childId: 'child_background',
          status: 'queued',
          detached: true
        }
      }
    }, sink, async () => undefined)

    expect(captured).toMatchObject({
      itemId: 'tool_call_delegate',
      status: 'running'
    })
    expect(JSON.parse((captured as { detail: string }).detail)).toMatchObject({
      childId: 'child_background',
      status: 'queued',
      detached: true
    })
  })

  it('routes live error items to runtime error timeline events without fatal stream errors', async () => {
    let fatalCalled = false
    let capturedRuntimeError: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: (event) => {
        capturedRuntimeError = event
      },
      onError: () => {
        fatalCalled = true
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_created',
      seq: 9,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      item: {
        id: 'item_error_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'system',
        status: 'failed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'error',
        message: 'Authorization: Bearer secret-token failed',
        code: 'stream_read_error',
        details: { token: 'secret-token' }
      }
    }, sink, async () => undefined)

    expect(fatalCalled).toBe(false)
    expect(capturedRuntimeError).toMatchObject({
      itemId: 'item_error_1',
      message: 'Authorization=<redacted> failed',
      code: 'stream_read_error',
      details: { token: 'secret-token' }
    })
  })

  it('marks persisted error items for direct conversation rendering', () => {
    const block = chatBlockFromItem({
      id: 'item_error_persisted',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'system',
      status: 'failed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'error',
      message: 'provider rejected the request',
      code: 'provider_error'
    })

    expect(block).toMatchObject({
      kind: 'system',
      id: 'item_error_persisted',
      text: 'provider rejected the request',
      code: 'provider_error',
      runtimeError: true
    })
  })

  it('renders the model_empty_response safety net live and after reload without duplicates', async () => {
    const runtimeErrors: unknown[] = []
    let settledBy: string | null = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: (event) => { runtimeErrors.push(event) },
      onError: (error, options) => {
        settledBy = error.message
        expect(options).toMatchObject({ terminal: true, scope: 'conversation' })
      }
    }
    const message =
      'Model provider completed without returning text, reasoning, a tool call, or generated output. ' +
      'Check provider/model availability and routing, then resend the message.'

    await dispatchKunRuntimeEvent({
      kind: 'error',
      seq: 10,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      message,
      code: 'model_empty_response',
      details: { model: 'empty-model', providerId: 'test' },
      severity: 'error'
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 11,
      timestamp: '2024-01-01T00:00:01.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      message, code: 'model_empty_response'
    }, sink, async () => undefined)

    expect(runtimeErrors).toHaveLength(2)
    expect(runtimeErrors[0]).toMatchObject({
      code: 'model_empty_response',
      message: expect.stringContaining('without returning text, reasoning')
    })
    expect(JSON.parse(settledBy ?? '{}')).toMatchObject({
      code: 'model_empty_response',
      message: expect.stringContaining('without returning text, reasoning')
    })
    const block = chatBlockFromItem({
      id: 'item_turn_1_error', turnId: 'turn_1', threadId: 'thr_1',
      role: 'system', status: 'failed', createdAt: '2024-01-01T00:00:01.000Z',
      kind: 'error', message, code: 'model_empty_response',
      details: { model: 'empty-model' }
    })
    expect(block).toMatchObject({
      kind: 'system', code: 'model_empty_response', runtimeError: true
    })
  })

  it('omits legacy persisted tool catalog drift items from the conversation', () => {
    const block = chatBlockFromItem({
      id: 'item_tool_catalog_changed',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'system',
      status: 'failed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'error',
      message: 'Tool catalog changed for this thread',
      code: 'tool_catalog_changed',
      severity: 'info'
    })

    expect(block).toBeNull()
  })

  it('omits legacy live tool catalog drift items without hiding actionable errors', async () => {
    const runtimeError = vi.fn()
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeError: runtimeError
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_created',
      seq: 10,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      item: {
        id: 'item_tool_catalog_changed',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'system',
        status: 'failed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'error',
        message: 'Tool catalog changed for this thread',
        code: 'tool_catalog_changed',
        severity: 'info'
      }
    }, sink, async () => undefined)

    expect(runtimeError).not.toHaveBeenCalled()
  })

  it('maps a successful create_plan result to a tool block with plan metadata', () => {
    const item: CoreTurnItemJson = {
      id: 'item_plan_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-01-01T00:00:01.000Z',
      kind: 'tool_result',
      toolName: 'create_plan',
      callId: 'call_plan_1',
      output: {
        plan_id: 'plan_login',
        workspace_root: '/tmp/ws',
        relative_path: '.deepseekgui/plan/login.md',
        absolute_path: '/tmp/ws/.deepseekgui/plan/login.md',
        operation: 'draft',
        saved_at: '2024-01-01T00:00:01.000Z',
        content_hash: 'deadbeefcafef00d',
        byte_size: 42,
        source_request: 'Add login',
        title: 'Login flow'
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.status).toBe('success')
      expect(block.meta?.toolName).toBe('create_plan')
      expect(block.meta?.plan).toMatchObject({
        plan_id: 'plan_login',
        workspace_root: '/tmp/ws',
        relative_path: '.deepseekgui/plan/login.md',
        operation: 'draft',
        byte_size: 42
      })
    }
  })

  it('maps a failed create_plan result to an error tool block', () => {
    const item: CoreTurnItemJson = {
      id: 'item_plan_err',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'failed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'create_plan',
      callId: 'call_plan_err',
      isError: true,
      output: { error: 'plan_relative_path must be a direct Markdown file under .deepseekgui/plan' }
    }
    const block = chatBlockFromItem(item)
    if (block && block.kind === 'tool') {
      expect(block.status).toBe('error')
      expect(block.meta?.plan).toMatchObject({ error: expect.stringContaining('direct Markdown') })
    } else {
      throw new Error('expected tool block')
    }
  })

  it('lifts tool_result output attachments into tool block meta', () => {
    const item: CoreTurnItemJson = {
      id: 'item_img_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_image',
      callId: 'call_img_1',
      output: {
        files: [{ relativePath: '.deepseekgui-images/img-1.png' }],
        attachments: [
          { id: 'att_abc', name: 'img-1.png', mimeType: 'image/png', width: 1024, height: 576 },
          { id: '   ' },
          'not-an-object',
          { name: 'missing-id.png' }
        ],
        endpoint: 'generations'
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.attachments).toEqual([
        { id: 'att_abc', name: 'img-1.png', mimeType: 'image/png', width: 1024, height: 576 }
      ])
      expect(block.meta?.generatedFiles).toEqual([
        { relativePath: '.deepseekgui-images/img-1.png' }
      ])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('lifts generated speech files from tool_result output into tool block meta', () => {
    const item: CoreTurnItemJson = {
      id: 'item_speech_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_speech',
      callId: 'call_speech_1',
      output: {
        files: [{
          relativePath: '.deepseekgui-audio/speech.mp3',
          absolutePath: '/tmp/project/.deepseekgui-audio/speech.mp3',
          mimeType: 'audio/mpeg',
          byteSize: 128
        }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([{
        relativePath: '.deepseekgui-audio/speech.mp3',
        absolutePath: '/tmp/project/.deepseekgui-audio/speech.mp3',
        mimeType: 'audio/mpeg',
        byteSize: 128
      }])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('does not treat generic tool_result files as generated files', () => {
    const item: CoreTurnItemJson = {
      id: 'item_read_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'read',
      callId: 'call_read_1',
      output: {
        files: [
          { path: 'src/parser.js' },
          { path: 'src/admin_system.md' }
        ]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toBeUndefined()
    } else {
      throw new Error('expected tool block')
    }
  })

  it('still trusts explicit generatedFiles from tool_result output', () => {
    const item: CoreTurnItemJson = {
      id: 'item_export_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'export_report',
      callId: 'call_export_1',
      output: {
        files: [{ path: 'src/parser.js' }],
        generatedFiles: [{ relativePath: 'reports/summary.md', mimeType: 'text/markdown' }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([
        { relativePath: 'reports/summary.md', mimeType: 'text/markdown' }
      ])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('projects top-level extension generatedArtifacts without paths or ephemeral URLs', () => {
    const item: CoreTurnItemJson = {
      id: 'item_artifact_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'video-render',
      callId: 'call_artifact_1',
      output: {
        content: { status: 'completed' },
        generatedArtifacts: [{
          schemaVersion: 1,
          artifactId: 'artifact_1234567890',
          mediaHandleId: 'media_123456789012',
          displayName: 'final.mp4',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          byteSize: 4096,
          durationMicros: 1_500_000,
          completionIdentity: 'identity_1234567890',
          availability: 'available',
          ownerExtensionId: 'kun.video-editor',
          ownerExtensionVersion: '1.0.0',
          workspaceId: 'workspace-1',
          provenance: { jobId: 'job_12345678', operation: 'video-render' }
        }]
      }
    }
    const block = chatBlockFromItem(item)
    expect(block).not.toBeNull()
    if (block && block.kind === 'tool') {
      expect(block.meta?.generatedFiles).toEqual([{
        id: 'artifact_1234567890',
        artifactId: 'artifact_1234567890',
        mediaHandleId: 'media_123456789012',
        availability: 'available',
        name: 'final.mp4',
        mimeType: 'video/mp4',
        byteSize: 4096,
        durationMicros: 1_500_000,
        mediaKind: 'video',
        completionIdentity: 'identity_1234567890',
        ownerExtensionId: 'kun.video-editor',
        ownerExtensionVersion: '1.0.0',
        workspaceId: 'workspace-1',
        provenance: { jobId: 'job_12345678', operation: 'video-render' }
      }])
    } else {
      throw new Error('expected tool block')
    }
  })

  it('omits meta attachments when tool_result output has none worth showing', () => {
    const item: CoreTurnItemJson = {
      id: 'item_img_2',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'tool',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_result',
      toolName: 'generate_image',
      callId: 'call_img_2',
      output: { attachments: 'nope' }
    }
    const block = chatBlockFromItem(item)
    if (block && block.kind === 'tool') {
      expect(block.meta?.attachments).toBeUndefined()
    } else {
      throw new Error('expected tool block')
    }
  })

  it('surfaces create_plan tool events through the event sink', () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }
    const event: CoreRuntimeEventJson = {
      kind: 'item_completed',
      seq: 5,
      item: {
        id: 'item_plan_sink',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'tool_result',
        toolName: 'create_plan',
        callId: 'call_plan_sink',
        output: {
          plan_id: 'plan_x',
          workspace_root: '/tmp/ws',
          relative_path: '.deepseekgui/plan/x.md',
          operation: 'refine',
          saved_at: '2024-01-01T00:00:01.000Z'
        }
      }
    }
    void dispatchKunRuntimeEvent(event, sink, async () => undefined)
    const capturedTool = captured as { meta?: { plan?: { plan_id?: string; operation?: string } } } | null
    expect(capturedTool).not.toBeNull()
    expect(capturedTool?.meta?.plan?.plan_id).toBe('plan_x')
    expect(capturedTool?.meta?.plan?.operation).toBe('refine')
  })
})
