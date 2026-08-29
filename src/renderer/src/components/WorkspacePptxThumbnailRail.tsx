import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { secureWorkspaceOfficeLinks } from './workspace-office-external-link'
import i18n from '../i18n'

export type PptxPreviewer = ReturnType<typeof import('pptx-preview')['init']>

export type PptxThumbnailSession = {
  previewer: PptxPreviewer
  host: HTMLDivElement
  sourceKey: string
}

export const MAX_MOUNTED_PPTX_THUMBNAILS = 16

export function WorkspacePptxThumbnailRail({
  session,
  slideCount,
  currentSlide,
  onSelectSlide
}: {
  session: PptxThumbnailSession | null
  slideCount: number
  currentSlide: number
  onSelectSlide: (slide: number) => void
}): ReactElement {
  const railRef = useRef<HTMLDivElement>(null)
  const slideButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const generatedSlidesRef = useRef(new Set<number>())
  const [requestedSlides, setRequestedSlides] = useState<Set<number>>(() => initialSlides(slideCount))
  const [thumbnails, setThumbnails] = useState<Map<number, HTMLElement>>(new Map())

  useEffect(() => {
    generatedSlidesRef.current.clear()
    setRequestedSlides(initialSlides(slideCount))
    setThumbnails(new Map())
  }, [session?.sourceKey, slideCount])

  useEffect(() => {
    slideButtonRefs.current.get(currentSlide)?.scrollIntoView({ block: 'nearest' })
    setRequestedSlides((current) => includeRequestedSlide(current, currentSlide))
  }, [currentSlide])

  useEffect(() => {
    const rail = railRef.current
    if (!rail || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      setRequestedSlides((current) => updateRequestedSlides(current, entries))
    }, {
      root: rail,
      rootMargin: '180px 0px',
      threshold: 0.01
    })
    for (const item of rail.querySelectorAll<HTMLElement>('[data-pptx-thumbnail-index]')) {
      observer.observe(item)
    }
    return () => observer.disconnect()
  }, [session?.sourceKey, slideCount])

  const requested = useMemo(
    () => Array.from(requestedSlides).sort((left, right) => left - right),
    [requestedSlides]
  )

  useEffect(() => {
    const allowed = new Set(requested)
    generatedSlidesRef.current = new Set(
      Array.from(generatedSlidesRef.current).filter((slide) => allowed.has(slide))
    )
    setThumbnails((current) => pruneThumbnails(current, allowed))
    if (!session) return
    let cancelled = false

    const generate = async (): Promise<void> => {
      for (const slide of requested) {
        if (cancelled) return
        if (generatedSlidesRef.current.has(slide)) continue
        try {
          session.previewer.renderSingleSlide(slide - 1)
          secureWorkspaceOfficeLinks(session.host)
          const rendered = session.host.querySelector<HTMLElement>(
            `.pptx-preview-slide-wrapper-${slide - 1}`
          )
          if (!rendered || cancelled) continue
          const clone = cloneStaticSlide(rendered)
          clone.setAttribute('aria-hidden', 'true')
          secureWorkspaceOfficeLinks(clone)
          generatedSlidesRef.current.add(slide)
          setThumbnails((current) => {
            if (cancelled || !allowed.has(slide) || current.has(slide)) return current
            const next = new Map(current)
            next.set(slide, clone)
            return capThumbnails(next, allowed)
          })
        } catch {
          // A failed thumbnail must not replace an otherwise usable main preview.
        }
        await Promise.resolve()
      }
    }

    void generate()
    return () => {
      cancelled = true
    }
  }, [requested, session])

  return (
    <aside
      ref={railRef}
      aria-label={i18n.t('officeSlideThumbnails')}
      className="w-[164px] shrink-0 overflow-y-auto border-r border-ds-border-muted bg-ds-card/55 p-2"
    >
      <div className="flex flex-col gap-2">
        {Array.from({ length: slideCount }, (_, index) => {
          const slide = index + 1
          const thumbnail = thumbnails.get(slide)
          const active = slide === currentSlide
          return (
            <button
              key={slide}
              ref={(node) => {
                if (node) slideButtonRefs.current.set(slide, node)
                else slideButtonRefs.current.delete(slide)
              }}
              type="button"
              aria-label={i18n.t('officeGoToSlide', { slide })}
              aria-current={active ? 'page' : undefined}
              data-pptx-thumbnail-index={index}
              data-thumbnail-state={thumbnail ? 'ready' : 'placeholder'}
              className={`rounded-lg border p-1.5 text-left transition ${
                active
                  ? 'border-ds-accent bg-ds-hover shadow-sm ring-1 ring-ds-accent/20'
                  : 'border-ds-border-muted bg-ds-card hover:border-ds-border'
              }`}
              onClick={() => onSelectSlide(slide)}
            >
              <div className="aspect-video w-full overflow-hidden rounded-sm bg-black/10">
                {thumbnail ? <StaticPptxThumbnail content={thumbnail} /> : (
                  <div className="h-full w-full animate-pulse bg-ds-surface-subtle" aria-hidden="true" />
                )}
              </div>
              <span className={`mt-1 block text-center text-[10px] ${active ? 'text-ds-ink' : 'text-ds-muted'}`}>
                {slide}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function StaticPptxThumbnail({ content }: { content: HTMLElement }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mounted = content.cloneNode(true) as HTMLElement
    mounted.style.pointerEvents = 'none'
    mounted.style.margin = '0'
    mounted.style.position = 'absolute'
    const fitThumbnail = (): void => {
      const sourceWidth = Number.parseFloat(mounted.style.width) || 160
      const sourceHeight = Number.parseFloat(mounted.style.height) || 90
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      const scale = Math.min(host.clientWidth / sourceWidth, host.clientHeight / sourceHeight)
      mounted.style.left = `${(host.clientWidth - sourceWidth * scale) / 2}px`
      mounted.style.top = `${(host.clientHeight - sourceHeight * scale) / 2}px`
      mounted.style.transform = `scale(${scale})`
      mounted.style.transformOrigin = 'top left'
    }
    host.replaceChildren(mounted)
    fitThumbnail()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitThumbnail)
      return () => {
        window.removeEventListener('resize', fitThumbnail)
        host.replaceChildren()
      }
    }
    const observer = new ResizeObserver(fitThumbnail)
    observer.observe(host)
    return () => {
      observer.disconnect()
      host.replaceChildren()
    }
  }, [content])
  return <div ref={hostRef} className="relative h-full w-full overflow-hidden [&_.pptx-preview-slide-wrapper]:!m-0" />
}

function cloneStaticSlide(rendered: HTMLElement): HTMLElement {
  const clone = rendered.cloneNode(true) as HTMLElement
  const sourceCanvases = rendered.querySelectorAll<HTMLCanvasElement>('canvas')
  const clonedCanvases = clone.querySelectorAll<HTMLCanvasElement>('canvas')
  for (let index = 0; index < sourceCanvases.length; index += 1) {
    const source = sourceCanvases.item(index)
    const target = clonedCanvases.item(index)
    if (!source || !target) continue
    target.width = source.width
    target.height = source.height
    try {
      target.getContext('2d')?.drawImage(source, 0, 0)
    } catch {
      // Cross-origin media may taint a canvas; the rest of the static DOM remains usable.
    }
  }
  return clone
}

function initialSlides(slideCount: number): Set<number> {
  const count = Math.min(MAX_MOUNTED_PPTX_THUMBNAILS, Math.max(0, slideCount))
  return new Set(Array.from({ length: count }, (_, index) => index + 1))
}

function updateRequestedSlides(
  current: Set<number>,
  entries: IntersectionObserverEntry[]
): Set<number> {
  let next = new Set(current)
  for (const entry of entries) {
    if (entry.isIntersecting) continue
    const slide = slideFromTarget(entry.target)
    if (slide !== null) next.delete(slide)
  }
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const slide = slideFromTarget(entry.target)
    if (slide !== null) next = includeRequestedSlide(next, slide)
  }
  return setsEqual(current, next) ? current : next
}

function includeRequestedSlide(current: Set<number>, slide: number): Set<number> {
  if (slide < 1 || current.has(slide)) return current
  const next = new Set(current)
  if (next.size >= MAX_MOUNTED_PPTX_THUMBNAILS) {
    const oldest = next.values().next().value as number | undefined
    if (oldest !== undefined) next.delete(oldest)
  }
  next.add(slide)
  return next
}

function slideFromTarget(target: Element): number | null {
  const index = Number.parseInt(target.getAttribute('data-pptx-thumbnail-index') ?? '', 10)
  return Number.isInteger(index) && index >= 0 ? index + 1 : null
}

function pruneThumbnails(
  current: Map<number, HTMLElement>,
  allowed: Set<number>
): Map<number, HTMLElement> {
  if (current.size === 0 || Array.from(current.keys()).every((slide) => allowed.has(slide))) {
    return current
  }
  return new Map(Array.from(current).filter(([slide]) => allowed.has(slide)))
}

function capThumbnails(
  current: Map<number, HTMLElement>,
  allowed: Set<number>
): Map<number, HTMLElement> {
  const next = new Map<number, HTMLElement>()
  for (const [slide, thumbnail] of current) {
    if (!allowed.has(slide)) continue
    next.set(slide, thumbnail)
    if (next.size === MAX_MOUNTED_PPTX_THUMBNAILS) break
  }
  return next
}

function setsEqual(left: Set<number>, right: Set<number>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value))
}
