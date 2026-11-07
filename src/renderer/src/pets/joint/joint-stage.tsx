import { useEffect, useRef, useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { PetResidentSprite } from '../pet-resident-sprite'
import type { PetSummary } from '@shared/pets'
import { PET_SCENES, petEnsembleText } from '../pet-ensemble-catalog'
import type { PetVisitStageProps } from '../pet-visit-stage'
import { usePetAnimationPainter } from '../use-pet-animation-painter'
import { loadJointTexture } from './assets'
import { JointWebGLRenderer } from './webgl-renderer'
import { JointCanvasRenderer } from './canvas-renderer'
import { jointHitPath, sampleJointVisit, type JointTimelineInput } from './timeline'
import './joint-stage.css'

type Renderer = { paint: JointWebGLRenderer['paint']; dispose(): void }

export function PetJointStage(props: PetVisitStageProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null), hit = useRef<HTMLButtonElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const [revision, setRevision] = useState(0), [loadedKey, setLoadedKey] = useState(''), [error, setError] = useState(false)
  const primary: PetSummary = { id: props.pet.petId!, sourceId: props.pet.petId!.split(':').slice(1).join(':'),
    displayName: props.pet.displayName ?? '', description: '', source: 'kun-local', available: true, sourceMissing: false,
    spriteVersionNumber: props.pet.spriteVersionNumber, spritesheetUrl: props.pet.spritesheetUrl ?? undefined,
    interactions: props.pet.interactions }
  const cast = [primary, ...props.visit.guestIds.map((id) => props.pets.find((pet) => pet.id === id)).filter((pet): pet is PetSummary => Boolean(pet))].slice(0, 3)
  const input = { ...props, cast } as Omit<JointTimelineInput, 'now' | 'reduced'>
  const latest = useRef(input)
  latest.current = input
  const assetKey = cast.map((p) => `${p.id}:${p.spritesheetUrl}`).join('|')
  const renderKey = `${assetKey}:${revision}`
  const ready = loadedKey === renderKey
  useEffect(() => {
    let cancelled = false
    const element = canvas.current!
    const initial = sampleJointVisit({ ...latest.current, now: Date.now(), reduced: false })
    setLoadedKey(''); setError(false)
    const lost = (event: Event): void => {
      event.preventDefault(); renderer.current?.dispose(); renderer.current = null; setLoadedKey('')
    }
    const restored = (): void => setRevision((value) => value + 1)
    element.addEventListener('webglcontextlost', lost)
    element.addEventListener('webglcontextrestored', restored)
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
  usePetAnimationPainter(`joint:${props.visit.id}:${ready}:${revision}`, false, ({ elapsed, reduced }) => {
    const frame = sampleJointVisit({ ...latest.current, now: Date.now(), reduced })
    if (hit.current) hit.current.style.clipPath = `path('${jointHitPath(frame)}')`
    if (!ready) return 100
    renderer.current?.paint(frame, elapsed, reduced)
  })
  const title = petEnsembleText(PET_SCENES[props.visit.scene].title, props.language)
  return <div className="pet-visit-stage pet-joint-stage" data-pet-joint={props.visit.scene} data-ready={ready} data-cast={cast.map((p) => p.sourceId).join(",")} style={{ width: props.width, height: props.height }}>
    <canvas ref={canvas} className="pet-joint-canvas" style={{ width: props.width, height: props.height, visibility: ready ? 'visible' : 'hidden' }} aria-hidden="true" />
    {!ready ? <PetResidentSprite animation="idle" version={props.pet.spriteVersionNumber} sheet={props.pet.spritesheetUrl}
      className="pet-sprite pet-joint-loading" tabIndex={-1} aria-hidden="true"
      style={{ position: 'absolute', pointerEvents: 'none', width: props.mascotWidth, height: props.mascotWidth * 208 / 192,
        left: props.primaryOrigin.x - props.mascotWidth / 2, top: props.primaryOrigin.y - props.mascotWidth * 208 / 384 }} /> : null}
    <button {...props.actorEvents} ref={hit} type="button" className="pet-joint-hit" aria-label={`${cast.map((p) => p.displayName).join('、')} · ${title}`} />
    <div className="pet-visit-caption pet-joint-caption"><span>{title}</span><button type="button" onClick={props.onDismiss}
      aria-label={petEnsembleText(['结束这次来访', 'End this visit'], props.language)}><X aria-hidden="true" /></button></div>
    {error ? <span className="pet-joint-error" role="status">{petEnsembleText(['角色素材暂时无法显示', 'Character artwork is unavailable'], props.language)}</span> : null}
  </div>
}
