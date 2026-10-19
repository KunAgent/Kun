import { createMemo, Show, type JSX } from 'solid-js'
import type { TuiPage } from '../../page-model.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { SIDEBAR_WIDTH, sidebarDocks } from '../../session-view-model.js'
import { AppContext, useApp } from '../context.js'
import { Composer, type ComposerHandlers } from '../chat/composer.js'
import { ActivityRow, GraphProgressRow, StatusFooter } from '../chat/status-rows.js'
import { PageDock } from '../pages/page-view.js'
import { seg, SplitRow } from '../ui.js'
import { Conversation } from './conversation.js'
import { sessionContextGauge, Sidebar } from './sidebar.js'

/** One-row title bar, shown when the sidebar is not docked. */
function SessionHeader(): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    return {
      title: sanitizeTerminalText(app.session.state.projection?.thread.title || 'Untitled'),
      gauge: sessionContextGauge(app)
    }
  })
  return (
    <SplitRow
      left={[' ', seg.brand('KUN', { bold: true }), seg.muted(' / '), seg.bold(view().title)]}
      right={view().gauge ? [seg.muted(view().gauge!), ' '] : []}
    />
  )
}

/**
 * An open session: the conversation with the composer below it and, on wide
 * terminals, the sidebar beside it. Approval and question pages replace the
 * composer until they are answered.
 */
export function SessionView(props: ComposerHandlers & { dock?: TuiPage }): JSX.Element {
  const app = useApp()
  const columns = () => app.width()
  const docked = createMemo(() => {
    app.tick()
    return app.session.sidebarVisible && sidebarDocks(columns())
  })
  const overlay = createMemo(() => {
    app.tick()
    return app.session.sidebarOverlay && !sidebarDocks(columns())
  })
  const pad = () => (columns() < 60 ? 0 : 1)
  const mainWidth = () => Math.max(10, columns() - (docked() ? SIDEBAR_WIDTH : 0) - pad() * 2)
  return (
    <box flexDirection="row" width="100%" height="100%">
      <box flexGrow={1} minWidth={0} flexDirection="column" paddingLeft={pad()} paddingRight={pad()}>
        <AppContext.Provider value={{ ...app, width: mainWidth }}>
          <Show when={!docked()}>
            <SessionHeader />
          </Show>
          <Conversation />
          <GraphProgressRow onClick={() => app.session.handleLiveClick({ kind: 'graph' })} />
          <ActivityRow />
          <Show
            when={props.dock}
            keyed
            fallback={<Composer onTextarea={props.onTextarea} onSubmit={props.onSubmit} onChange={props.onChange} />}
          >
            {(page) => <PageDock page={page} />}
          </Show>
          <StatusFooter />
        </AppContext.Provider>
      </box>
      <Show when={docked()}>
        <Sidebar />
      </Show>
      <Show when={overlay()}>
        <box position="absolute" top={0} right={0} height="100%" zIndex={50}>
          <Sidebar overlay />
        </box>
      </Show>
    </box>
  )
}
