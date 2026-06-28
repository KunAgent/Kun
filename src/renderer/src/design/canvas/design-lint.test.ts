import { describe, expect, it, beforeEach } from 'vitest'
import { executeOps } from './shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useDesignSystemStore } from './design-system-store'
import { createEmptyDocument } from './canvas-types'
import { contrastRatio, lintDesignSystem, takeLastLintFindings } from './design-lint'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  useDesignSystemStore.getState().resetSystem()
})

const doc = () => useCanvasShapeStore.getState().document
const system = () => useDesignSystemStore.getState().system

describe('contrastRatio', () => {
  it('is 21 for black on white and low for near-equal colors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#888888')).toBeLessThan(4.5)
  })
})

describe('lintDesignSystem', () => {
  it('flags a hardcoded color that equals a token but is not bound', () => {
    executeOps([{ op: 'define-token', name: 'brand/primary', kind: 'color', value: '#3b82d8' }])
    executeOps([
      {
        op: 'add',
        shape: {
          type: 'rect',
          name: 'CTA',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          fills: [{ type: 'solid', color: '#3b82d8', opacity: 1 }]
        }
      }
    ])
    const findings = lintDesignSystem(doc(), system())
    expect(findings.some((f) => f.code === 'off-token-color')).toBe(true)
  })

  it('does NOT flag the same color once bound to the token', () => {
    executeOps([{ op: 'define-token', name: 'brand/primary', kind: 'color', value: '#3b82d8' }])
    const id = executeOps([
      { op: 'add', shape: { type: 'rect', name: 'CTA', x: 0, y: 0, width: 100, height: 50 } }
    ]).affectedIds[0]
    executeOps([{ op: 'apply-token', ids: [id], prop: 'fill', token: 'brand/primary' }])
    const findings = lintDesignSystem(doc(), system())
    expect(findings.some((f) => f.code === 'off-token-color')).toBe(false)
  })

  it('flags a sub-44px button-named shape', () => {
    executeOps([
      { op: 'add', shape: { type: 'rect', name: 'Submit Button', x: 0, y: 0, width: 120, height: 28 } }
    ])
    const findings = lintDesignSystem(doc(), system())
    expect(findings.some((f) => f.code === 'small-hit-target')).toBe(true)
  })

  it('flags low-contrast text over its background frame', () => {
    const frame = executeOps([
      {
        op: 'add',
        shape: {
          type: 'frame',
          name: 'Card',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          fills: [{ type: 'solid', color: '#ffffff', opacity: 1 }]
        }
      }
    ]).affectedIds[0]
    executeOps([
      {
        op: 'add',
        shape: {
          type: 'text',
          name: 'Label',
          x: 10,
          y: 10,
          width: 100,
          height: 20,
          textContent: 'hi',
          fontColor: '#eeeeee'
        },
        parentId: frame
      }
    ])
    const findings = lintDesignSystem(doc(), system())
    expect(findings.some((f) => f.code === 'low-contrast')).toBe(true)
  })
})

describe('lint-design-system op stashes findings for the next turn', () => {
  it('runs the lint and makes findings available via takeLastLintFindings', () => {
    executeOps([{ op: 'define-token', name: 'brand/primary', kind: 'color', value: '#3b82d8' }])
    executeOps([
      {
        op: 'add',
        shape: {
          type: 'rect',
          name: 'CTA',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          fills: [{ type: 'solid', color: '#3b82d8', opacity: 1 }]
        }
      }
    ])
    const r = executeOps([{ op: 'lint-design-system' }])
    expect(r.ok).toBe(true)
    const findings = takeLastLintFindings()
    expect(findings.length).toBeGreaterThan(0)
    // one-shot: cleared after taking
    expect(takeLastLintFindings()).toHaveLength(0)
  })
})
