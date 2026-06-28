/**
 * Doc-level design-system store (tokens + components), the sibling of
 * `useCanvasShapeStore`. Loaded/reset by the design workspace layer when the
 * active document changes; read+written by the shape-op executor. Kept as a
 * dumb container with no workspace/UI imports so the executor can import it
 * directly without a cycle.
 */
import { create } from 'zustand'
import type { ComponentDef, DesignSystem, DesignToken } from './design-system-types'
import { createEmptyDesignSystem } from './design-system-types'

type DesignSystemState = {
  system: DesignSystem

  loadSystem: (system: DesignSystem) => void
  resetSystem: () => void

  getToken: (name: string) => DesignToken | undefined
  setToken: (token: DesignToken) => void
  deleteToken: (name: string) => void
  listTokens: () => DesignToken[]

  getComponent: (name: string) => ComponentDef | undefined
  setComponent: (component: ComponentDef) => void
  deleteComponent: (name: string) => void
  listComponents: () => ComponentDef[]
}

export const useDesignSystemStore = create<DesignSystemState>((set, get) => ({
  system: createEmptyDesignSystem(),

  loadSystem: (system) => set({ system }),
  resetSystem: () => set({ system: createEmptyDesignSystem() }),

  getToken: (name) => get().system.tokens[name],
  setToken: (token) =>
    set((s) => ({ system: { ...s.system, tokens: { ...s.system.tokens, [token.name]: token } } })),
  deleteToken: (name) =>
    set((s) => {
      const tokens = { ...s.system.tokens }
      delete tokens[name]
      return { system: { ...s.system, tokens } }
    }),
  listTokens: () => Object.values(get().system.tokens),

  getComponent: (name) => get().system.components[name],
  setComponent: (component) =>
    set((s) => ({
      system: { ...s.system, components: { ...s.system.components, [component.name]: component } }
    })),
  deleteComponent: (name) =>
    set((s) => {
      const components = { ...s.system.components }
      delete components[name]
      return { system: { ...s.system, components } }
    }),
  listComponents: () => Object.values(get().system.components)
}))
