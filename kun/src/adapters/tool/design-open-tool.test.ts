import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDesignCanvasLocalTools } from './design-canvas-tool.js'
import { modelToolDiscoveryContexts } from '../../loop/tool-discovery-context-factory.js'
import {
  createDesignOpenTool,
  DESIGN_OPEN_TOOL_NAME,
  designOpenDocumentId,
  designOpenRequestId,
  designOpenScreenId,
  normalizeDesignScreenHtml,
  shouldAdvertiseDesignOpen
} from './design-open-tool.js'

function codeContext(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    clientSurface: 'gui',
    agentSurface: 'code',
    activeToolCallId: 'call_1',
    ...overrides
  }
}

describe('design_open tool', () => {
  it('is registered with the design canvas local tools', () => {
    expect(buildDesignCanvasLocalTools().map((tool) => tool.name)).toContain(DESIGN_OPEN_TOOL_NAME)
  })

  it('advertises only on Kun-native GUI Code turns', () => {
    expect(shouldAdvertiseDesignOpen(codeContext())).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ harnessId: 'kun' }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ clientSurface: 'api' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ clientSurface: 'tui' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: 'design' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: 'write' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: undefined }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ threadMode: 'plan' }))).toBe(false)
    // A Code whiteboard turn is still a Code turn.
    expect(shouldAdvertiseDesignOpen(codeContext({ guiDesignCanvas: true }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ guiExcalidrawCanvas: true }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ guiDesignMode: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ imContext: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ roomStepKind: 'conversation' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ roomAgent: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ executionUnitKind: 'worker' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ harnessId: 'claude-code' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ workspace: '  ' }))).toBe(false)
  })

  it('stays in the cache-stable GUI catalog but only executes in a real Code turn', () => {
    const codeTurn = codeContext({ threadMode: 'agent' })
    const designTurn = codeContext({
      threadMode: 'agent', agentSurface: 'design', guiDesignCanvas: true, guiDesignMode: true
    })
    for (const turn of [codeTurn, designTurn]) {
      const listing = modelToolDiscoveryContexts(turn)
      expect(listing.length).toBeGreaterThan(1)
      expect(listing.some(shouldAdvertiseDesignOpen)).toBe(true)
    }
    expect(shouldAdvertiseDesignOpen(codeTurn)).toBe(true)
    expect(shouldAdvertiseDesignOpen(designTurn)).toBe(false)
  })

  it('writes every screen into a stable design document in the same turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-design-open-'))
    try {
      const context = codeContext({ workspace })
      const result = await createDesignOpenTool().execute({
        title: '  Update entry redesign  ',
        target: 'app',
        note: 'Pill moves next to the account row.',
        screens: [
          { name: 'Sidebar footer', html: '<!doctype html><html><body><p>Footer</p></body></html>' },
          { name: 'Update ready', html: '<div class="pill">Update ready</div>', width: 420, height: 9000 }
        ]
      }, context)
      expect(result.isError).toBeUndefined()
      const documentId = designOpenDocumentId('thread_1', 'update ENTRY  redesign')
      const footerId = designOpenScreenId(documentId, 'Sidebar footer')
      expect(result.output).toMatchObject({
        ok: true,
        status: 'ready',
        designRequest: {
          version: 2,
          requestId: designOpenRequestId(context, documentId),
          status: 'ready',
          title: 'Update entry redesign',
          documentId,
          target: 'app',
          note: 'Pill moves next to the account row.',
          screens: [
            { artifactId: footerId, name: 'Sidebar footer', relativePath: `.kun-design/${documentId}/${footerId}/v1.html`, width: 390, height: 844 },
            { name: 'Update ready', width: 420, height: 4000 }
          ]
        }
      })
      expect(await readFile(join(workspace, `.kun-design/${documentId}/${footerId}/v1.html`), 'utf8')).toContain('<p>Footer</p>')
      const request = (result.output as { designRequest: { screens: { relativePath: string }[] } }).designRequest
      const wrapped = await readFile(join(workspace, request.screens[1].relativePath), 'utf8')
      expect(wrapped).toContain('<!doctype html>')
      expect(wrapped).toContain('<div class="pill">Update ready</div>')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rewrites a screen in place when called again with the same title and name', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-design-open-'))
    try {
      const tool = createDesignOpenTool()
      const call = (html: string, turnId: string) => tool.execute(
        { title: 'Login', screens: [{ name: 'Sign in', html }] },
        codeContext({ workspace, turnId })
      )
      const first = (await call('<html><body>v1</body></html>', 'turn_1')).output as { designRequest: { screens: { relativePath: string }[]; requestId: string } }
      const second = (await call('<html><body>v2</body></html>', 'turn_2')).output as { designRequest: { screens: { relativePath: string }[]; requestId: string } }
      expect(second.designRequest.screens[0].relativePath).toBe(first.designRequest.screens[0].relativePath)
      expect(second.designRequest.requestId).not.toBe(first.designRequest.requestId)
      expect(await readFile(join(workspace, second.designRequest.screens[0].relativePath), 'utf8')).toContain('v2')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects a missing title, empty screens, blank html and duplicate names', async () => {
    const tool = createDesignOpenTool()
    const screen = { name: 'A', html: '<p>a</p>' }
    expect((await tool.execute({ screens: [screen] }, codeContext())).isError).toBe(true)
    expect((await tool.execute({ title: 'X', screens: [] }, codeContext())).isError).toBe(true)
    expect((await tool.execute({ title: 'X', screens: [{ name: 'A', html: '  ' }] }, codeContext())).isError).toBe(true)
    expect((await tool.execute({ title: 'X', screens: [screen, { ...screen, name: ' a ' }] }, codeContext())).isError).toBe(true)
  })

  it('wraps fragments into a standalone document and keeps full documents', () => {
    expect(normalizeDesignScreenHtml('<main>Hi</main>')).toMatch(/^<!doctype html>[\s\S]*<main>Hi<\/main>[\s\S]*<\/html>\n$/)
    expect(normalizeDesignScreenHtml('<html lang="en"><body>x</body></html>')).toBe('<html lang="en"><body>x</body></html>\n')
  })

  it('derives a different request id per tool call', () => {
    const first = designOpenRequestId(codeContext(), 'doc')
    const second = designOpenRequestId(codeContext({ activeToolCallId: 'call_2' }), 'doc')
    expect(first).toMatch(/^design_[0-9a-f]{16}$/)
    expect(first).not.toBe(second)
  })
})
