import { createElement, lazy, useState, type ComponentType, type ReactElement } from 'react'

type SectionModule<P> = { default: ComponentType<P> }

export type PreloadableSection<P extends object> = ((props: P) => ReactElement) & {
  /** Starts fetching the chunk; safe to call repeatedly and from hover/focus handlers. */
  preload: () => void
}

/**
 * React.lazy with an explicit preload. Hovering or focusing a settings
 * destination warms its chunk; once it has resolved, opening the page renders
 * the real component directly instead of flashing the Suspense skeleton.
 */
export function lazySection<P extends object>(factory: () => Promise<SectionModule<P>>): PreloadableSection<P> {
  let resolved: ComponentType<P> | null = null
  let pending: Promise<SectionModule<P>> | null = null
  const load = (): Promise<SectionModule<P>> => {
    pending ??= factory().then((module) => {
      resolved = module.default
      return module
    }, (error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
  const Lazy = lazy(load)
  function PreloadableSettingsSection(props: P): ReactElement {
    // Choose once per mount so a later resolution never swaps the component type
    // under a mounted page and resets its local state.
    const [Component] = useState<ComponentType<P>>(() => resolved ?? (Lazy as unknown as ComponentType<P>))
    return createElement(Component, props)
  }
  return Object.assign(PreloadableSettingsSection, {
    preload: () => {
      void load().catch(() => undefined)
    }
  })
}
