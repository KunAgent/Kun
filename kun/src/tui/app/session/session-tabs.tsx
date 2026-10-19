import { createMemo, For, Show, type JSX } from 'solid-js'
import type { ThreadSummary } from '../../../contracts/threads.js'
import { activityFrame } from '../../activity.js'
import { currentMode, describeActivity, displayWorkspace } from '../../chat-format.js'
import { cellWidth, truncateCells } from '../../layout.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { groupByWorkspace, RAIL_WIDTH, relativeTime, type SessionTabStatus } from '../../session-view-model.js'
import { isActiveChildRun } from '../../subagent-format.js'
import { AppContext, useApp, type AppContextValue } from '../context.js'
import { activityColor } from '../chat/status-rows.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'
import { sharedWithGui } from './sidebar.js'

const TAB_TITLE_MAX = 28

function liveState(app: AppContextValue): { running: boolean; waiting: boolean } {
  const projection = app.session.state.projection
  return {
    running: Boolean(projection?.runningTurnId),
    waiting: Boolean(projection?.pendingApproval || projection?.pendingUserInput)
  }
}

/** Kun glyph for a session's status; the open session animates its live phase. */
function statusGlyph(app: AppContextValue, status: SessionTabStatus, current: boolean): SegInput {
  const frame = app.session.animationFrame
  if (status === 'running') {
    if (current) {
      const activity = describeActivity(app.session.state, app.controller, 80)
      if (activity?.active) return seg.color(activityFrame(activity.visualKind, frame), activityColor(app.theme(), activity.visualKind))
    }
    return seg.brand(activityFrame('responding', frame))
  }
  if (status === 'waiting') return seg.warning('△')
  if (status === 'unread') return seg.brand('●')
  return ' '
}

/**
 * One row of open sessions above the conversation: number (ctrl+x 1-9),
 * status glyph and title. The open session sits on the page background with
 * a bar in its mode color; narrow terminals keep only numbers and glyphs.
 */
export function SessionTabs(): JSX.Element {
  const app = useApp()
  const tabs = createMemo(() => {
    app.tick()
    return app.session.navigation.views(app.session.state.threads, liveState(app))
  })
  const compact = createMemo(() => {
    const full = tabs().reduce((sum, tab) => sum + 6 + Math.min(TAB_TITLE_MAX, cellWidth(tab.title)), 0)
    return full + 16 > app.width()
  })
  const modeColor = () => app.theme().modes[currentMode(app.session.state)]
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={app.theme().raised}>
      <For each={tabs()}>
        {(tab) => (
          <box
            flexShrink={0}
            {...(tab.current ? { backgroundColor: app.theme().bg } : {})}
            onMouseDown={() => { if (!tab.current) app.session.handleLiveClick({ kind: 'session', threadId: tab.id }) }}
          >
            <Txt
              content={styled(app.theme(), [
                tab.current ? seg.color('▎', modeColor()) : ' ',
                tab.current ? seg.bold(`${tab.slot} `) : seg.faint(` ${tab.slot} `),
                statusGlyph(app, tab.status, tab.current),
                compact() ? ' ' : ' ',
                ...(compact()
                  ? []
                  : [tab.current ? seg.bold(truncateCells(sanitizeTerminalText(tab.title), TAB_TITLE_MAX)) : seg.muted(truncateCells(sanitizeTerminalText(tab.title), TAB_TITLE_MAX)), '  '])
              ])}
              wrapMode="none"
            />
          </box>
        )}
      </For>
      <box flexShrink={0} onMouseDown={() => { void app.controller.createThread() }}>
        <Txt content={styled(app.theme(), [seg.faint('  + ')])} wrapMode="none" />
      </box>
      <box flexGrow={1} />
      <Show when={app.width() >= 100}>
        <Txt content={styled(app.theme(), [seg.faint(`${app.session.keymap.display('session_quick_1').toLowerCase().replace(/1$/u, '1–9')} `)])} wrapMode="none" />
      </Show>
    </box>
  )
}

function RailRow(props: { thread: ThreadSummary; slot?: number; current: boolean; status: SessionTabStatus }): JSX.Element {
  const app = useApp()
  const modeColor = () => app.theme().modes[currentMode(app.session.state)]
  const title = () => sanitizeTerminalText(props.thread.title || 'Untitled')
  return (
    <box
      flexShrink={0}
      {...(props.current ? { backgroundColor: app.theme().bg } : {})}
      onMouseDown={() => { if (!props.current) app.session.handleLiveClick({ kind: 'session', threadId: props.thread.id }) }}
    >
      <SplitRow
        left={[
          props.current ? seg.color('▎', modeColor()) : ' ',
          props.slot ? (props.current ? seg.bold(`${props.slot} `) : seg.faint(`${props.slot} `)) : '  ',
          statusGlyph(app, props.status, props.current), ' ',
          props.current ? seg.bold(title()) : seg.muted(title())
        ]}
        right={[seg.faint(`${props.current ? 'now' : relativeTime(props.thread.updatedAt)} `)]}
      />
    </box>
  )
}

/**
 * Sessions rail for very wide terminals: threads grouped by workspace with
 * the open one's subagents beneath it, and a New session row.
 */
export function SessionRail(): JSX.Element {
  const app = useApp()
  const inner = RAIL_WIDTH
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const live = liveState(app)
    const currentId = state.projection?.thread.id
    const tabs = app.session.navigation.openTabs
    const groups = groupByWorkspace(state.threads, state.projection?.thread.workspace ?? app.controller.options.workspace, 6)
    return {
      currentId,
      tabs,
      live,
      groups,
      children: (state.projection?.childRuns ?? []).slice(-4),
      total: state.threads.length
    }
  })
  return (
    <box width={RAIL_WIDTH} height="100%" flexShrink={0} flexDirection="column" backgroundColor={app.theme().raised} paddingTop={1} paddingBottom={1}>
      <AppContext.Provider value={{ ...app, width: () => inner }}>
        <SplitRow left={[seg.bold('  Sessions')]} right={[seg.faint(`${app.session.keymap.display('session_list').toLowerCase()}  `)]} />
        <scrollbox flexGrow={1} minHeight={0} scrollY verticalScrollbarOptions={{ visible: false }} horizontalScrollbarOptions={{ visible: false }}>
          <For each={view().groups}>
            {(group) => (
              <box flexDirection="column" flexShrink={0}>
                <box height={1} flexShrink={0} />
                <Line segments={[seg.faint(`  ${displayWorkspace(group.workspace)}`)]} maxWidth={inner} />
                <For each={group.threads}>
                  {(thread) => {
                    const slot = () => view().tabs.indexOf(thread.id) + 1
                    const current = () => thread.id === view().currentId
                    return (
                      <box flexDirection="column" flexShrink={0}>
                        <RailRow
                          thread={thread}
                          {...(slot() > 0 ? { slot: slot() } : {})}
                          current={current()}
                          status={app.session.navigation.statusOf(thread, view().live)}
                        />
                        <Show when={current()}>
                          <For each={view().children}>
                            {(child) => (
                              <box flexShrink={0} onMouseDown={() => app.session.handleLiveClick({ kind: 'child', childId: child.childId })}>
                                <SplitRow
                                  left={[seg.muted(`     ↳ ${sanitizeTerminalText(child.label || child.profileName || child.profile || 'agent')}`)]}
                                  right={[isActiveChildRun(child) ? seg.brand(activityFrame('subagent', app.session.animationFrame)) : child.status === 'failed' ? seg.danger('✗') : seg.success('✓'), '  ']}
                                />
                              </box>
                            )}
                          </For>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
          <box height={1} flexShrink={0} />
          <box flexShrink={0} onMouseDown={() => { void app.controller.createThread() }}>
            <SplitRow left={[seg.brand('  + '), seg.muted('New session')]} right={[seg.faint(`${app.session.keymap.display('session_new').toLowerCase()}  `)]} />
          </box>
        </scrollbox>
        <Line segments={[seg.faint(`  ${view().total} sessions · /sessions`)]} maxWidth={inner} />
        <Show when={sharedWithGui(app)}>
          <Line segments={[seg.brand('  ⧉'), seg.faint(' shared with the GUI')]} maxWidth={inner} />
        </Show>
      </AppContext.Provider>
    </box>
  )
}
