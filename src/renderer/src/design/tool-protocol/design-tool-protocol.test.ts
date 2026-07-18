import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, ROOT_SHAPE_ID } from '../canvas/canvas-types'
import { createRunningAppFrameShape } from '../canvas/running-app-frame'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { useDesignSystemStore } from '../canvas/design-system-store'
import { setScreenCreationFactory } from '../canvas/screen-artifact-bridge'
import { clearDesignOperationJournal } from '../graph/design-operation-journal'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import type { DesignDocument } from '../design-types'
import {
  buildDesignToolProtocolManifest,
  designToolProtocolById,
  designToolProtocolSummaryLines,
  executeDesignToolInvocation
} from './design-tool-protocol'

const createdAt = '2026-07-02T00:00:00.000Z'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useDesignSystemStore.getState().resetSystem()
  setScreenCreationFactory(null)
  useDesignWorkspaceStore.setState({
    workspaceRoot: '',
    documents: [],
    activeDocumentId: null,
    artifacts: [],
    activeArtifactId: null,
    designContext: { designTarget: 'web' },
    parallelPageStates: {},
    pagesRun: null
  })
  clearDesignOperationJournal()
})

describe('design tool protocol', () => {
  it('exposes the Stitch-style design tool surface as a stable manifest', () => {
    const manifest = buildDesignToolProtocolManifest()

    expect(manifest).toMatchObject({
      version: 1,
      kind: 'kun.design.tool-protocol',
      source: 'kun-design-mode'
    })
    expect(manifest.tools.map((tool) => tool.id)).toEqual([
      'design.plan',
      'design.ops',
      'design_motion_set_timeline',
      'design_motion_upsert_keyframes',
      'design_motion_apply_preset',
      'design_motion_delete',
      'design.generate_screen',
      'design.generate_directions',
      'design_svg_create',
      'design_svg_inspect',
      'design_svg_edit',
      'design_svg_animate',
      'design_svg_validate',
      'design.critique',
      'design.repair',
      'design.system',
      'design.bind_code',
      'design.implement',
      'design.export'
    ])
    expect(designToolProtocolById('design.system')).toMatchObject({
      category: 'system',
      operationTypes: ['define_token', 'apply_token', 'define_component', 'instantiate_component', 'lint_design']
    })
    expect(designToolProtocolById('design.implement')?.requiresCodeBinding).toBe(true)
    expect(designToolProtocolById('design_svg_animate')).toMatchObject({ category: 'operations' })
    expect(designToolProtocolById('design_motion_upsert_keyframes')).toMatchObject({
      category: 'operations',
      operationTypes: ['upsert-keyframes']
    })
    expect(designToolProtocolById('design_svg_create')).toMatchObject({
      inputs: ['name', 'brief', 'frame geometry'],
      outputs: expect.arrayContaining(['deterministic artifact id'])
    })
  })

  it('formats concise agent contract lines', () => {
    expect(designToolProtocolSummaryLines().join('\n')).toContain(
      'design.critique (review): Evaluate selected frames or flows'
    )
    expect(designToolProtocolSummaryLines().join('\n')).toContain('selection required')
    expect(designToolProtocolSummaryLines().join('\n')).toContain('code binding required')
    expect(designToolProtocolSummaryLines().join('\n')).toContain('design_motion_apply_preset')
  })

  it('executes design.ops against the canvas and returns the journal entry', () => {
    const result = executeDesignToolInvocation({
      toolId: 'design.ops',
      label: 'agent-create-card',
      input: {
        ops: [{
          op: 'add',
          shape: {
            type: 'rect',
            name: 'Card',
            x: 24,
            y: 32,
            width: 180,
            height: 120
          }
        }]
      }
    })

    const doc = useCanvasShapeStore.getState().document
    const created = Object.values(doc.objects).find((shape) => shape.name === 'Card')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('applied')
    expect(created).toMatchObject({ type: 'rect', x: 24, y: 32, width: 180, height: 120 })
    expect(result.journalEntry).toMatchObject({
      label: 'agent-create-card',
      status: 'applied',
      operations: [{ type: 'create_shape', source: 'agent' }]
    })
    expect(doc.graph?.lastJournalEntryId).toBe(result.journalEntry?.id)
  })

  it('executes registered Motion tools through the canonical renderer motion path', () => {
    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame_home',
      parentId: ROOT_SHAPE_ID,
      children: ['hero']
    }
    const hero = {
      ...createDefaultShape('rect', 20, 20),
      id: 'hero',
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[ROOT_SHAPE_ID] = { ...document.objects[ROOT_SHAPE_ID], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[hero.id] = hero
    useCanvasShapeStore.getState().loadDocument(document)

    const result = executeDesignToolInvocation({
      toolId: 'design_motion_upsert_keyframes',
      label: 'animate-hero',
      input: {
        frameId: frame.id,
        targetShapeId: hero.id,
        property: 'opacity',
        keyframes: [
          { timeMs: 0, value: 0 },
          { timeMs: 500, value: 1, easing: { type: 'ease-out' } }
        ]
      }
    })

    expect(result).toMatchObject({
      ok: true,
      status: 'applied',
      affectedIds: ['hero'],
      journalEntry: { label: 'animate-hero', operations: [{ type: 'update_motion' }] }
    })
    expect(useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks[0]).toMatchObject({
      targetShapeId: 'hero',
      property: 'opacity',
      keyframes: [
        { timeMs: 0, value: 0 },
        { timeMs: 500, value: 1 }
      ]
    })
  })

  it('accepts DesignOperation payload wrappers for design.ops', () => {
    const result = executeDesignToolInvocation({
      toolId: 'design.ops',
      input: {
        label: 'wrapped-update',
        operations: [{
          id: 'op_1',
          type: 'create_shape',
          label: 'wrapped-update',
          source: 'agent',
          createdAt: '2026-07-02T00:00:00.000Z',
          targetIds: [],
          payload: {
            op: 'add',
            shape: { type: 'text', textContent: 'Hello', x: 1, y: 2 }
          }
        }]
      }
    })

    expect(result.ok).toBe(true)
    expect(result.journalEntry?.label).toBe('wrapped-update')
    expect(Object.values(useCanvasShapeStore.getState().document.objects)).toContainEqual(
      expect.objectContaining({ type: 'text', textContent: 'Hello' })
    )
  })

  it('returns protocol errors for malformed or unsupported tool invocations', () => {
    const invalid = executeDesignToolInvocation({
      toolId: 'design.ops',
      input: { operations: 'not-array' }
    })
    const unsupported = executeDesignToolInvocation({
      toolId: 'design.unknown_tool',
      input: {}
    })

    expect(invalid).toMatchObject({
      ok: false,
      status: 'invalid',
      errors: [{ code: 'INVALID_INPUT' }]
    })
    expect(unsupported).toMatchObject({
      ok: false,
      status: 'unsupported',
      errors: [{ code: 'UNSUPPORTED_TOOL' }]
    })
  })

  it('plans from the current Design Graph, directions, journal, and system state', () => {
    const doc = createEmptyDocument()
    const frame = createDefaultShape('frame', 20, 30)
    frame.name = 'Checkout frame'
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }
    useCanvasShapeStore.getState().loadDocument(doc)
    useDesignSystemStore.getState().loadSystem({
      tokens: { 'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' } },
      components: {}
    })

    const result = executeDesignToolInvocation({ toolId: 'design.plan' })
    const output = result.output as { counts: { frameCount: number; tokenCount: number }; nextTools: string[] }

    expect(result).toMatchObject({ ok: true, status: 'ready', affectedIds: [] })
    expect(output.counts.frameCount).toBe(1)
    expect(output.counts.tokenCount).toBe(1)
    expect(output.nextTools).toContain('design.generate_screen')
  })

  it('generates multiple graph-backed direction frames and tags their artifacts', () => {
    const result = executeDesignToolInvocation({
      toolId: 'design.generate_directions',
      input: {
        prompt: 'Design an onboarding flow for a finance assistant.',
        directions: [
          { name: 'Calm trust', brief: 'Conservative banking tone with proof and clear consent.' },
          { name: 'Fast setup', brief: 'Task-first setup wizard focused on speed.' }
        ]
      }
    })
    const workspace = useDesignWorkspaceStore.getState()
    const canvas = useCanvasShapeStore.getState().document
    const htmlArtifacts = workspace.artifacts.filter((artifact) => artifact.kind === 'html')
    const frames = result.affectedIds.map((id) => canvas.objects[id])

    expect(result).toMatchObject({ ok: true, status: 'applied' })
    expect(workspace.artifacts.some((artifact) => artifact.kind === 'canvas')).toBe(true)
    expect(htmlArtifacts).toHaveLength(2)
    expect(new Set(htmlArtifacts.map((artifact) => artifact.direction?.name))).toEqual(
      new Set(['Calm trust', 'Fast setup'])
    )
    expect(frames.every((shape) => shape?.type === 'frame' && Boolean(shape.htmlArtifactId))).toBe(true)
    expect(result.journalEntry).toMatchObject({
      label: 'design.generate_directions',
      operations: [{ type: 'generate_screen' }]
    })
    expect((result.output as { directions: Array<{ artifactId: string; frameId: string }> }).directions).toHaveLength(2)
  })

  it('runs design.critique through lint-design-system and attaches repairable notes', () => {
    const doc = createEmptyDocument()
    const card = createDefaultShape('rect', 40, 50)
    card.name = 'Hero card'
    card.fills = [{ type: 'solid', color: '#2563eb', opacity: 1 }]
    doc.objects[card.id] = { ...card, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [card.id] }
    useCanvasShapeStore.getState().loadDocument(doc)
    useDesignSystemStore.getState().loadSystem({
      tokens: { 'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' } },
      components: {}
    })

    const result = executeDesignToolInvocation({
      toolId: 'design.critique',
      input: { scopeIds: [card.id], maxFindings: 1 }
    })
    const nextDoc = useCanvasShapeStore.getState().document
    const note = Object.values(nextDoc.objects).find((shape) => shape.agentNote?.kind === 'critique')

    expect(result).toMatchObject({ ok: true, status: 'applied' })
    expect(result.affectedIds).toContain(card.id)
    expect(result.journalEntry).toMatchObject({
      label: 'design.critique',
      operations: [
        { type: 'lint_design' },
        { type: 'create_shape' }
      ]
    })
    expect(note).toMatchObject({
      type: 'text',
      agentNote: {
        body: expect.stringContaining('off-token-color'),
        targetIds: [card.id],
        source: 'critic'
      }
    })
  })

  it('repairs lint findings and resolves matching critique notes through operations', () => {
    const doc = createEmptyDocument()
    const card = createDefaultShape('rect', 40, 50)
    card.name = 'Hero card'
    card.fills = [{ type: 'solid', color: '#2563eb', opacity: 1 }]
    doc.objects[card.id] = { ...card, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [card.id] }
    useCanvasShapeStore.getState().loadDocument(doc)
    useDesignSystemStore.getState().loadSystem({
      tokens: { 'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' } },
      components: {}
    })

    executeDesignToolInvocation({
      toolId: 'design.critique',
      input: { scopeIds: [card.id], maxFindings: 1 }
    })
    const noteBefore = Object.values(useCanvasShapeStore.getState().document.objects)
      .find((shape) => shape.agentNote?.targetIds?.includes(card.id))
    expect(noteBefore).toBeDefined()

    const repair = executeDesignToolInvocation({
      toolId: 'design.repair',
      input: { scopeIds: [card.id] }
    })
    const nextDoc = useCanvasShapeStore.getState().document
    const repairedCard = nextDoc.objects[card.id]
    const noteAfter = noteBefore ? nextDoc.objects[noteBefore.id] : undefined

    expect(repair).toMatchObject({ ok: true, status: 'applied' })
    expect(repair.affectedIds).toEqual(expect.arrayContaining([card.id, noteBefore!.id]))
    expect(repairedCard.tokenBindings).toEqual({ fill: 'brand/primary' })
    expect(noteAfter?.agentNote).toMatchObject({ resolved: true })
    expect(repair.journalEntry).toMatchObject({
      label: 'design.repair',
      operations: [
        { type: 'apply_token' },
        { type: 'update_shape' }
      ]
    })
  })

  it('repairs small hit targets and accepts explicit repair ops', () => {
    const doc = createEmptyDocument()
    const button = createDefaultShape('rect', 12, 18)
    button.name = 'Tiny button'
    button.width = 32
    button.height = 28
    doc.objects[button.id] = { ...button, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [button.id] }
    useCanvasShapeStore.getState().loadDocument(doc)

    const auto = executeDesignToolInvocation({
      toolId: 'design.repair',
      input: { scopeIds: [button.id] }
    })
    expect(auto).toMatchObject({ ok: true, status: 'applied' })
    expect(useCanvasShapeStore.getState().document.objects[button.id]).toMatchObject({
      width: 44,
      height: 44
    })

    const explicit = executeDesignToolInvocation({
      toolId: 'design.repair',
      input: {
        ops: [{ op: 'update', id: button.id, patch: { name: 'Primary button' } }]
      }
    })
    expect(explicit).toMatchObject({ ok: true, status: 'applied' })
    expect(useCanvasShapeStore.getState().document.objects[button.id].name).toBe('Primary button')
  })

  it('executes design.system for token definition and token application', () => {
    const doc = createEmptyDocument()
    const card = createDefaultShape('rect', 16, 24)
    doc.objects[card.id] = { ...card, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [card.id] }
    useCanvasShapeStore.getState().loadDocument(doc)

    const result = executeDesignToolInvocation({
      toolId: 'design.system',
      input: {
        ops: [
          { op: 'define-token', name: 'brand/primary', kind: 'color', value: '#2563eb' },
          { op: 'apply-token', ids: [card.id], prop: 'fill', token: 'brand/primary' }
        ]
      }
    })
    const shape = useCanvasShapeStore.getState().document.objects[card.id]
    const output = result.output as {
      after: { tokenCount: number }
      designSystem: { tokenCount: number; tokenUsageCount: number }
    }

    expect(result).toMatchObject({ ok: true, status: 'applied', affectedIds: [card.id] })
    expect(shape).toMatchObject({
      fills: [{ type: 'solid', color: '#2563eb', opacity: 1 }],
      tokenBindings: { fill: 'brand/primary' }
    })
    expect(output.after.tokenCount).toBe(1)
    expect(output.designSystem).toMatchObject({ tokenCount: 1, tokenUsageCount: 1 })
    expect(result.journalEntry).toMatchObject({
      label: 'design.system',
      operations: [
        { type: 'define_token' },
        { type: 'apply_token' }
      ]
    })
  })

  it('executes design.system validate/template shortcuts and rejects non-system ops', () => {
    const invalid = executeDesignToolInvocation({
      toolId: 'design.system',
      input: { ops: [{ op: 'move', ids: ['shape_1'], dx: 4, dy: 8 }] }
    })
    expect(invalid).toMatchObject({
      ok: false,
      status: 'invalid',
      errors: [{ code: 'INVALID_SYSTEM_OP' }]
    })

    const template = executeDesignToolInvocation({
      toolId: 'design.system',
      input: { action: 'template', name: 'Kun Kit', seedColor: '#D4AF37', template: 'saas' }
    })
    expect(template).toMatchObject({ ok: true, status: 'applied' })
    expect((template.output as { after: { tokenCount: number; componentCount: number } }).after).toMatchObject({
      tokenCount: expect.any(Number),
      componentCount: expect.any(Number)
    })

    const validate = executeDesignToolInvocation({
      toolId: 'design.system',
      input: { action: 'validate' }
    })
    expect(validate).toMatchObject({
      ok: true,
      status: 'applied',
      journalEntry: { operations: [{ type: 'lint_design' }] }
    })
  })

  it('binds running app frame metadata into CodeBinding entries and journal', () => {
    const doc = createEmptyDocument()
    const frame = createRunningAppFrameShape({
      x: 0,
      y: 0,
      url: 'localhost:5173/orders',
      title: 'Orders live',
      routePath: '/orders',
      sourceFile: 'src/app/orders/page.tsx',
      componentName: 'OrdersPage'
    })!
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }
    useCanvasShapeStore.getState().loadDocument(doc)

    const result = executeDesignToolInvocation({
      toolId: 'design.bind_code',
      input: { selectedIds: [frame.id], capturedAt: createdAt }
    })
    const nextDoc = useCanvasShapeStore.getState().document

    expect(result).toMatchObject({ ok: true, status: 'applied', affectedIds: [frame.id] })
    expect(nextDoc.codeBindings?.[0]).toMatchObject({
      designObjectId: frame.id,
      kind: 'component',
      status: 'active',
      target: {
        routePath: '/orders',
        sourceFile: 'src/app/orders/page.tsx',
        componentName: 'OrdersPage'
      }
    })
    expect(result.journalEntry).toMatchObject({
      label: 'design.bind_code',
      operations: [{ type: 'bind_code', source: 'code-bridge', targetIds: [frame.id] }]
    })
  })

  it('binds explicit DOM source matches and marks scoped stale bindings', () => {
    const doc = createEmptyDocument()
    const frame = createDefaultShape('frame', 10, 20)
    frame.name = 'Checkout preview'
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }
    doc.codeBindings = [{
      id: 'binding_old',
      designObjectId: frame.id,
      kind: 'dom-node',
      status: 'active',
      createdAt,
      target: { onlookId: 'old-node', sourceFile: 'src/old.tsx' }
    }]
    useCanvasShapeStore.getState().loadDocument(doc)

    const result = executeDesignToolInvocation({
      toolId: 'design.bind_code',
      input: {
        capturedAt: '2026-07-02T12:00:00.000Z',
        matches: [{
          designObjectId: frame.id,
          node: {
            tagName: 'button',
            text: 'Pay now',
            onlookId: 'checkout-pay',
            sourceFile: 'src/app/checkout/page.tsx',
            componentName: 'PayButton'
          }
        }]
      }
    })
    const bindings = useCanvasShapeStore.getState().document.codeBindings ?? []

    expect(result).toMatchObject({ ok: true, status: 'applied' })
    expect(bindings.find((binding) => binding.id === 'binding_old')).toMatchObject({ status: 'stale' })
    expect(bindings.some((binding) =>
      binding.status === 'active' &&
      binding.target.onlookId === 'checkout-pay' &&
      binding.target.componentName === 'PayButton'
    )).toBe(true)
    expect(result.output).toMatchObject({
      matchCount: 1,
      activeBindingIds: [expect.stringContaining('checkout-pay')],
      staleBindingIds: ['binding_old']
    })
  })

  it('prepares implementation code requests from the latest implementable design journal', () => {
    const doc = createEmptyDocument()
    const label = createDefaultShape('text', 10, 20)
    label.textContent = 'Start'
    doc.objects[label.id] = { ...label, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [label.id] }
    doc.codeBindings = [{
      id: 'binding_label',
      designObjectId: label.id,
      kind: 'dom-node',
      status: 'active',
      createdAt,
      target: {
        sourceFile: 'src/app/page.tsx',
        onlookId: 'hero-label'
      }
    }]
    useCanvasShapeStore.getState().loadDocument(doc)

    const edit = executeDesignToolInvocation({
      toolId: 'design.ops',
      label: 'Edit hero label',
      input: [{ op: 'update', id: label.id, patch: { textContent: 'Launch' } }]
    })
    const bind = executeDesignToolInvocation({
      toolId: 'design.bind_code',
      input: {
        matches: [{
          designObjectId: label.id,
          node: {
            tagName: 'span',
            onlookId: 'hero-label',
            sourceFile: 'src/app/page.tsx'
          }
        }]
      }
    })
    const implement = executeDesignToolInvocation({ toolId: 'design.implement' })
    const output = implement.output as {
      journalEntryId: string
      requestCount: number
      requests: Array<{ kind: string; payload: Record<string, unknown> }>
      requestsBySourceFile: Array<{ sourceFile: string; requestCount: number }>
    }

    expect(bind.journalEntry?.operations[0]?.type).toBe('bind_code')
    expect(implement).toMatchObject({ ok: true, status: 'ready', affectedIds: [label.id] })
    expect(output.journalEntryId).toBe(edit.journalEntry?.id)
    expect(output.requestCount).toBe(1)
    expect(output.requests[0]).toMatchObject({
      kind: 'edit-text',
      payload: { textContent: 'Launch' }
    })
    expect(output.requestsBySourceFile).toEqual([{ sourceFile: 'src/app/page.tsx', requestCount: 1, requestIds: expect.any(Array) }])
  })

  it('reports implementation blockers when no active code binding exists', () => {
    const doc = createEmptyDocument()
    const label = createDefaultShape('text', 10, 20)
    doc.objects[label.id] = { ...label, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [label.id] }
    useCanvasShapeStore.getState().loadDocument(doc)
    executeDesignToolInvocation({
      toolId: 'design.ops',
      label: 'Edit unbound label',
      input: [{ op: 'update', id: label.id, patch: { textContent: 'Launch' } }]
    })

    expect(executeDesignToolInvocation({ toolId: 'design.implement' })).toMatchObject({
      ok: false,
      status: 'invalid',
      errors: [{ code: 'NO_ACTIVE_CODE_BINDINGS' }]
    })
  })

  it('exports a Stitch-compatible DESIGN.md payload from the graph state', () => {
    const document: DesignDocument = {
      id: 'doc_1',
      title: 'Checkout redesign',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      activeArtifactId: null,
      artifacts: []
    }
    useDesignWorkspaceStore.setState({
      documents: [document],
      activeDocumentId: document.id,
      artifacts: [],
      activeArtifactId: null,
      designContext: { designTarget: 'web', tone: ['专业'] }
    })

    const result = executeDesignToolInvocation({
      toolId: 'design.export',
      input: { format: 'design-md', brief: 'Improve checkout conversion.' }
    })
    const output = result.output as { path: string; markdown: string }

    expect(result).toMatchObject({ ok: true, status: 'ready', affectedIds: [] })
    expect(output.path).toBe('.kun-design/HANDOFF.md')
    expect(output.markdown).toContain('# DESIGN.md: Checkout redesign')
    expect(output.markdown).toContain('Improve checkout conversion.')
  })
})
