import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignHtmlPreviewHostRenderProps } from '../../DesignHtmlPreviewHost'
import type { DesignHtmlElementContext } from '../../../../design/design-composer-context'
import type { DesignArtifact } from '../../../../design/design-types'
import { registerHtmlElementValidation } from '../../../../design/html-element-reference-validation'
import {
  buildHtmlElementResolveScript,
  htmlElementPickResolvedStillMatches,
  buildHtmlElementPickScript,
  htmlElementCandidateLabel,
  htmlElementPickPathLabels,
  normalizeHtmlElementPickResult,
  resolveHtmlElementPickSelection,
  type HtmlElementPickChain,
  type HtmlElementPickSelection
} from './html-element-pick'

type Publish = (context: DesignHtmlElementContext | null, promptSeed?: string) => void
// Each composer owns its own reference. A disappearing frame must not clear a
// newer reference published by another frame using that composer.
const owners = new WeakMap<Publish, symbol>()

type Options = {
  artifact?: DesignArtifact
  canvasWidth: number
  canvasHeight: number
  editing: boolean
  interactive: boolean
  executeScript: DesignHtmlPreviewHostRenderProps['executeScript']
  shapeId: string
  previewRevision: number
  previewWebviewUrl?: string
  webviewMountNonce?: number
  setFileError: (message: string) => void
  setLocalPreviewError: (message: string) => void
  onUseElementAsContext?: Publish
}

type Pick = { selection: HtmlElementPickSelection; chain: HtmlElementPickChain; epoch: string }

export function useHtmlFrameElementSelection(options: Options) {
  const { artifact, editing, interactive, executeScript, shapeId, previewRevision } = options
  const epoch = JSON.stringify([
    shapeId, artifact?.id, artifact?.relativePath, previewRevision,
    options.previewWebviewUrl, options.webviewMountNonce
  ])
  const [pick, setPick] = useState<Pick | null>(null)
  const [hover, setHover] = useState<Pick | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const live = useRef({ epoch, enabled: editing && !interactive, options })
  live.current = { epoch, enabled: editing && !interactive, options }
  const current = useRef<Pick | null>(null)
  const owner = useRef(Symbol('html-selection'))
  const sequences = useRef({ select: 0, hover: 0 })
  const inFlight = useRef({ select: false, hover: false })
  const lastHover = useRef(-Infinity)
  const mounted = useRef(true)
  const validation = useRef<ReturnType<typeof registerHtmlElementValidation> | null>(null)

  const clearReference = useCallback(() => {
    validation.current?.release()
    validation.current = null
    const publish = live.current.options.onUseElementAsContext
    if (publish && owners.get(publish) === owner.current) {
      owners.delete(publish)
      publish(null)
    }
  }, [])

  const contextFor = useCallback((value: Pick): DesignHtmlElementContext | null => {
    const opts = live.current.options
    const source = opts.artifact
    if (!source || value.epoch !== live.current.epoch) return null
    const node = value.selection.element
    return {
      artifactId: source.id, artifactTitle: source.title,
      artifactRelativePath: source.relativePath,
      selector: node.selector, tagName: node.tagName, text: node.text, html: node.html,
      label: htmlElementCandidateLabel(node), path: htmlElementPickPathLabels(value.selection),
      frameId: opts.shapeId, previewRevision: opts.previewRevision,
      validationToken: validation.current?.token,
      ...(node.componentName ? { componentName: node.componentName } : {})
    }
  }, [])

  const clearHover = useCallback(() => {
    sequences.current.hover += 1
    setHover(null)
  }, [])

  const apply = useCallback((value: Pick) => {
    validation.current?.release()
    validation.current = registerHtmlElementValidation(async () => {
      if (!mounted.current || value.epoch !== live.current.epoch || current.current !== value) return false
      const pending = live.current.options.executeScript(buildHtmlElementResolveScript(value.selection.element.selector))
      if (!pending) return false
      const resolved = normalizeHtmlElementPickResult(await pending)
      return Boolean(mounted.current && value.epoch === live.current.epoch && current.current === value &&
        resolved && htmlElementPickResolvedStillMatches(value.selection.element, resolved))
    })
    current.current = value
    setPick(value)
    clearHover()
    setSelectionError('')
    const context = contextFor(value)
    const publish = live.current.options.onUseElementAsContext
    if (context && publish) {
      owners.set(publish, owner.current)
      publish(context)
    }
  }, [clearHover, contextFor])

  const clearElementSelection = useCallback(() => {
    sequences.current.select += 1
    current.current = null
    setPick(null)
    clearHover()
    clearReference()
    setSelectionError('')
  }, [clearHover, clearReference])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequences.current.select += 1
      sequences.current.hover += 1
      clearReference()
    }
  }, [clearReference])

  useEffect(() => {
    // Do not rebind a positional selector across document revisions. A fresh
    // click is required, even if a similar-looking sibling occupies that path.
    if (current.current && current.current.epoch !== epoch) {
      clearElementSelection()
      setSelectionError('The design changed. Select the component again.')
    }
    sequences.current.select += 1
    clearHover()
  }, [epoch, editing, interactive, clearElementSelection, clearHover])

  const runPick = useCallback((event: React.PointerEvent<HTMLDivElement>, mode: 'hover' | 'select') => {
    if (!live.current.enabled || !live.current.options.artifact) return
    if (mode === 'select' && event.button !== 0) return
    if (mode === 'hover') {
      if (inFlight.current.hover || inFlight.current.select || Date.now() - lastHover.current < 90) return
      lastHover.current = Date.now()
    } else {
      event.preventDefault()
      event.stopPropagation()
      clearHover()
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const opts = live.current.options
    const point = {
      x: (event.clientX - bounds.left) / bounds.width * opts.canvasWidth,
      y: (event.clientY - bounds.top) / bounds.height * opts.canvasHeight
    }
    const capturedEpoch = live.current.epoch
    const sequence = ++sequences.current[mode]
    inFlight.current[mode] = true
    const valid = () => mounted.current && live.current.enabled &&
      capturedEpoch === live.current.epoch && sequences.current[mode] === sequence
    void (async () => {
      try {
        const pending = executeScript(buildHtmlElementPickScript(point))
        if (!pending) throw new Error('Preview is not ready.')
        const value = await pending
        if (!valid()) return
        const chain = normalizeHtmlElementPickResult(value)
        const selection = chain && resolveHtmlElementPickSelection(chain)
        if (!chain || !selection || !selection.element.selectorIsUnique) {
          if (mode === 'hover') setHover(null)
          else {
            clearElementSelection()
            if ((value as { reason?: string } | null)?.reason !== 'empty') {
              setSelectionError('Unable to select this component. Try another element.')
            }
          }
          return
        }
        const next = { selection, chain, epoch: capturedEpoch }
        if (mode === 'hover') setHover(next)
        else apply(next)
      } catch {
        if (valid() && mode === 'select') {
          clearElementSelection()
          setSelectionError('Unable to read this component. Try again when the preview is ready.')
        }
      } finally {
        inFlight.current[mode] = false
      }
    })()
  }, [apply, clearElementSelection, clearHover, executeScript])

  const selectIndex = useCallback((index: number) => {
    const value = current.current
    if (!value || value.epoch !== live.current.epoch) return
    const element = value.chain.chain[index]
    if (!element) return
    apply({ ...value, selection: {
      element, hit: value.chain.chain[0],
      ancestors: value.chain.chain.slice(index + 1).filter((node) => node.rect.width >= 4 && node.rect.height >= 4)
    } })
  }, [apply])

  useEffect(() => {
    if (!editing || interactive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !current.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      clearElementSelection()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editing, interactive, clearElementSelection])

  const updateSelectedElementText = useCallback((text: string, html?: string) => {
    const value = current.current
    if (!value) return
    apply({ ...value, selection: { ...value.selection, element: {
      ...value.selection.element, text, ...(html !== undefined ? { html } : {})
    } } })
  }, [apply])

  const selected = pick?.epoch === epoch ? pick.selection : null
  const hovered = hover?.epoch === epoch ? hover.selection.element : null
  return {
    selectionError,
    hoverRect: hovered?.rect ?? null,
    hoverLabel: hovered ? htmlElementCandidateLabel(hovered) : '',
    hoverIsSelection: Boolean(hovered && hovered.selector === selected?.element.selector),
    selectedElementRect: selected?.element.rect ?? null,
    selectedElementContext: pick ? contextFor(pick) : null,
    selectionLabel: selected ? htmlElementCandidateLabel(selected.element) : '',
    selectionPath: selected ? htmlElementPickPathLabels(selected) : [],
    canSelectParent: Boolean(selected?.ancestors.length),
    canDrillToHit: Boolean(selected && selected.element.selector !== selected.hit.selector),
    canEditText: Boolean(selected?.element.editableText),
    hoverAt: (event: React.PointerEvent<HTMLDivElement>) => runPick(event, 'hover'),
    clearHover,
    selectElementAt: (event: React.PointerEvent<HTMLDivElement>) => runPick(event, 'select'),
    selectParentElement: () => {
      const value = current.current
      if (value?.selection.ancestors[0]) selectIndex(value.chain.chain.indexOf(value.selection.ancestors[0]))
    },
    selectHitElement: () => selectIndex(0),
    clearElementSelection,
    updateSelectedElementText
  }
}
