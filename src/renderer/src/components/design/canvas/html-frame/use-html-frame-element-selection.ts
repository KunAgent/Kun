import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesignHtmlPreviewHostRenderProps } from '../../DesignHtmlPreviewHost'
import type { DesignHtmlElementContext } from '../../../../design/design-composer-context'
import type { DesignArtifact } from '../../../../design/design-types'
import { registerHtmlElementValidation } from '../../../../design/html-element-reference-validation'
import {
  buildHtmlElementBoxPickScript,
  buildHtmlElementResolveScript,
  htmlElementPickResolvedStillMatches,
  buildHtmlElementPickScript,
  htmlElementCandidateLabel,
  htmlElementPickPathLabels,
  htmlElementSelectionFromChainIndex,
  normalizeHtmlElementPickResult,
  resolveHtmlElementPickSelection,
  type HtmlElementPickChain,
  type HtmlElementPickSelection
} from './html-element-pick'
import {
  hitTestHtmlElementMap,
  htmlElementBoxLabel,
  htmlElementBoxSizeLabel,
  htmlElementMapBreadcrumb,
  htmlElementMapFirstChild,
  htmlElementMapLayersAt,
  htmlElementMapParent,
  htmlElementMapSibling,
  measureHtmlElementBoxes,
  type HtmlElementBox,
  type HtmlElementMap
} from './html-element-map'
import { useHtmlFrameElementMap } from './use-html-frame-element-map'
import { useHtmlFramePickKeys } from './use-html-frame-pick-keys'

type Publish = (context: DesignHtmlElementContext | null, promptSeed?: string) => void
// Each composer owns its own reference. A disappearing frame must not clear a
// newer reference published by another frame using that composer.
const owners = new WeakMap<Publish, symbol>()
const HOVER_LEAVE_MS = 120
const RELOCATE_DELAYS_MS = [350, 900]

type Options = {
  artifact?: DesignArtifact
  canvasWidth: number
  canvasHeight: number
  /** Picking is available on this frame (select tool, not generating, not read-only). */
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

type Pick = {
  selection: HtmlElementPickSelection
  chain: HtmlElementPickChain
  epoch: string
  boxId?: number
  token?: number
}
type HoverBox = { box: HtmlElementBox; parent: HtmlElementBox | null; token: number; epoch: string }
type PointerBounds = { left: number; top: number; width: number; height: number }
export type HtmlFramePickModifiers = { deep?: boolean }
export type HtmlFrameLayerMenu = { x: number; y: number; items: { id: number; label: string }[] }

function inPreviewPoint(
  clientX: number, clientY: number, bounds: PointerBounds, opts: Options
): { x: number; y: number } {
  return {
    x: (clientX - bounds.left) / bounds.width * opts.canvasWidth,
    y: (clientY - bounds.top) / bounds.height * opts.canvasHeight
  }
}

export function useHtmlFrameElementSelection(options: Options) {
  const { artifact, editing, interactive, executeScript, shapeId, previewRevision } = options
  const epoch = JSON.stringify([
    shapeId, artifact?.id, artifact?.relativePath, previewRevision,
    options.previewWebviewUrl, options.webviewMountNonce
  ])
  const [pick, setPick] = useState<Pick | null>(null)
  const [hover, setHover] = useState<Pick | null>(null)
  const [hoverBox, setHoverBox] = useState<HoverBox | null>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  const [layerMenu, setLayerMenu] = useState<HtmlFrameLayerMenu | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const enabled = editing && !interactive
  const live = useRef({ epoch, enabled, options })
  live.current = { epoch, enabled, options }
  const current = useRef<Pick | null>(null)
  const owner = useRef(Symbol('html-selection'))
  const sequences = useRef({ select: 0, hover: 0 })
  const inFlight = useRef({ select: false, hover: false })
  const lastHover = useRef(-Infinity)
  const hoverBoxRef = useRef<HoverBox | null>(null)
  const leaveTimer = useRef<number | null>(null)
  const relocateTimers = useRef<number[]>([])
  const mounted = useRef(true)
  const validation = useRef<ReturnType<typeof registerHtmlElementValidation> | null>(null)
  const { getMap, refresh } = useHtmlFrameElementMap({
    armed: enabled && (pointerInside || Boolean(pick)),
    epoch,
    executeScript
  })

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

  const setHoverTarget = useCallback((next: HoverBox | null) => {
    hoverBoxRef.current = next
    setHoverBox(next)
  }, [])

  const clearHover = useCallback(() => {
    sequences.current.hover += 1
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    setHover(null)
    setHoverTarget(null)
  }, [setHoverTarget])

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

  const cancelRelocation = useCallback(() => {
    relocateTimers.current.forEach((timer) => window.clearTimeout(timer))
    relocateTimers.current = []
  }, [])

  const clearElementSelection = useCallback(() => {
    sequences.current.select += 1
    cancelRelocation()
    current.current = null
    setPick(null)
    setLayerMenu(null)
    clearHover()
    clearReference()
    setSelectionError('')
  }, [cancelRelocation, clearHover, clearReference])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequences.current.select += 1
      sequences.current.hover += 1
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
      cancelRelocation()
      clearReference()
    }
  }, [cancelRelocation, clearReference])

  // The document was replaced (usually Kun finished an edit). Keep the pick and
  // look the same element up again; only an element that can no longer be
  // identified is dropped.
  useEffect(() => {
    const previous = current.current
    sequences.current.select += 1
    clearHover()
    setLayerMenu(null)
    if (!previous || previous.epoch === epoch) return
    cancelRelocation()
    const attempt = (index: number): void => {
      if (!mounted.current || current.current !== previous) return
      const pending = live.current.options.executeScript(
        buildHtmlElementResolveScript(previous.selection.element.selector)
      )
      void (async () => {
        const resolved = pending ? normalizeHtmlElementPickResult(await pending.catch(() => null)) : null
        if (!mounted.current || current.current !== previous) return
        const selection = resolved && htmlElementPickResolvedStillMatches(previous.selection.element, resolved)
          ? htmlElementSelectionFromChainIndex(resolved, 0) : null
        if (resolved && selection) {
          apply({ selection, chain: resolved, epoch: live.current.epoch })
          return
        }
        if (index + 1 < RELOCATE_DELAYS_MS.length) {
          relocateTimers.current.push(window.setTimeout(() => attempt(index + 1), RELOCATE_DELAYS_MS[index + 1]))
          return
        }
        clearElementSelection()
        setSelectionError('The design changed. Select the component again.')
      })()
    }
    relocateTimers.current.push(window.setTimeout(() => attempt(0), RELOCATE_DELAYS_MS[0]))
  }, [epoch, apply, cancelRelocation, clearElementSelection, clearHover])

  useEffect(() => {
    if (enabled) return
    setPointerInside(false)
    clearHover()
    setLayerMenu(null)
  }, [enabled, clearHover])

  const selectChain = useCallback((
    chain: HtmlElementPickChain | null, capturedEpoch: string, extra: { boxId?: number; token?: number }, deep: boolean
  ): boolean => {
    const selection = chain && (deep || extra.boxId !== undefined
      ? htmlElementSelectionFromChainIndex(chain, 0)
      : resolveHtmlElementPickSelection(chain))
    if (!chain || !selection || !selection.element.selectorIsUnique) return false
    apply({ selection, chain, epoch: capturedEpoch, ...extra })
    return true
  }, [apply])

  /** Select a map box. Stale tokens refresh the map once and give up quietly. */
  const selectBox = useCallback(async (id: number, token: number): Promise<boolean> => {
    if (!live.current.enabled) return false
    const capturedEpoch = live.current.epoch
    const sequence = ++sequences.current.select
    const pending = live.current.options.executeScript(buildHtmlElementBoxPickScript(id, token))
    if (!pending) return false
    try {
      const value = await pending
      if (!mounted.current || sequence !== sequences.current.select || capturedEpoch !== live.current.epoch) return false
      const chain = normalizeHtmlElementPickResult(value)
      if (chain && selectChain(chain, capturedEpoch, { boxId: id, token }, false)) return true
      if ((value as { reason?: string } | null)?.reason === 'stale') void refresh(true)
      setSelectionError('Unable to select this component. Try another element.')
    } catch {
      setSelectionError('Unable to read this component. Try again when the preview is ready.')
    }
    return false
  }, [refresh, selectChain])

  const legacyPick = useCallback((
    point: { x: number; y: number }, mode: 'hover' | 'select', deep: boolean
  ) => {
    const opts = live.current.options
    const capturedEpoch = live.current.epoch
    const sequence = ++sequences.current[mode]
    inFlight.current[mode] = true
    const valid = () => mounted.current && live.current.enabled &&
      capturedEpoch === live.current.epoch && sequences.current[mode] === sequence
    void (async () => {
      try {
        const pending = opts.executeScript(buildHtmlElementPickScript(point))
        if (!pending) throw new Error('Preview is not ready.')
        const value = await pending
        if (!valid()) return
        const chain = normalizeHtmlElementPickResult(value)
        const selection = chain && (deep ? htmlElementSelectionFromChainIndex(chain, 0) : resolveHtmlElementPickSelection(chain))
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
  }, [apply, clearElementSelection])

  const hoverClient = useCallback((
    clientX: number, clientY: number, bounds: PointerBounds, mods: HtmlFramePickModifiers = {}
  ) => {
    if (!live.current.enabled || !live.current.options.artifact) return
    if (!bounds.width || !bounds.height) return
    setPointerInside(true)
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    const point = inPreviewPoint(clientX, clientY, bounds, live.current.options)
    const map = getMap()
    if (map && !mods.deep) {
      setHover(null)
      const box = hitTestHtmlElementMap(map, point)
      const previous = hoverBoxRef.current
      if (!box) return
      if (previous && previous.box.id === box.id && previous.token === map.token) return
      setHoverTarget({ box, parent: htmlElementMapParent(map, box.id), token: map.token, epoch: live.current.epoch })
      return
    }
    if (inFlight.current.hover || inFlight.current.select || Date.now() - lastHover.current < 90) return
    lastHover.current = Date.now()
    setHoverTarget(null)
    legacyPick(point, 'hover', Boolean(mods.deep))
  }, [getMap, legacyPick, setHoverTarget])

  const leave = useCallback(() => {
    setPointerInside(false)
    // A response still in flight belongs to a pointer that is gone.
    sequences.current.hover += 1
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setHover(null)
      setHoverTarget(null)
    }, HOVER_LEAVE_MS)
  }, [setHoverTarget])

  const selectClient = useCallback((
    clientX: number, clientY: number, bounds: PointerBounds, mods: HtmlFramePickModifiers = {}
  ) => {
    if (!live.current.enabled || !live.current.options.artifact) return
    if (!bounds.width || !bounds.height) return
    clearHover()
    setLayerMenu(null)
    const point = inPreviewPoint(clientX, clientY, bounds, live.current.options)
    const map = getMap()
    const box = map && !mods.deep ? hitTestHtmlElementMap(map, point) : null
    if (map && box) {
      void selectBox(box.id, map.token).then((ok) => {
        if (!ok && live.current.enabled && mounted.current && current.current === null) {
          legacyPick(point, 'select', false)
        }
      })
      return
    }
    legacyPick(point, 'select', Boolean(mods.deep))
  }, [clearHover, getMap, legacyPick, selectBox])

  const hoverAt = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!live.current.enabled) return
    hoverClient(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(),
      { deep: event.metaKey || event.ctrlKey })
  }, [hoverClient])

  const selectElementAt = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!live.current.enabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    selectClient(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(),
      { deep: event.metaKey || event.ctrlKey })
  }, [selectClient])

  const selectIndex = useCallback((index: number) => {
    const value = current.current
    if (!value || value.epoch !== live.current.epoch) return
    const selection = htmlElementSelectionFromChainIndex(value.chain, index)
    if (selection) apply({ ...value, selection, boxId: undefined, token: undefined })
  }, [apply])

  const mapForPick = useCallback((): { map: HtmlElementMap; boxId: number } | null => {
    const value = current.current
    const map = getMap()
    if (!value || value.boxId === undefined || !map || map.token !== value.token) return null
    return { map, boxId: value.boxId }
  }, [getMap])

  const selectParentElement = useCallback(() => {
    const boxed = mapForPick()
    const parent = boxed && htmlElementMapParent(boxed.map, boxed.boxId)
    if (boxed && parent) { void selectBox(parent.id, boxed.map.token); return }
    const value = current.current
    if (value?.selection.ancestors[0]) selectIndex(value.chain.chain.indexOf(value.selection.ancestors[0]))
  }, [mapForPick, selectBox, selectIndex])

  const selectChildElement = useCallback(() => {
    const boxed = mapForPick()
    const child = boxed && htmlElementMapFirstChild(boxed.map, boxed.boxId)
    if (boxed && child) void selectBox(child.id, boxed.map.token)
  }, [mapForPick, selectBox])

  const selectSiblingElement = useCallback((step: 1 | -1) => {
    const boxed = mapForPick()
    const sibling = boxed && htmlElementMapSibling(boxed.map, boxed.boxId, step)
    if (boxed && sibling) void selectBox(sibling.id, boxed.map.token)
  }, [mapForPick, selectBox])

  const selectBreadcrumb = useCallback((id: number) => {
    const map = getMap()
    if (map) void selectBox(id, map.token)
  }, [getMap, selectBox])

  const openLayerMenu = useCallback((clientX: number, clientY: number, bounds: PointerBounds) => {
    const map = getMap()
    if (!live.current.enabled || !map || !bounds.width || !bounds.height) return false
    const point = inPreviewPoint(clientX, clientY, bounds, live.current.options)
    const items = htmlElementMapLayersAt(map, point)
      .map((box) => ({ id: box.id, label: htmlElementBoxLabel(box) }))
    if (!items.length) return false
    setLayerMenu({ x: clientX - bounds.left, y: clientY - bounds.top, items })
    return true
  }, [getMap])

  const previewLayer = useCallback((id: number | null) => {
    const map = getMap()
    const box = id === null || !map ? null : map.boxes[id]
    setHoverTarget(box && map ? { box, parent: htmlElementMapParent(map, box.id), token: map.token, epoch: live.current.epoch } : null)
  }, [getMap, setHoverTarget])

  const chooseLayer = useCallback((id: number) => {
    const map = getMap()
    setLayerMenu(null)
    if (map) void selectBox(id, map.token)
  }, [getMap, selectBox])

  useHtmlFramePickKeys({
    enabled,
    hasSelection: Boolean(pick),
    onUp: selectParentElement,
    onDown: selectChildElement,
    onSibling: selectSiblingElement,
    onClear: clearElementSelection,
    onCloseMenu: () => setLayerMenu(null),
    menuOpen: Boolean(layerMenu),
    canGoUp: () => {
      const boxed = mapForPick()
      return Boolean(
        (boxed && htmlElementMapParent(boxed.map, boxed.boxId)) || current.current?.selection.ancestors.length
      )
    },
    onAlt: setAltHeld
  })

  const updateSelectedElementText = useCallback((text: string, html?: string) => {
    const value = current.current
    if (!value) return
    apply({ ...value, selection: { ...value.selection, element: {
      ...value.selection.element, text, ...(html !== undefined ? { html } : {})
    } } })
  }, [apply])

  const selected = pick?.epoch === epoch ? pick.selection : null
  const legacyHovered = hover?.epoch === epoch ? hover.selection.element : null
  const boxHovered = hoverBox?.epoch === epoch ? hoverBox : null
  const hoverIsSelection = Boolean(
    (boxHovered && pick && pick.boxId === boxHovered.box.id && pick.token === boxHovered.token) ||
    (legacyHovered && legacyHovered.selector === selected?.element.selector)
  )
  const map = getMap()
  const selectedBox = selected && pick?.boxId !== undefined && map && map.token === pick.token
    ? map.boxes[pick.boxId] : null
  const crumbBoxId = selectedBox?.id ?? boxHovered?.box.id
  const crumbs = useMemo(() => {
    if (!map || crumbBoxId === undefined || map.token !== (selectedBox ? pick?.token : boxHovered?.token)) return []
    return htmlElementMapBreadcrumb(map, crumbBoxId).map((crumb) => ({
      ...crumb, current: crumb.id === crumbBoxId
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, crumbBoxId, selectedBox, boxHovered])
  const hoverRect = boxHovered
    ? { left: boxHovered.box.x, top: boxHovered.box.y, width: boxHovered.box.w, height: boxHovered.box.h }
    : legacyHovered?.rect ?? null
  const measureLines = useMemo(() => {
    if (!altHeld || !selected || !boxHovered || hoverIsSelection) return []
    const rect = selected.element.rect
    return measureHtmlElementBoxes(
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      { x: boxHovered.box.x, y: boxHovered.box.y, w: boxHovered.box.w, h: boxHovered.box.h }
    )
  }, [altHeld, selected, boxHovered, hoverIsSelection])
  return {
    selectionError,
    hoverRect,
    hoverLabel: boxHovered ? htmlElementBoxLabel(boxHovered.box)
      : legacyHovered ? htmlElementCandidateLabel(legacyHovered) : '',
    hoverSize: boxHovered ? htmlElementBoxSizeLabel(boxHovered.box) : '',
    hoverParentRect: boxHovered?.parent && !boxHovered.parent.shell
      ? { left: boxHovered.parent.x, top: boxHovered.parent.y, width: boxHovered.parent.w, height: boxHovered.parent.h }
      : null,
    hoverIsSelection,
    selectedElementRect: selected?.element.rect ?? null,
    selectedPadding: selectedBox?.pad ?? null,
    measureLines,
    crumbs,
    layerMenu,
    selectedElementContext: pick ? contextFor(pick) : null,
    selectionLabel: selected ? htmlElementCandidateLabel(selected.element) : '',
    selectionPath: selected ? htmlElementPickPathLabels(selected) : [],
    canSelectParent: Boolean(selected && (
      selected.ancestors.length || (selectedBox && map && htmlElementMapParent(map, selectedBox.id))
    )),
    canDrillToHit: Boolean(selected && selected.element.selector !== selected.hit.selector),
    canEditText: Boolean(selected?.element.editableText),
    hoverAt,
    hoverClient,
    leave,
    clearHover: leave,
    selectElementAt,
    selectClient,
    selectParentElement,
    selectHitElement: () => selectIndex(0),
    selectBreadcrumb,
    openLayerMenu,
    closeLayerMenu: () => setLayerMenu(null),
    previewLayer,
    chooseLayer,
    clearElementSelection,
    updateSelectedElementText
  }
}
