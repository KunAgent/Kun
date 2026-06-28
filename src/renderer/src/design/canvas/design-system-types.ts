/**
 * Doc-level design system: named tokens + reusable components shared by every
 * artifact/screen in a DesignDocument. This is what makes batch output cohesive
 * — the agent references token names (and stamps components) instead of copying
 * hex values and hand-redrawing the same card N times.
 *
 * Tokens resolve to concrete CanvasShape patches via `resolveTokenPatch`; a
 * shape records which token feeds which property in `CanvasShape.tokenBindings`,
 * so editing a token re-resolves every bound shape ("change one, all update").
 */
import type { CanvasShape, GradientFill, Shadow } from './canvas-types'

/** A reusable text/paragraph style (subset of CanvasShape text fields). */
export type TextStyleSpec = {
  fontSize?: number
  fontWeight?: number
  fontFamily?: string
  lineHeight?: number
  textAlign?: 'left' | 'center' | 'right'
  fontColor?: string
}

export type DesignTokenKind = 'color' | 'gradient' | 'type' | 'space' | 'radius' | 'shadow'

/** A named design token. `value`'s shape is determined by `kind`. */
export type DesignToken =
  | { name: string; kind: 'color'; value: string }
  | { name: string; kind: 'gradient'; value: GradientFill }
  | { name: string; kind: 'type'; value: TextStyleSpec }
  | { name: string; kind: 'space'; value: number }
  | { name: string; kind: 'radius'; value: number }
  | { name: string; kind: 'shadow'; value: Shadow[] }

/** Which shape property an `apply-token` op feeds. */
export type TokenProp =
  | 'fill'
  | 'stroke'
  | 'text-color'
  | 'font'
  | 'radius'
  | 'shadow'
  | 'gap'
  | 'padding'

export type ComponentSlotKind = 'text' | 'image' | 'color' | 'visible'

/** A point in a component's tree the agent can override per instance. */
export type ComponentSlot = {
  /** Locator: a descendant shape NAME within the component tree. */
  path: string
  kind: ComponentSlotKind
  label?: string
}

/**
 * A reusable component: a shape subtree normalized so its root sits at (0,0),
 * plus the slots an instance may override. `tree[0]` is always the root.
 */
export type ComponentDef = {
  id: string
  name: string
  version: number
  tree: CanvasShape[]
  slots: ComponentSlot[]
}

/** slotPath → override value (text string / image url / color hex / boolean / number). */
export type ComponentOverrides = Record<string, unknown>

export type DesignSystem = {
  tokens: Record<string, DesignToken>
  components: Record<string, ComponentDef>
}

export function createEmptyDesignSystem(): DesignSystem {
  return { tokens: {}, components: {} }
}

type PatchOrError = Partial<CanvasShape> | { error: string }

/**
 * Resolve a token onto a concrete shape patch for a given property. Pure — no
 * store access — so it's trivially testable and reused by both `apply-token`
 * (first bind) and `define-token` (re-resolve bound shapes after an edit).
 */
export function resolveTokenPatch(
  token: DesignToken,
  prop: TokenProp,
  shape: CanvasShape
): PatchOrError {
  switch (prop) {
    case 'fill':
      if (token.kind === 'color') return { fills: [{ type: 'solid', color: token.value, opacity: 1 }] }
      if (token.kind === 'gradient') return { fills: [token.value] }
      return { error: `token "${token.name}" is a ${token.kind}; "fill" needs a color/gradient token` }
    case 'stroke': {
      if (token.kind !== 'color') return { error: `"stroke" needs a color token, got ${token.kind}` }
      const existing = shape.strokes?.[0]
      return {
        strokes: [
          {
            color: token.value,
            width: existing?.width ?? 1,
            opacity: 1,
            position: existing?.position ?? 'center',
            ...(existing?.dash ? { dash: existing.dash } : {})
          }
        ]
      }
    }
    case 'text-color':
      if (token.kind !== 'color') return { error: `"text-color" needs a color token, got ${token.kind}` }
      return { fontColor: token.value }
    case 'font': {
      if (token.kind !== 'type') return { error: `"font" needs a type token, got ${token.kind}` }
      const v = token.value
      const patch: Partial<CanvasShape> = {}
      if (v.fontSize !== undefined) patch.fontSize = v.fontSize
      if (v.fontWeight !== undefined) patch.fontWeight = v.fontWeight
      if (v.fontFamily !== undefined) patch.fontFamily = v.fontFamily
      if (v.lineHeight !== undefined) patch.lineHeight = v.lineHeight
      if (v.textAlign !== undefined) patch.textAlign = v.textAlign
      if (v.fontColor !== undefined) patch.fontColor = v.fontColor
      return patch
    }
    case 'radius':
      if (token.kind !== 'radius' && token.kind !== 'space')
        return { error: `"radius" needs a radius/space token, got ${token.kind}` }
      return { cornerRadius: token.value }
    case 'shadow':
      if (token.kind !== 'shadow') return { error: `"shadow" needs a shadow token, got ${token.kind}` }
      return { shadows: token.value }
    case 'gap': {
      if (token.kind !== 'space') return { error: `"gap" needs a space token, got ${token.kind}` }
      if (!shape.layout) return { error: `shape "${shape.name}" has no auto-layout to set a gap on` }
      return { layout: { ...shape.layout, gap: token.value } }
    }
    case 'padding': {
      if (token.kind !== 'space') return { error: `"padding" needs a space token, got ${token.kind}` }
      if (!shape.layout) return { error: `shape "${shape.name}" has no auto-layout to pad` }
      return {
        layout: {
          ...shape.layout,
          paddingTop: token.value,
          paddingRight: token.value,
          paddingBottom: token.value,
          paddingLeft: token.value
        }
      }
    }
  }
}
