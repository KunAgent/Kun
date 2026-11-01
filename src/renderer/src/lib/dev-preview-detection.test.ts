import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  extractAutoOpenDevPreviewUrls,
  extractDetectedDevPreviewUrls,
  extractLatestTurnAutoOpenDevPreviewSignal,
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls
} from './dev-preview-detection'

function user(text: string): ChatBlock {
  return { kind: 'user', id: `user:${text}`, text }
}

function assistant(text: string): ChatBlock {
  return { kind: 'assistant', id: `assistant:${text}`, text }
}

function commandExecutionBlock(input: {
  summary?: string
  detail?: string
  status?: 'running' | 'success' | 'error'
  command: string
}): ChatBlock {
  return {
    kind: 'tool',
    id: `tool:${input.command}`,
    summary: input.summary ?? input.command,
    detail: input.detail,
    status: input.status ?? 'success',
    toolKind: 'command_execution',
    meta: { command: input.command }
  }
}

describe('dev preview detection', () => {
  it('ignores architectural explanations that only mention preview config and localhost', () => {
    const blocks: ChatBlock[] = [
      user('explain the project'),
      assistant(
        [
          '开发预览 URL 白名单',
          '',
          '- 允许的来源包括 `http://localhost:5173` 和 `http://127.0.0.1:5173`。',
          '- 这里主要是配置说明，不是在提示你打开页面。'
        ].join('\n')
      )
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual([])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('shows a preview card for explicit assistant navigation hints without auto-opening', () => {
    const blocks: ChatBlock[] = [
      user('where is the frontend'),
      assistant('前端现在运行在 http://localhost:3000 ，你可以直接访问看看。')
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual(['http://localhost:3000/'])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('never auto-opens assistant explanations or quoted server output', () => {
    const blocks = [user('explain this log'), assistant('Example output:\nLocal: http://localhost:5173/\nready in 100 ms')]
    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual(['http://localhost:5173/'])
    expect(extractLatestTurnAutoOpenDevPreviewSignal(blocks)).toBeNull()
  })

  it.each(['read', 'grep', 'fast_context'])('does not auto-open %s results containing server logs', (toolName) => {
    const block: ChatBlock = {
      kind: 'tool', id: toolName, summary: toolName, status: 'success',
      detail: 'Local: http://localhost:5173/\nready in 100 ms',
      meta: { toolName }
    }
    expect(extractAutoOpenDevPreviewUrls([block])).toEqual([])
  })

  it.each([
    'cat README.md',
    'grep "npm run dev" README.md',
    'rg "VITE|npm run dev" README.md',
    'cat README.md # ; npm run dev',
    'printf "Local: http://localhost:5173/"',
    'curl http://localhost:5173/'
  ])('does not treat inspected output from %s as a server launch', (command) => {
    expect(extractAutoOpenDevPreviewUrls([commandExecutionBlock({
      command, detail: 'Local: http://localhost:5173/\nready in 100 ms'
    })])).toEqual([])
  })

  it('requires a result rather than command arguments or summary', () => {
    const block = commandExecutionBlock({ command: 'npm run dev', summary: 'Local: http://localhost:5173/' })
    expect(extractAutoOpenDevPreviewUrls([block])).toEqual([])
    if (block.kind !== 'tool') throw new Error('Expected tool')
    block.detail = JSON.stringify({ command: 'npm run dev # Local: http://localhost:5173/' })
    expect(extractAutoOpenDevPreviewUrls([block])).toEqual([])
    block.detail = 'Local: http://localhost:5173/'
    block.meta = { ...block.meta, sourceItemKind: 'tool_call' }
    expect(extractAutoOpenDevPreviewUrls([block])).toEqual([])
  })

  it('accepts structured command output and ignores unrelated URLs in the same result', () => {
    const block = commandExecutionBlock({
      command: 'cd /app && PORT=5173 npm run dev',
      detail: JSON.stringify({
        command: 'npm run dev',
        output: 'proxy target http://localhost:9000/\nLocal: http://localhost:5173/\nready in 100 ms'
      })
    })
    expect(extractAutoOpenDevPreviewUrls([block])).toEqual(['http://localhost:5173/'])
  })

  it('does not auto-open failed commands even if they contain a startup log', () => {
    expect(extractAutoOpenDevPreviewUrls([commandExecutionBlock({
      command: 'npm run dev', status: 'error', detail: 'Local: http://localhost:5173/\nError: server stopped'
    })])).toEqual([])
  })

  it('auto-opens when a dev server command announces a local URL', () => {
    const blocks: ChatBlock[] = [
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'running',
        detail: 'VITE v5.4.0  ready in 180 ms\n  Local:   http://localhost:5173/\n'
      })
    ]

    expect(extractDetectedDevPreviewUrls(blocks)).toEqual(['http://localhost:5173/'])
    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual(['http://localhost:5173/'])
  })

  it('qualifies the same auto-open URL by its latest user turn', () => {
    const firstTurn: ChatBlock[] = [
      user('start the app'),
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'running',
        detail: 'VITE v5.4.0 ready in 180 ms\nLocal: http://localhost:5173/'
      })
    ]
    const secondTurn: ChatBlock[] = [
      ...firstTurn,
      user('restart the app'),
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'running',
        detail: 'VITE v5.4.0 ready in 160 ms\nLocal: http://localhost:5173/'
      })
    ]

    expect(extractLatestTurnAutoOpenDevPreviewSignal(firstTurn)).toEqual({
      turnId: 'user:start the app',
      url: 'http://localhost:5173/'
    })
    expect(extractLatestTurnAutoOpenDevPreviewSignal(secondTurn)).toEqual({
      turnId: 'user:restart the app',
      url: 'http://localhost:5173/'
    })
  })

  it('ignores runtime API URLs even when they are local', () => {
    const blocks: ChatBlock[] = [
      user('how does the runtime work'),
      assistant('GUI 通过 runtime:request 请求 http://localhost:3000/v1/threads 来拉取线程列表。')
    ]

    expect(extractLatestTurnDevPreviewUrls(blocks)).toEqual([])
    expect(extractLatestTurnAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('does not auto-open failed dev server commands that only expose a bound port', () => {
    const blocks: ChatBlock[] = [
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'error',
        detail: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3000'
      })
    ]

    expect(extractDetectedDevPreviewUrls(blocks)).toEqual([])
    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('does not auto-open a bare 127.0.0.1 mention without scheme or port', () => {
    const blocks: ChatBlock[] = [
      user('check the logs'),
      commandExecutionBlock({
        command: 'npm run dev',
        status: 'success',
        detail: 'ready in 200 ms\nproxy target 127.0.0.1 refused the connection'
      })
    ]

    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })

  it('does not auto-open when the command text only appears in tool meta', () => {
    const blocks: ChatBlock[] = [
      user('inspect runtime health'),
      commandExecutionBlock({
        command: 'curl http://127.0.0.1:18899/health',
        status: 'success',
        detail: '{"ok":true}'
      })
    ]

    expect(extractAutoOpenDevPreviewUrls(blocks)).toEqual([])
  })
})
