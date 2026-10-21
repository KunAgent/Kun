import { createMemo, Show, type JSX } from 'solid-js'
import type { TuiPage } from '../../page-model.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { formatSessionCost, RAIL_WIDTH, railDocks, SIDEBAR_WIDTH, sidebarDocks } from '../../session-view-model.js'
import { AppContext, useApp } from '../context.js'
import { Composer, PANEL_BAR, type ComposerHandlers } from '../chat/composer.js'
import { ModeRibbon, PromptFooter } from '../chat/status-rows.js'
import { PageDock } from '../pages/page-view.js'
import { seg, SplitRow } from '../ui.js'
import { Conversation } from './conversation.js'
import { SessionRail, SessionTabs } from './session-tabs.js'
import { ringSegments, sessionContextUsage, Sidebar } from './sidebar.js'

/** Title panel shown when the sidebar is not docked: title, context ring and spend. */
function SessionHeader(): JSX.Element {
  const app = useApp()
  const view = createMemo(() => {
    app.tick()
    const projection = app.session.state.projection
    const usage = projection?.usage
    return {
      title: sanitizeTerminalText(projection?.thread.title || 'Untitled'),
      context: sessionContextUsage(app),
      cost: usage ? formatSessionCost(usage.costUsd, usage.costCny) : undefined
    }
  })
  return (
    <box border={['left']} borderColor={app.theme().edge} customBorderChars={PANEL_BAR} flexShrink={0}>
      <box backgroundColor={app.theme().panel} flexGrow={1} paddingLeft={1}>
        <AppContext.Provider value={{ ...app, width: () => Math.max(10, app.width() - 2) }}>
          <SplitRow
            left={[seg.bold(view().title)]}
            right={[
              ...(view().context ? ringSegments(app.theme(), view().context!) : []),
              ...(view().cost ? [seg.muted(` · ${view().cost}`)] : []),
              ' '
            ]}
          />
        </AppContext.Provider>
      </box>
    </box>
  )
}

/**
 * An open session. Session tabs run along the top (a rail on very wide
 * terminals), the conversation fills the middle with the prompt below it,
 * and the sidebar docks on the right from 120 columns (an overlay below
 * that). Approval and question pages take the prompt's place.
 */
export function SessionView(props: ComposerHandlers & { dock?: TuiPage }): JSX.Element {
  const app = useApp()
  const columns = () => app.width()
  const rail = () => railDocks(columns())
  const docked = createMemo(() => {
    app.tick()
    return app.session.sidebarVisible && sidebarDocks(columns())
  })
  const overlay = createMemo(() => {
    app.tick()
    return app.session.sidebarOverlay && !sidebarDocks(columns())
  })
  const pad = () => (columns() < 60 ? 1 : 2)
  const mainWidth = () => Math.max(10, columns() - (rail() ? RAIL_WIDTH : 0) - (docked() ? SIDEBAR_WIDTH : 0) - pad() * 2)
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Show when={!rail()}>
        <SessionTabs />
      </Show>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={rail()}>
          <SessionRail />
        </Show>
        <box flexGrow={1} minWidth={0} flexDirection="column" paddingLeft={pad()} paddingRight={pad()}>
          <AppContext.Provider value={{ ...app, width: mainWidth }}>
            <box height={1} flexShrink={0} />
            <Show when={!docked()}>
              <SessionHeader />
              <box height={1} flexShrink={0} />
            </Show>
            <Conversation />
            <ModeRibbon />
            <Show
              when={props.dock}
              keyed
              fallback={<Composer onTextarea={props.onTextarea} onSubmit={props.onSubmit} onChange={props.onChange} />}
            >
              {(page) => <PageDock page={page} />}
            </Show>
            <PromptFooter />
          </AppContext.Provider>
        </box>
        <Show when={docked()}>
          <Sidebar />
        </Show>
      </box>
      <Show when={overlay()}>
        <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={50} flexDirection="row" backgroundColor={app.theme().scrim}>
          <box flexGrow={1} onMouseDown={() => app.session.toggleSidebar()} />
          <Sidebar />
        </box>
      </Show>
    </box>
  )
}
