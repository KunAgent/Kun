/**
 * Design-system linter: pure heuristics over the canvas + design system that
 * surface cohesion/accessibility problems the agent can auto-fix (bind an
 * off-token color, raise a low-contrast text, grow a sub-44px tap target). The
 * `lint-design-system` op runs this and stashes the findings; the next canvas
 * turn reinjects them — the same stash→reinject loop op-errors already use — so
 * the agent runs generate → lint → repair without human prompting.
 */
import type { CanvasDocument, CanvasShape, Fill } from './canvas-types'
import type { DesignSystem, DesignToken } from './design-system-types'

export type LintFinding = {
  code: 'off-token-color' | 'low-contrast' | 'small-hit-target'
  message: string
  shapeId?: string
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio between two hex colors (1..21). Unparseable input → 21 (no finding). */
export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return 21
  const la = relLuminance(ra)
  const lb = relLuminance(rb)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

function solidFill(shape: CanvasShape): string | null {
  const f = shape.fills.find((ff): ff is Extract<Fill, { type: 'solid' }> => ff.type === 'solid' && ff.opacity > 0)
  return f ? f.color : null
}

function nearestAncestorFill(doc: CanvasDocument, shape: CanvasShape): string | null {
  let cur = shape.parentId ? doc.objects[shape.parentId] : null
  while (cur && cur.id !== doc.rootId) {
    const c = solidFill(cur)
    if (c) return c
    cur = cur.parentId ? doc.objects[cur.parentId] : null
  }
  return null
}

export function lintDesignSystem(doc: CanvasDocument, system: DesignSystem): LintFinding[] {
  const findings: LintFinding[] = []
  const colorTokens = Object.values(system.tokens).filter(
    (t): t is Extract<DesignToken, { kind: 'color' }> => t.kind === 'color'
  )
  const tokenByColor = new Map(colorTokens.map((t) => [t.value.toLowerCase(), t.name]))

  for (const shape of Object.values(doc.objects)) {
    if (shape.id === doc.rootId) continue

    // off-token-color: a hardcoded color equals a token's value but isn't bound to it.
    const fill = solidFill(shape)
    if (fill) {
      const tokenName = tokenByColor.get(fill.toLowerCase())
      const bound = Boolean(shape.tokenBindings && Object.values(shape.tokenBindings).includes(tokenName ?? '\0'))
      if (tokenName && !bound) {
        findings.push({
          code: 'off-token-color',
          shapeId: shape.id,
          message: `"${shape.name}" hardcodes ${fill}, which is token "${tokenName}" — bind it with apply-token so theme changes reach it.`
        })
      }
    }

    // small-hit-target: a button-ish shape below the 44px touch minimum.
    if (/button|btn/i.test(shape.name) && (shape.width < 44 || shape.height < 44)) {
      findings.push({
        code: 'small-hit-target',
        shapeId: shape.id,
        message: `"${shape.name}" is ${Math.round(shape.width)}×${Math.round(shape.height)} — below the 44px tap target.`
      })
    }

    // low-contrast: text color vs its nearest solid background.
    if (shape.type === 'text' && shape.fontColor) {
      const bg = nearestAncestorFill(doc, shape)
      if (bg) {
        const ratio = contrastRatio(shape.fontColor, bg)
        if (ratio < 4.5) {
          findings.push({
            code: 'low-contrast',
            shapeId: shape.id,
            message: `"${shape.name}" text ${shape.fontColor} on ${bg} is ${ratio.toFixed(1)}:1 — below WCAG AA 4.5:1.`
          })
        }
      }
    }
  }

  return findings
}

/**
 * One-shot stash for the last `lint-design-system` run, taken by the next canvas
 * turn's prompt builder so findings surface to the agent (mirrors the op-error
 * stash in apply-shape-ops). Kept here to avoid a shape-ops ↔ apply-shape-ops cycle.
 */
let _lastLintFindings: LintFinding[] = []

export function setLastLintFindings(findings: LintFinding[]): void {
  _lastLintFindings = findings
}

export function takeLastLintFindings(): LintFinding[] {
  const out = _lastLintFindings
  _lastLintFindings = []
  return out
}
