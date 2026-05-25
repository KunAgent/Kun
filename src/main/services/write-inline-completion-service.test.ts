import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import {
  buildWriteInlineCompletionPrompt,
  requestWriteInlineCompletion
} from './write-inline-completion-service'
import { clearWriteRetrievalCache } from './write-retrieval-service'

function createSettings(patch: Partial<AppSettingsV1['write']['inlineCompletion']> = {}): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agentProvider: 'deepseek-runtime',
    deepseek: {
      binaryPath: '',
      port: 7878,
      autoStart: true,
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/beta',
      runtimeToken: '',
      extraCorsOrigins: [],
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    write: {
      ...write,
      inlineCompletion: {
        ...write.inlineCompletion,
        ...patch
      }
    },
    guiUpdate: {
      channel: 'stable'
    },
    claw: defaultClawSettings()
  }
}

function createRequest(): WriteInlineCompletionRequest {
  return {
    prefix: '# Draft\n\nThis is',
    suffix: ' a test.',
    currentFilePath: '/tmp/workspace/draft.md',
    cursor: {
      line: 3,
      column: 7
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'This is',
      currentLineSuffix: ' a test.',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: false,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'This is',
      documentTail: '# Draft This is'
    },
    model: 'deepseek-v4-flash'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearWriteRetrievalCache()
})

describe('requestWriteInlineCompletion', () => {
  it('calls DeepSeek FIM completions directly instead of chat completions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' only a test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ maxTokens: 64 }), createRequest())

    expect(result).toEqual({
      ok: true,
      completion: ' only a test',
      model: 'deepseek-v4-flash',
      mode: 'short'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/beta/completions')
    expect(url).not.toContain('/chat/completions')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test'
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      prompt: '# Draft\n\nThis is',
      suffix: ' a test.',
      max_tokens: 64
    })
  })

  it('does not request the API when inline completion is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ enabled: false }), createRequest())

    expect(result).toEqual({ ok: false, message: 'Inline completion is disabled.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves an explicit pro completion model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' flash text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      model: 'deepseek-v4-pro'
    }
    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-pro'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-pro'
    })
  })

  it('uses the long-completion prompt and token budget for inspiration mode', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: '\n\nA longer continuation.' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      mode: 'long' as const,
      suffix: '',
      context: {
        ...createRequest().context,
        currentLineSuffix: ''
      }
    }
    const result = await requestWriteInlineCompletion(
      createSettings({ longMaxTokens: 320 }),
      request
    )

    expect(result).toMatchObject({
      ok: true,
      mode: 'long'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string; max_tokens: number }
    expect(body.max_tokens).toBe(320)
    expect(body.prompt).toContain('inline completion mode: long inspiration')
    expect(body.prompt.endsWith(request.prefix)).toBe(true)
  })

  it('adds BM25 retrieval snippets to the FIM prompt when workspace context is available', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-write-rag-'))
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'notes', 'retrieval.md'),
      [
        '# RAG notes',
        '',
        'BM25 keyword retrieval keeps inline completion grounded in project terminology.',
        'Use retrieved snippets as reference-only context for local text completion.'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, 'draft.md'),
      '# Draft\n\nBM25 keyword',
      'utf8'
    )

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' retrieval can improve continuity' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      workspaceRoot,
      currentFilePath: join(workspaceRoot, 'draft.md'),
      prefix: '# Draft\n\nBM25 keyword',
      suffix: '',
      context: {
        ...createRequest().context,
        currentLinePrefix: 'BM25 keyword',
        currentLineSuffix: '',
        previousNonEmptyLine: '# Draft'
      },
      preview: {
        local: 'BM25 keyword',
        documentTail: '# Draft BM25 keyword'
      }
    }

    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({ ok: true })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { prompt: string }
    expect(body.prompt).toContain('DeepSeek GUI inline completion references')
    expect(body.prompt).toContain('notes/retrieval.md')
    expect(body.prompt).toContain('BM25 keyword retrieval keeps inline completion grounded')
    expect(body.prompt.endsWith(request.prefix)).toBe(true)
  })

  it('leaves the prompt untouched when retrieval has no snippets', () => {
    const request = createRequest()

    expect(buildWriteInlineCompletionPrompt(request, null)).toBe(request.prefix)
  })
})
