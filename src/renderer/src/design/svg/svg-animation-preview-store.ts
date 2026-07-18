import { create } from 'zustand'

export type SvgAnimationPreviewStatus = 'loading' | 'ready' | 'invalid' | 'missing'

export type SvgAnimationPreviewState = {
  shapeId: string
  artifactId: string
  title: string
  status: SvgAnimationPreviewStatus
  animationCount: number
  durationMs: number
  loopsIndefinitely: boolean
  currentTimeMs: number
  playing: boolean
  rate: number
}

export type SvgAnimationPreviewController = {
  play: () => void
  pause: () => void
  restart: () => void
  seek: (timeMs: number) => void
  setRate: (rate: number) => void
}

type RegisteredController = {
  owner: symbol
  controller: SvgAnimationPreviewController
}

type SvgAnimationPreviewStore = {
  previews: Readonly<Record<string, SvgAnimationPreviewState>>
}

const controllers = new Map<string, RegisteredController>()

export const useSvgAnimationPreviewStore = create<SvgAnimationPreviewStore>(() => ({
  previews: {}
}))

function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

export function publishSvgAnimationPreview(preview: SvgAnimationPreviewState): void {
  const durationMs = bounded(preview.durationMs, 1, 600_000, 1_000)
  const rawCurrentTimeMs = Number.isFinite(preview.currentTimeMs)
    ? Math.max(0, preview.currentTimeMs)
    : 0
  const normalized: SvgAnimationPreviewState = {
    ...preview,
    animationCount: Math.round(bounded(preview.animationCount, 0, 5_000, 0)),
    durationMs,
    currentTimeMs: preview.loopsIndefinitely
      ? rawCurrentTimeMs % durationMs
      : Math.min(rawCurrentTimeMs, durationMs),
    rate: bounded(preview.rate, 0.1, 4, 1)
  }
  useSvgAnimationPreviewStore.setState((state) => ({
    previews: { ...state.previews, [preview.shapeId]: normalized }
  }))
}

export function registerSvgAnimationPreviewController(
  shapeId: string,
  controller: SvgAnimationPreviewController
): () => void {
  const owner = Symbol(shapeId)
  controllers.set(shapeId, { owner, controller })
  return () => {
    if (controllers.get(shapeId)?.owner !== owner) return
    controllers.delete(shapeId)
    useSvgAnimationPreviewStore.setState((state) => {
      if (!state.previews[shapeId]) return state
      const previews = { ...state.previews }
      delete previews[shapeId]
      return { previews }
    })
  }
}

export function controlSvgAnimationPreview(
  shapeId: string,
  action:
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'restart' }
    | { type: 'seek'; timeMs: number }
    | { type: 'set-rate'; rate: number }
): boolean {
  const controller = controllers.get(shapeId)?.controller
  if (!controller) return false
  switch (action.type) {
    case 'play': controller.play(); break
    case 'pause': controller.pause(); break
    case 'restart': controller.restart(); break
    case 'seek': controller.seek(action.timeMs); break
    case 'set-rate': controller.setRate(action.rate); break
  }
  return true
}

export function resetSvgAnimationPreviewStore(): void {
  controllers.clear()
  useSvgAnimationPreviewStore.setState({ previews: {} })
}
