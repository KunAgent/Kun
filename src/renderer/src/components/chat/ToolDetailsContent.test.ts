// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolPresentation } from '@shared/tool-presentation'
import { ToolDetailsContent } from './ToolDetailsContent'
import { ToolBlockDetails } from './ToolBlockDetails'
import { WORKSPACE_FILE_PREVIEW_EVENT } from '../../lib/workspace-file-preview'
import { clearFileReferenceValidationCache } from '../../lib/file-reference-validation'

const mocks = vi.hoisted(() => ({ highlight: vi.fn(), external: vi.fn(), clipboard: vi.fn(), resolve: vi.fn() }))
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${Object.values(values).join(' ')}` : key }) }))
vi.mock('../../lib/code-highlighting', () => ({
  languageFromFilePath: (path: string) => path.endsWith('.ts') ? 'ts' : '',
  renderFallbackCodeHtml: (text: string) => `<pre><code>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>`,
  highlightCodeHtml: mocks.highlight
}))
const presentation = (fields: Partial<ToolPresentation> = {}): ToolPresentation => ({
  version: 1, kind: 'unknown', state: 'completed', canCancel: false, ...fields
})

describe('shared structured tool evidence', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    mocks.highlight.mockReset().mockImplementation(async (text: string) => `<pre><code>${text.replaceAll('<', '&lt;')}</code></pre>`)
    mocks.external.mockReset().mockResolvedValue(undefined)
    mocks.clipboard.mockReset().mockResolvedValue(undefined)
    mocks.resolve.mockReset().mockImplementation(async ({ path }: { path: string }) => ({ ok: true, path }))
    clearFileReferenceValidationCache()
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { openExternal: mocks.external, resolveWorkspaceFile: mocks.resolve } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } })
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  const render = async (value: ToolPresentation): Promise<void> => {
    await act(async () => root.render(createElement(ToolDetailsContent, { presentation: value, workspaceRoot: '/repo' })))
  }
  const open = async (title: string): Promise<HTMLDetailsElement> => {
    const node = [...container.querySelectorAll('details')].find((entry) => entry.querySelector('summary')?.textContent === title)!
    expect(node).toBeDefined()
    await act(async () => { node.open = true; node.dispatchEvent(new Event('toggle')) })
    return node
  }

  it('shows real read lines and syntax highlighting while opening the recorded workspace/line', async () => {
    const preview = vi.fn()
    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, preview)
    await render(presentation({ kind: 'read', filePath: 'src/read.ts', line: 42, offset: 42, fileContent: 'const answer = 42\nanswer', input: { path: 'src/read.ts', limit: 2 } }))
    expect(container.querySelector('[data-tool-line-numbers]')?.textContent).toBe('42\n43')
    expect(container.textContent).not.toContain('"limit"')
    expect(mocks.resolve).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(100))
    expect(mocks.highlight).toHaveBeenCalledWith('const answer = 42\nanswer', 'ts')
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="toolDetails.openFile"]')!.click())
    expect((preview.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/read.ts', line: 42, workspaceRoot: '/repo' })
    await open('toolDetails.input')
    expect(container.textContent).toContain('"limit": 2')
    window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, preview)
  })

  it('retains every terminal command, output and exit/signal alongside diffs and explanation', async () => {
    await render(presentation({ kind: 'edit', cwd: '/repo', command: 'build',
      diffs: [{ path: 'file.ts', oldText: 'before\n', newText: 'after\n' }], text: 'Updated the generated file.',
      terminals: [{ terminalId: 'one', command: 'build', output: 'build output', exitCode: 0 },
        { terminalId: 'two', command: 'test', cwd: '/repo/tests', output: 'test output', signal: 'SIGTERM' }] }))
    expect(container.querySelectorAll('[data-tool-terminal]')).toHaveLength(2)
    for (const text of ['build output', 'test output', '$ test', 'toolDetails.exit 0', 'SIGTERM', 'Updated the generated file.', '/repo/tests']) {
      expect(container.textContent).toContain(text)
    }
    expect(container.querySelector('[data-tool-diff]')).not.toBeNull()
  })

  it('renders file/search and web results with user-activated links, and fetch status/body', async () => {
    await render(presentation({ kind: 'search', query: 'agent loop', results: [
      { path: 'src/loop.ts', line: 19, text: 'runAgentLoop()' },
      { url: 'https://example.com/docs', title: 'API docs', text: 'Find the agent API here.' }
    ] }))
    expect(container.textContent).toContain('src/loop.ts:19')
    expect(container.textContent).toContain('runAgentLoop()')
    expect(mocks.external).not.toHaveBeenCalled()
    await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click())
    expect(mocks.external).toHaveBeenCalledWith('https://example.com/docs')
    await render(presentation({ kind: 'fetch', url: 'https://example.com/page', statusCode: 404, text: 'Page missing' }))
    expect(container.textContent).toContain('toolDetails.status 404')
    expect(container.textContent).toContain('Page missing')
  })

  it('renders a native edit patch while keeping its explanatory text', async () => {
    await render(presentation({ kind: 'edit', filePath: 'native.ts', text: 'One function updated.',
      patch: '--- a/native.ts\n+++ b/native.ts\n@@ -1 +1 @@\n-before\n+after\n' }))
    expect(container.textContent).toContain('One function updated.')
    expect(container.querySelector('table')?.textContent).toContain('+after')
  })

  it('preserves MCP identity and independent input/output/error without mounting closed payloads', async () => {
    await render(presentation({ kind: 'mcp', server: 'docs', name: 'lookup', input: { query: 'original-query' },
      output: { result: 'partial-result' }, state: 'failed', error: 'Request failed' }))
    expect(container.querySelector('[data-tool-identity]')?.textContent).toBe('docs / lookup')
    expect(container.textContent).toContain('Request failed')
    expect(container.textContent).not.toContain('original-query')
    expect(container.textContent).not.toContain('partial-result')
    await open('toolDetails.input'); await open('toolDetails.output')
    expect(container.textContent).toContain('original-query')
    expect(container.textContent).toContain('partial-result')
  })

  it('keeps cancellation reasons neutral and represents an empty read as a real file', async () => {
    await render(presentation({ state: 'canceled', error: 'Stopped by the user' }))
    expect(container.querySelector('[data-tool-payload="error"]')).toBeNull()
    expect(container.textContent).toContain('toolStateCanceled')
    await render(presentation({ kind: 'read', fileContent: '', filePath: 'empty.txt' }))
    expect(container.querySelector('[data-tool-code-evidence]')).not.toBeNull()
    expect(container.textContent).not.toContain('toolDetails.empty')
  })

  it('never auto-fetches remote tool media or executes HTML/SVG content', async () => {
    await render(presentation({ kind: 'mcp', content: [
      { type: 'image', uri: 'https://example.com/remote.png', mimeType: 'image/png' },
      { type: 'image', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' },
      { type: 'resource', resource: { uri: 'javascript:alert(1)', mimeType: 'text/html', text: '<script>alert(1)</script><img src="https://example.com/leak">' } },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    ] }))
    const images = [...container.querySelectorAll('img')]
    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(container.querySelector('script, iframe, object, svg script')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(mocks.external).not.toHaveBeenCalled()
  })

  it('bounds a long read initially, reveals more on demand and copies the original content', async () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `line-${index + 1}`).join('\n')
    await render(presentation({ kind: 'read', fileContent: text }))
    expect(container.textContent).toContain('line-120')
    expect(container.textContent).not.toContain('line-121')
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'toolDetails.showMore')!.click())
    expect(container.textContent).toContain('line-240')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="toolDetails.copy"]')!.click())
    expect(mocks.clipboard).toHaveBeenCalledWith(text)
  })

  it('loads inline audio only after preview and offers safe explicit binary downloads', async () => {
    const createUrl = vi.fn().mockReturnValue('blob:retained-tool-content')
    const revokeUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('audio.wav')
      expect(this.href).toBe('blob:retained-tool-content')
    })
    await render(presentation({ content: [{ type: 'audio', name: '../../audio.wav', data: 'aGVsbG8=', mimeType: 'audio/wav' }] }))
    expect(container.querySelector('audio')).toBeNull()
    expect(createUrl).not.toHaveBeenCalled()
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'toolDetails.previewAudio')!.click())
    const audio = container.querySelector('audio')!
    expect(audio.preload).toBe('none')
    expect(audio.autoplay).toBe(false)
    expect(audio.src).toBe('data:audio/wav;base64,aGVsbG8=')
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'toolDetails.download')!.click())
    expect(createUrl.mock.calls[0][0].type).toBe('application/octet-stream')
    expect(download).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(revokeUrl).toHaveBeenCalledWith('blob:retained-tool-content')
    await render(presentation({ truncated: true, content: [{ type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' }] }))
    expect(container.querySelector('audio')).toBeNull()
    expect(container.textContent).not.toContain('toolDetails.download')
    expect(container.textContent).toContain('toolDetails.binaryUnavailable')
  })

  it('opens the same evidence in a wide dialog and returns to the inline view', async () => {
    await act(async () => root.render(createElement(ToolBlockDetails, { block: {
      kind: 'tool', id: 'native-read', summary: 'Read file', status: 'success', meta: {
        toolPresentation: presentation({ kind: 'read', fileContent: 'viewer evidence', filePath: 'README.md' })
      }
    } })))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'toolDetails.expand')!.click())
    expect(document.querySelector('dialog[open]')?.textContent).toContain('viewer evidence')
    await act(async () => document.querySelector<HTMLButtonElement>('dialog button[aria-label="toolDetails.close"]')!.click())
    expect(document.querySelector('dialog')).toBeNull()
    expect(container.textContent).toContain('viewer evidence')
  })
})
