import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import type { JointFrame } from './timeline'
import { loadJointTexture } from './assets'
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
  useEffect(() => {
    let cancelled = false
    const element = canvas.current!, initial = latest.current()
    setLoadedKey(''); setError(false)
    const lost = (event: Event): void => {
      event.preventDefault(); renderer.current?.dispose(); renderer.current = null; setLoadedKey('')
    }
    const restored = (): void => setRevision((value) => value + 1)
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored)
    void Promise.all(initial.actors.map((a) => loadJointTexture(a.pet, a.rig))).then((textures) => {
      if (cancelled) return
      const gl = element.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
      if (gl?.isContextLost()) return
      if (gl) renderer.current = new JointWebGLRenderer(gl, textures, initial)
      else {
        const ctx = element.getContext('2d')
        if (!ctx) throw new Error('No canvas renderer available')
        renderer.current = new JointCanvasRenderer(ctx, textures, initial)
      }
      setLoadedKey(renderKey)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => {
      cancelled = true; renderer.current?.dispose(); renderer.current = null
      element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored)
    }
  }, [renderKey])
  return { canvas, renderer, ready, error, revision }
}
