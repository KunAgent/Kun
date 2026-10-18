import type { TextareaRenderable } from '@opentui/core'
import { createMemo, Show, type JSX } from 'solid-js'
import { useApp } from '../context.js'
import { TranscriptList, type EntryRenderOptions } from '../transcript/entry-view.js'
import { Line, seg } from '../ui.js'
import { Composer } from './composer.js'
import { ActivityRow, GraphProgressRow, ShortcutFooter, Welcome } from './status-rows.js'

/** In-progress tail of the conversation: everything not yet in scrollback. */
function LiveWindow(): JSX.Element {
  const app = useApp()
  const entries = createMemo(() => {
    app.tick()
    return app.session.liveEntries
  })
  const options = createMemo((): EntryRenderOptions => {
    app.tick()
    const session = app.session
    return {
      details: session.showToolDetails,
      showReasoning: session.showReasoning,
      frame: session.animationFrame,
      legacyGui: app.controller.runtime.legacyGui === true,
      attachments: session.state.attachmentMetadata,
      live: true,
      clickable: session.pointerMode,
      reasoningExpanded: (itemId, fallback) => session.reasoningExpanded(itemId) ?? fallback,
      onToggleReasoning: (itemId) => session.handleLiveClick({ kind: 'thinking', itemId }),
      onOpenChild: (childId) => session.handleLiveClick({ kind: 'child', childId })
    }
  })
  const emptySession = createMemo(() => {
    app.tick()
    const projection = app.session.state.projection
    return Boolean(projection && !projection.items.length && !app.session.liveEntries.length)
  })
  return (
    <box flexDirection="column" flexShrink={0} width="100%">
      <Show when={emptySession()}>
        <Line segments={[' ', seg.brand('New session', { bold: true }), seg.muted(' · type a task and press Enter · /sessions to resume earlier work')]} />
      </Show>
      <TranscriptList entries={entries} options={options} />
    </box>
  )
}

export function ChatSurface(props: {
  welcome: boolean
  compactWelcome: boolean
  onTextarea: (textarea: TextareaRenderable) => void
  onSubmit: () => void
  onChange: () => void
}): JSX.Element {
  const app = useApp()
  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Live output continues directly below the scrollback. When it outgrows
          the reserved rows the view sticks to the bottom, so the newest
          lines stay visible right above the composer. */}
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        scrollY
        stickyScroll
        stickyStart={props.welcome ? 'top' : 'bottom'}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Show when={props.welcome} fallback={<LiveWindow />}>
          <Welcome compact={props.compactWelcome} />
        </Show>
      </scrollbox>
      <GraphProgressRow onClick={() => app.session.handleLiveClick({ kind: 'graph' })} />
      <ActivityRow />
      <Composer onTextarea={props.onTextarea} onSubmit={props.onSubmit} onChange={props.onChange} />
      <ShortcutFooter />
    </box>
  )
}
