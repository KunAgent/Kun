import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from './capability-registry.js'
import {
  buildDiagramVisualizationToolProvider,
  DIAGRAM_VISUALIZATION_TOOL_NAME,
  hardenDiagramHtml,
  normalizeDiagramPath
} from './diagram-visualization-tool-provider.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const svg = '<svg role="img" aria-labelledby="diagram-title"><title id="diagram-title">Release flow</title><desc>Build then ship.</desc><path d="M0 0h10" /></svg>'
const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><main data-kun-diagram-root><h1>Release flow</h1>${svg}</main></body></html>`

function context(workspace: string, clientSurface: ToolHostContext['clientSurface'] = 'gui'): ToolHostContext {
  return {
    threadId: 'thread-1', turnId: 'turn-1', workspace, clientSurface, threadMode: 'agent',
    approvalPolicy: 'auto', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('show_diagram provider', () => {
  it('is gated by lab.conversationVisualization and GUI surface', () => {
    let enabled = false
    const registry = new CapabilityRegistry(buildDiagramVisualizationToolProvider(() => ({ enabled })))
    expect(registry.listTools(context('/workspace'))).toEqual([])
    enabled = true
    expect(registry.listTools(context('/workspace')).map((tool) => tool.name)).toContain(DIAGRAM_VISUALIZATION_TOOL_NAME)
    expect(registry.listTools(context('/workspace', 'tui'))).toEqual([])
  })

  it('publishes direct HTML with status metadata, hash, and hardened CSP', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-diagram-direct-'))
    const updates: unknown[] = []
    const tool = buildDiagramVisualizationToolProvider(() => ({ enabled: true }))[0]!.tools[0]!
    const result = await tool.execute({ title: 'Release flow', diagramType: 'flowchart', html }, context(workspace), (update) => {
      updates.push(update)
    })
    expect(result).toMatchObject({ output: { status: 'completed', diagramPrototype: {
      status: 'completed', producer: 'main-agent', diagramType: 'flowchart', byteSize: expect.any(Number), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    } } })
    expect(updates).toHaveLength(1)
    const output = result.output as { diagramPrototype: { relativePath: string } }
    const saved = await readFile(join(workspace, output.diagramPrototype.relativePath), 'utf8')
    expect(saved).toContain('default-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'')
    expect(saved).not.toContain('default-src *')
  })

  it('reads and rewrites an existing artifactPath inside the dedicated directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-diagram-artifact-'))
    const relativePath = '.kun-design/diagram-prototypes/release/diagram.html'
    const absolutePath = join(workspace, relativePath)
    await (await import('node:fs/promises')).mkdir(join(workspace, '.kun-design/diagram-prototypes/release'), { recursive: true })
    await (await import('node:fs/promises')).writeFile(absolutePath, html)
    const tool = buildDiagramVisualizationToolProvider(() => ({ enabled: true }))[0]!.tools[0]!
    const result = await tool.execute({ title: 'Existing', diagramType: 'architecture', artifactPath: relativePath }, context(workspace))
    expect(result).toMatchObject({ output: { status: 'completed', diagramPrototype: { relativePath } } })
    expect(await readFile(absolutePath, 'utf8')).toContain('Content-Security-Policy')
  })

  it('delegates requests to the dedicated diagram-designer profile in a confined workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-diagram-delegated-'))
    const calls: Array<Record<string, unknown>> = []
    const runtime = {
      enabled: () => true,
      runChild: async (input: Record<string, unknown>) => {
        calls.push(input)
        await writeFile(join(input.workspace as string, 'diagram.html'), html)
        return { id: 'child-diagram', status: 'completed', summary: 'Generated the release diagram.' }
      }
    } as never
    const updates: unknown[] = []
    const tool = buildDiagramVisualizationToolProvider(() => ({ enabled: true }), runtime)[0]!.tools[0]!
    const result = await tool.execute({ title: 'Release flow', diagramType: 'flowchart', request: 'Show build to ship.' }, context(workspace), (update) => {
      updates.push(update)
    })
    expect(calls[0]).toMatchObject({
      launcher: 'diagram_design', profile: 'diagram-designer', agentSurface: 'design',
      sandboxMode: 'workspace-write', security: { memoryEnabled: false }
    })
    expect(calls[0]?.workspace).toEqual(expect.stringContaining(join('.kun-design', 'diagram-prototypes')))
    expect(result).toMatchObject({ output: { status: 'completed', diagramPrototype: {
      producer: 'diagram-designer', profile: 'diagram-designer', childId: 'child-diagram',
      summary: 'Generated the release diagram.'
    } } })
    expect(updates.map((entry: any) => entry.output.diagramPrototype.status)).toEqual(['preparing', 'running'])
  })

  it('rejects unsafe paths, embeds, missing accessibility, and scripts', () => {
    expect(() => normalizeDiagramPath('.kun-design/diagram-prototypes/../x/diagram.html')).toThrow()
    expect(() => hardenDiagramHtml(html.replace('<svg ', '<iframe src="https://evil.test"></iframe><svg '))).toThrow(/forbidden/)
    expect(() => hardenDiagramHtml(html.replace('aria-labelledby="diagram-title"', ''))).toThrow(/aria-labelledby/)
    expect(() => hardenDiagramHtml(html.replace('<desc>Build then ship.</desc>', '<desc></desc>'))).toThrow(/title and desc/)
    expect(() => hardenDiagramHtml(html.replace('</svg>', '<script>alert(1)</script></svg>'))).toThrow(/remote|script|network|CSP/i)
  })
})
