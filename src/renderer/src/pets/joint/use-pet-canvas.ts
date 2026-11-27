import { useLayoutEffect, useRef, useState } from 'react'
import type { JointFrame } from './timeline'
import { loadJointTexture, peekJointTexture, type JointTexture } from './assets'
import { JointWebGLRenderer } from './webgl-renderer'
import { JointCanvasRenderer } from './canvas-renderer'

type Renderer = { paint: JointWebGLRenderer['paint']; dispose(): void }

export function usePetCanvas(assetKey: string, frame: () => JointFrame) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<Renderer | null>(null)
  const latest = useRef(frame)
  useLayoutEffect(() => { latest.current = frame })
  const [revision, setRevision] = useState(0), [loadedKey, setLoadedKey] = useState(''), [error, setError] = useState(false)
  const renderKey = `${assetKey}:${revision}`
  const ready = renderKey === loadedKey
  useLayoutEffect(() => {
    let cancelled = false
    const element = canvas.current!, initial = latest.current()
    const mountRenderer = (textures: JointTexture[]): void => {
      if (cancelled) return
      const gl = element.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
      if (gl?.isContextLost()) return
      if (gl) renderer.current = new JointWebGLRenderer(gl, textures, initial)
      else {
        const ctx = element.getContext('2d')
        if (!ctx) throw new Error('No canvas renderer available')
        renderer.current = new JointCanvasRenderer(ctx, textures, initial)
      }
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      renderer.current.paint(initial, 0, Boolean(reduced))
      setLoadedKey(renderKey)
    }
    const lost = (event: Event): void => {
      event.preventDefault(); renderer.current?.dispose(); renderer.current = null; setLoadedKey('')
    }
    const restored = (): void => setRevision((value) => value + 1)
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored)
    setError(false)
    const cached = initial.actors.map((a) => peekJointTexture(a.pet, a.rig, a.armLayers?.cutouts))
    if (cached.every((item): item is JointTexture => item !== null)) {
      try { mountRenderer(cached) } catch { if (!cancelled) setError(true) }
    } else {
      setLoadedKey('')
      void Promise.all(initial.actors.map((a) => loadJointTexture(a.pet, a.rig, a.armLayers?.cutouts)))
        .then(mountRenderer)
        .catch(() => { if (!cancelled) setError(true) })
    }
    return () => {
      cancelled = true; renderer.current?.dispose(); renderer.current = null
      element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored)
    }
  }, [renderKey])
  return { canvas, renderer, ready, error, revision }
}
