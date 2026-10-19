import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GEN_UI_TOOL_NAME } from '../../contracts/gen-ui.js'
import { GenUiStore } from '../../gen-ui/gen-ui-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildGenUiToolProvider, normalizeGenUiFragment } from './gen-ui-tool-provider.js'

function context(workspace: string, clientSurface: ToolHostContext['clientSurface'] = 'gui'): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace,
    clientSurface,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('render_widget provider', () => {
  let root: string
  let store: GenUiStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-gen-ui-tool-'))
    store = new GenUiStore(join(root, 'data'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('is advertised only when enabled and only on the desktop GUI surface', () => {
    let enabled = false
    const registry = new CapabilityRegistry(buildGenUiToolProvider(() => ({ enabled }), () => store))
    expect(registry.listTools(context(root))).toEqual([])
    enabled = true
    expect(registry.listTools(context(root)).map((tool) => tool.name)).toContain(GEN_UI_TOOL_NAME)
    expect(registry.listTools(context(root, 'tui'))).toEqual([])
    expect(registry.listTools(context(root, 'im'))).toEqual([])
  })

  it('stores the fragment and returns the widget reference only in the UI sideband', async () => {
    const tool = buildGenUiToolProvider(() => ({ enabled: true }), () => store)[0]!.tools[0]!
    const result = await tool.execute({ title: 'Sine explorer', html: '<div id="w">x</div>' }, context(root))
    expect(result.isError).toBeUndefined()
    expect(result.output).toEqual({ status: 'completed', summary: 'Displayed the interactive widget "Sine explorer" to the user.' })
    const genUi = (result.meta as { genUi: { widgetId: string; mode: string; title: string } }).genUi
    expect(genUi).toMatchObject({ title: 'Sine explorer', mode: 'inline' })
    expect(await store.readWidget(genUi.widgetId)).toBe('<div id="w">x</div>')
  })

  it('reads workspace .html files but refuses other extensions and paths outside the workspace', async () => {
    const tool = buildGenUiToolProvider(() => ({ enabled: true }), () => store)[0]!.tools[0]!
    const workspace = join(root, 'ws')
    await rm(workspace, { recursive: true, force: true })
    await import('node:fs/promises').then((fs) => fs.mkdir(workspace, { recursive: true }))
    await writeFile(join(workspace, 'demo.html'), '<!doctype html><html><head><style>p{}</style></head><body><p>hi</p></body></html>')
    await writeFile(join(workspace, 'notes.txt'), 'text')
    const ok = await tool.execute({ title: 'Demo', path: 'demo.html', mode: 'wide' }, context(workspace))
    const widgetId = (ok.meta as { genUi: { widgetId: string; mode: string } }).genUi.widgetId
    expect((ok.meta as { genUi: { mode: string } }).genUi.mode).toBe('wide')
    expect(await store.readWidget(widgetId)).toBe('<style>p{}</style>\n<p>hi</p>')
    await expect(tool.execute({ title: 'Bad', path: 'notes.txt' }, context(workspace)))
      .resolves.toMatchObject({ isError: true })
    await expect(tool.execute({ title: 'Bad', path: join(root, 'outside.html') }, context(workspace)))
      .resolves.toMatchObject({ isError: true })
  })

  it('fails closed when disabled or given invalid input', async () => {
    let enabled = false
    const tool = buildGenUiToolProvider(() => ({ enabled }), () => store)[0]!.tools[0]!
    await expect(tool.execute({ title: 'x', html: '<p/>' }, context(root))).resolves.toMatchObject({ isError: true })
    enabled = true
    await expect(tool.execute({ title: 'x' }, context(root))).resolves.toMatchObject({ isError: true })
    await expect(tool.execute({ title: 'x', html: ' ' }, context(root))).resolves.toMatchObject({ isError: true })
  })

  it('keeps fragments as-is and extracts head assets plus body from full documents', () => {
    expect(normalizeGenUiFragment('  <div>x</div> ')).toBe('<div>x</div>')
    expect(normalizeGenUiFragment('<html><head><title>t</title><script src="a.js"></script></head><body><b>y</b></body></html>'))
      .toBe('<script src="a.js"></script>\n<b>y</b>')
  })
})
