import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { GripVertical, Plus, createElement } from './lucide-dom-icons'
import type { WorkDocContext } from '../../markdown/document-codec'
import { blockTargetFromCoords, type BlockTarget } from './block-target'
import { openBlockMenu, type BlockMenuDeps, type BlockMenuHandle } from './block-menu'
import { createHoverIntent } from './hover-intent'
import { bodyZoom, toLayoutPx } from '../../../lib/body-zoom'

export type WriteBlockHandleOptions = {
  getCtx: () => WorkDocContext
  getFilePath: () => string
  getWorkspaceRoot: () => string
  isReadOnly: () => boolean
  isReviewActive: () => boolean
}

const HANDLE_HIDE_DELAY_MS = 300
const MENU_HOVER_OPEN_MS = 350
const MENU_HOVER_CLOSE_MS = 200
const TOUCH_PRESS_MS = 500

/**
 * Notion-style block handle (implementation §9.1): a `+` and a grip button
 * parked in the left gutter next to the hovered top-level block (list items
 * count as blocks). `+` inserts an empty paragraph after the block and
 * opens the slash menu; the grip opens the block menu and starts drag-moves.
 * The menu opens on a 350ms hover and pins on click; while open the target
 * block gets an `is-block-menu-target` decoration instead of a selection so
 * the user's caret stays put.
 */
export const WriteBlockHandle = Extension.create<WriteBlockHandleOptions>({
  name: 'writeBlockHandle',

  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    const menuKey = new PluginKey<number | null>('writeBlockHandleMenu')

    return [
      new Plugin<number | null>({
        key: menuKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(menuKey) as { menuTargetPos?: number | null } | undefined
            if (meta && 'menuTargetPos' in meta) return meta.menuTargetPos ?? null
            return value === null ? null : tr.mapping.map(value)
          }
        },
        props: {
          decorations(state) {
            const pos = menuKey.getState(state)
            if (pos === null || pos === undefined || pos >= state.doc.content.size) return null
            const node = state.doc.nodeAt(pos)
            if (!node) return null
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, { class: 'is-block-menu-target' })
            ])
          }
        },
        view(editorView) {
          const host = editorView.dom.parentElement ?? editorView.dom
          if (getComputedStyle(host).position === 'static') {
            host.style.position = 'relative'
          }
          const layer = document.createElement('div')
          layer.className = 'write-block-handle'
          layer.style.display = 'none'

          const addButton = document.createElement('button')
          addButton.type = 'button'
          addButton.className = 'write-block-handle-button write-block-handle-add'
          addButton.append(createElement(Plus, { width: 16, height: 16, 'stroke-width': 1.75 }))
          addButton.setAttribute('aria-label', 'insert block')

          const gripButton = document.createElement('button')
          gripButton.type = 'button'
          gripButton.className = 'write-block-handle-button write-block-handle-grip'
          gripButton.append(createElement(GripVertical, { width: 14, height: 16, 'stroke-width': 1.75 }))
          gripButton.setAttribute('aria-label', 'block menu')
          gripButton.draggable = true

          layer.append(addButton, gripButton)
          host.append(layer)

          let target: BlockTarget | null = null
          let hideTimer: number | null = null
          let frame = 0
          let menuOpen = false
          let menuHandle: BlockMenuHandle | null = null

          const menuDeps: BlockMenuDeps = {
            editor,
            getCtx: options.getCtx,
            getFilePath: options.getFilePath,
            getWorkspaceRoot: options.getWorkspaceRoot,
            isReadOnly: options.isReadOnly
          }

          const setMenuTarget = (pos: number | null): void => {
            editorView.dispatch(editorView.state.tr.setMeta(menuKey, { menuTargetPos: pos }))
          }

          const hide = (): void => {
            layer.style.display = 'none'
            target = null
          }

          const scheduleHide = (): void => {
            if (hideTimer !== null) window.clearTimeout(hideTimer)
            hideTimer = window.setTimeout(() => {
              if (!menuOpen) hide()
            }, HANDLE_HIDE_DELAY_MS)
          }

          const cancelHide = (): void => {
            if (hideTimer !== null) {
              window.clearTimeout(hideTimer)
              hideTimer = null
            }
          }

          const positionFor = (next: BlockTarget): void => {
            const dom = editorView.nodeDOM(next.pos)
            if (!(dom instanceof HTMLElement)) {
              hide()
              return
            }
            const hostRect = host.getBoundingClientRect()
            const rect = dom.getBoundingClientRect()
            const zoom = bodyZoom()
            // List markers hang left of the <li> box inside the list's
            // padding — anchor to the parent list edge so the grip doesn't
            // cover the bullet/number.
            const parent = dom.parentElement
            const leftEdge =
              parent && (parent.tagName === 'UL' || parent.tagName === 'OL')
                ? parent.getBoundingClientRect().left
                : rect.left
            target = next
            layer.style.display = 'flex'
            layer.style.top = `${toLayoutPx(rect.top - hostRect.top, zoom) + host.scrollTop}px`
            layer.style.height = `${Math.min(toLayoutPx(rect.height, zoom), 28)}px`
            layer.style.left = `${toLayoutPx(leftEdge - hostRect.left, zoom) - 46}px`
          }

          const openMenu = (pinned: boolean): void => {
            if (!target || menuOpen) return
            menuOpen = true
            setMenuTarget(target.pos)
            menuHandle = openBlockMenu(menuDeps, target, gripButton, {
              focusOnOpen: pinned,
              onMenuEnter: () => hover.enterMenu(),
              onMenuLeave: () => hover.leaveMenu(),
              onSubmenuOpen: () => hover.pin(),
              onClosed: () => {
                // Every close path (item run, Esc, outside pointer, scroll)
                // funnels here so hover state and the highlight stay in sync.
                menuOpen = false
                menuHandle = null
                setMenuTarget(null)
                hover.closeNow()
              }
            })
          }

          const hover = createHoverIntent({
            openDelay: MENU_HOVER_OPEN_MS,
            closeDelay: MENU_HOVER_CLOSE_MS,
            onOpen: openMenu,
            onClose: () => menuHandle?.close()
          })

          const update = (event: MouseEvent): void => {
            if (
              options.isReadOnly() ||
              options.isReviewActive() ||
              editorView.dragging != null
            ) {
              scheduleHide()
              return
            }
            // Aim at the left edge of the text column so hovering the gutter
            // still resolves to the block on that line.
            const contentRect = editorView.dom.getBoundingClientRect()
            const next = blockTargetFromCoords(
              editorView,
              contentRect.left + 24,
              event.clientY
            )
            if (!next) {
              scheduleHide()
              return
            }
            cancelHide()
            positionFor(next)
          }

          const onMouseMove = (event: MouseEvent): void => {
            if (frame) return
            frame = window.requestAnimationFrame(() => {
              frame = 0
              update(event)
            })
          }

          const onMouseLeave = (): void => scheduleHide()

          const onAdd = (event: MouseEvent): void => {
            event.preventDefault()
            if (!target) return
            const insertPos = target.pos + target.node.nodeSize
            const paragraph = editor.state.schema.nodes.paragraph
            if (!paragraph) return
            const tr = editor.state.tr.insert(insertPos, paragraph.create())
            tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))
            tr.insertText('/', insertPos + 1)
            editor.view.dispatch(tr.scrollIntoView())
            editor.commands.focus()
            hide()
          }

          const onGripClick = (event: MouseEvent): void => {
            event.preventDefault()
            if (!target) return
            if (hover.isOpen()) {
              hover.pin()
              return
            }
            hover.openNow()
          }

          const onGripEnter = (event: MouseEvent): void => {
            // No armed button, no in-flight drag, no box selection in progress.
            if (event.buttons !== 0 || editorView.dragging != null) return
            if (host.querySelector('.write-block-box-select')) return
            hover.enterTrigger()
          }
          const onGripLeave = (): void => hover.leaveTrigger()

          // Touch screens have no hover: a long-press on a block opens the
          // same block menu (the `+` affordance stays reachable via `/`).
          let pressTimer: number | null = null
          let pressStart: { x: number; y: number } | null = null

          const cancelPress = (): void => {
            if (pressTimer !== null) {
              window.clearTimeout(pressTimer)
              pressTimer = null
            }
            pressStart = null
          }

          const onPointerDown = (event: PointerEvent): void => {
            if (event.pointerType !== 'touch') return
            if (options.isReadOnly() || options.isReviewActive()) return
            pressStart = { x: event.clientX, y: event.clientY }
            const next = blockTargetFromCoords(editorView, event.clientX, event.clientY)
            if (!next) return
            pressTimer = window.setTimeout(() => {
              pressTimer = null
              target = next
              positionFor(next)
              hover.openNow()
            }, TOUCH_PRESS_MS)
          }

          const onPointerMove = (event: PointerEvent): void => {
            if (pressTimer === null || !pressStart) return
            const dx = event.clientX - pressStart.x
            const dy = event.clientY - pressStart.y
            if (dx * dx + dy * dy > 100) cancelPress()
          }

          const onContextMenu = (event: Event): void => {
            // Long-press already opened our menu — swallow the native one.
            if (menuOpen) event.preventDefault()
          }

          const onDragStart = (event: DragEvent): void => {
            hover.closeNow()
            menuHandle?.close()
            if (!target || !event.dataTransfer) {
              event.preventDefault()
              return
            }
            const { state } = editorView
            const selection = NodeSelection.create(state.doc, target.pos)
            editorView.dispatch(state.tr.setSelection(selection))
            const slice = selection.content()
            const serialized = editorView.serializeForClipboard(slice)
            event.dataTransfer.setData('text/html', serialized.dom.innerHTML)
            event.dataTransfer.setData('text/plain', slice.content.textBetween(0, slice.content.size, '\n', '\n'))
            const dom = editorView.nodeDOM(target.pos)
            if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0)
            event.dataTransfer.effectAllowed = 'move'
            editorView.dragging = { slice, move: true }
            host.dataset.dragging = 'true'
            // Hiding the drag source (or its box) inside `dragstart` aborts the
            // native drag in Chromium — `dragend` fires immediately. Defer the
            // hide to the next task so the drag session is established first.
            window.setTimeout(hide, 0)
          }

          const onDragEnd = (): void => {
            delete host.dataset.dragging
            // Dropping outside the editor never runs PM's drop cleanup —
            // a stale `dragging` would turn the next external drop into a
            // block move and delete the selected block.
            editorView.dragging = null
          }

          addButton.addEventListener('click', onAdd)
          gripButton.addEventListener('click', onGripClick)
          gripButton.addEventListener('mouseenter', onGripEnter)
          gripButton.addEventListener('mouseleave', onGripLeave)
          gripButton.addEventListener('dragstart', onDragStart)
          gripButton.addEventListener('dragend', onDragEnd)
          layer.addEventListener('mouseenter', cancelHide)
          layer.addEventListener('mouseleave', scheduleHide)
          host.addEventListener('mousemove', onMouseMove)
          host.addEventListener('mouseleave', onMouseLeave)
          host.addEventListener('pointerdown', onPointerDown)
          host.addEventListener('pointermove', onPointerMove)
          host.addEventListener('pointerup', cancelPress)
          host.addEventListener('pointercancel', cancelPress)
          host.addEventListener('contextmenu', onContextMenu)

          return {
            update(view) {
              if (view.dom.parentElement !== host && view.dom.parentElement) {
                host.removeEventListener('mousemove', onMouseMove)
                host.removeEventListener('mouseleave', onMouseLeave)
                const nextHost = view.dom.parentElement
                nextHost.append(layer)
                nextHost.addEventListener('mousemove', onMouseMove)
                nextHost.addEventListener('mouseleave', onMouseLeave)
              }
            },
            destroy() {
              if (frame) window.cancelAnimationFrame(frame)
              if (hideTimer !== null) window.clearTimeout(hideTimer)
              cancelPress()
              hover.dispose()
              menuHandle?.close()
              host.removeEventListener('mousemove', onMouseMove)
              host.removeEventListener('mouseleave', onMouseLeave)
              host.removeEventListener('pointerdown', onPointerDown)
              host.removeEventListener('pointermove', onPointerMove)
              host.removeEventListener('pointerup', cancelPress)
              host.removeEventListener('pointercancel', cancelPress)
              host.removeEventListener('contextmenu', onContextMenu)
              layer.remove()
            }
          }
        }
      })
    ]
  }
})
