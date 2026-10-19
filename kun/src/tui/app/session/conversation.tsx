import { CliRenderEvents, RGBA, type MouseEvent, type ScrollBoxRenderable } from '@opentui/core'
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js'
import type { ViewportScroll } from '../../session/session-types.js'
import { firstMountedEntry, MOUNT_BUDGET, MOUNT_STEP, trimmedMountStart } from '../../session-view-model.js'
import { useApp } from '../context.js'
import { sameRenderOptions, TranscriptList, type EntryRenderOptions } from '../transcript/entry-view.js'
import { Line, seg } from '../ui.js'

/**
 * The scrollable conversation. New output keeps the view pinned to the
 * bottom until the reader scrolls up; scrolling back down re-pins it. Long
 * threads mount only their recent entries and load older ones at the top.
 */
export function Conversation(): JSX.Element {
  const app = useApp()
  const session = app.session
  let scroll: ScrollBoxRenderable | undefined
  const entries = createMemo(() => {
    app.tick()
    return session.entries
  })
  const threadId = createMemo(() => {
    app.tick()
    return session.state.projection?.thread.id
  })
  // Index of the first mounted entry; it moves only on purpose (load older,
  // jump to first, trim while pinned), never because new output arrived.
  const [start, setStart] = createSignal(firstMountedEntry(entries().length, MOUNT_BUDGET))
  const [away, setAway] = createSignal(false)
  const hidden = createMemo(() => Math.min(start(), entries().length))
  const visible = createMemo(() => (hidden() ? entries().slice(hidden()) : entries()))
  const emptySession = createMemo(() => {
    app.tick()
    const projection = session.state.projection
    return Boolean(projection && !projection.items.length && !entries().length)
  })
  // Callbacks are created once so the options compare equal between ticks.
  const reasoningExpanded = (itemId: string, fallback: boolean): boolean => session.reasoningExpanded(itemId) ?? fallback
  const onToggleReasoning = (itemId: string): void => session.handleLiveClick({ kind: 'thinking', itemId })
  const onOpenChild = (childId: string): void => session.handleLiveClick({ kind: 'child', childId })
  const renderOptions = (frame: number): EntryRenderOptions => ({
    details: session.showToolDetails,
    showReasoning: session.showReasoning,
    frame,
    legacyGui: app.controller.runtime.legacyGui === true,
    attachments: session.state.attachmentMetadata,
    clickable: session.pointerMode,
    reasoningExpanded,
    onToggleReasoning,
    onOpenChild
  })
  const options = createMemo(() => {
    app.tick()
    return renderOptions(session.animationFrame)
  }, undefined, { equals: sameRenderOptions })
  // Finished entries have no spinner: they skip animation ticks entirely.
  const settledOptions = createMemo(() => {
    app.tick()
    return renderOptions(0)
  }, undefined, { equals: sameRenderOptions })

  // Layout-dependent work runs after a frame: keep the reader's place when
  // older entries are mounted above, honor "first", track the bottom.
  let anchor: { height: number; top: number } | undefined
  let pendingTop = false
  const afterFrame = (): void => {
    if (!scroll || scroll.isDestroyed) return
    if (anchor && scroll.scrollHeight !== anchor.height) {
      scroll.scrollTop = anchor.top + (scroll.scrollHeight - anchor.height)
      anchor = undefined
      app.renderer.requestRender()
    }
    if (pendingTop) {
      pendingTop = false
      scroll.scrollTo(0)
      app.renderer.requestRender()
    }
    const bottom = scroll.scrollTop + scroll.viewport.height >= scroll.scrollHeight - 1
    if (away() === bottom) setAway(!bottom)
    const trimmed = trimmedMountStart(entries().length, start(), bottom && !anchor && !pendingTop)
    if (trimmed !== start()) setStart(trimmed)
  }
  app.renderer.on(CliRenderEvents.FRAME, afterFrame)
  onCleanup(() => app.renderer.off(CliRenderEvents.FRAME, afterFrame))

  const revealOlder = (): void => {
    if (!scroll || hidden() === 0) return
    anchor = { height: scroll.scrollHeight, top: scroll.scrollTop }
    setStart((value) => Math.max(0, value - MOUNT_STEP))
  }
  const toBottom = (): void => {
    if (!scroll) return
    scroll.scrollTo(scroll.scrollHeight)
    app.renderer.requestRender()
  }
  createEffect(on(threadId, () => {
    setStart(firstMountedEntry(entries().length, MOUNT_BUDGET))
    anchor = undefined
    queueMicrotask(toBottom)
  }, { defer: true }))

  const scrollTo = (target: ViewportScroll): void => {
    if (!scroll || scroll.isDestroyed) return
    const atTop = scroll.scrollTop <= 0
    switch (target) {
      case 'page-up': if (atTop) revealOlder(); else scroll.scrollBy(-1, 'viewport'); break
      case 'page-down': scroll.scrollBy(1, 'viewport'); break
      case 'half-page-up': if (atTop) revealOlder(); else scroll.scrollBy(-0.5, 'viewport'); break
      case 'half-page-down': scroll.scrollBy(0.5, 'viewport'); break
      case 'line-up': if (atTop) revealOlder(); else scroll.scrollBy(-1); break
      case 'line-down': scroll.scrollBy(1); break
      case 'first':
        setStart(0)
        pendingTop = true
        break
      case 'last': toBottom(); break
    }
    app.renderer.requestRender()
  }
  session.attachViewport({ scroll: scrollTo })

  const scrollbarColor = (): RGBA => app.theme().focus ?? RGBA.defaultForeground()
  return (
    <box flexGrow={1} minHeight={0} position="relative">
      <scrollbox
        ref={(element: ScrollBoxRenderable) => { scroll = element }}
        flexGrow={1}
        minHeight={0}
        scrollY
        stickyScroll
        stickyStart="bottom"
        viewportCulling
        horizontalScrollbarOptions={{ visible: false }}
        // The bar draws into a reserved column, so showing it never reflows
        // content that was laid out while it was hidden (tables, code).
        viewportOptions={{ paddingRight: 2 }}
        verticalScrollbarOptions={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 1,
          height: '100%',
          trackOptions: { foregroundColor: scrollbarColor(), backgroundColor: RGBA.defaultBackground() }
        }}
        onMouseScroll={(event: MouseEvent) => {
          if (event.scroll?.direction === 'up' && scroll && scroll.scrollTop <= 0) revealOlder()
        }}
      >
        <Show when={hidden() > 0}>
          <Line
            segments={[seg.muted(` … ${hidden()} earlier entr${hidden() === 1 ? 'y' : 'ies'} · scroll up or click to load more`)]}
            onMouseDown={revealOlder}
          />
        </Show>
        <Show when={emptySession()}>
          <Line segments={[' ', seg.brand('New session', { bold: true }), seg.muted(' · type a task and press Enter · /sessions to resume earlier work')]} />
        </Show>
        <TranscriptList entries={visible} options={options} settledOptions={settledOptions} />
        <box height={1} flexShrink={0} />
      </scrollbox>
      <Show when={away()}>
        <box position="absolute" right={2} bottom={0} zIndex={10} backgroundColor={RGBA.defaultBackground()} onMouseDown={toBottom}>
          <Line segments={[' ', seg.focus('Jump to latest ↓', { bold: true }), ' ', seg.muted(app.session.keymap.display('messages_last')), ' ']} />
        </box>
      </Show>
    </box>
  )
}
