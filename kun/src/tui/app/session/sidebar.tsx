import { RGBA } from '@opentui/core'
import { createMemo, For, Show, type JSX } from 'solid-js'
import { activityFrame, formatContextGauge, formatTokenCount } from '../../activity.js'
import { activityLabel, currentModel, currentWorkspace, describeGraphProgress, displayWorkspace } from '../../chat-format.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { matchingRequestContextSnapshot } from '../../state.js'
import { formatSessionCost, SIDEBAR_WIDTH, sidebarTodos, type SidebarTodo } from '../../session-view-model.js'
import { isActiveChildRun } from '../../subagent-format.js'
import { AppContext, useApp, type AppContextValue } from '../context.js'
import { Line, seg, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'

const MAX_AGENTS = 8
const RULE_COLOR = RGBA.fromIndex(8)

/** "used / window · percent" for the current request's model, if known. */
export function sessionContextGauge(app: Pick<AppContextValue, 'session' | 'controller'>): string | undefined {
  const projection = app.session.state.projection
  const snapshot = matchingRequestContextSnapshot(projection, {
    model: app.controller.options.model ?? projection?.thread.model,
    providerId: app.controller.options.providerId ?? projection?.thread.providerId
  })
  return snapshot ? formatContextGauge(snapshot.estimatedInputTokens, snapshot.contextWindowTokens) : undefined
}

function Heading(props: { text: string; right?: string }): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexShrink={0} />
      <Line segments={[seg.bold(props.text), ...(props.right ? [seg.muted(`  ${props.right}`)] : [])]} />
    </box>
  )
}

/**
 * Session overview beside the conversation: title, context and usage, the
 * task list, subagents and anything waiting on the user.
 */
export function Sidebar(props: { overlay?: boolean }): JSX.Element {
  const app = useApp()
  const inner = SIDEBAR_WIDTH - 4
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const projection = state.projection
    const thread = projection?.thread
    const usage = projection?.usage
    return {
      title: sanitizeTerminalText(thread?.title || 'Untitled'),
      running: Boolean(projection?.runningTurnId),
      status: projection?.runningTurnId ? activityLabel(projection.activity) : thread?.status ?? 'idle',
      model: currentModel(state, app.controller),
      context: sessionContextGauge(app),
      usage: usage
        ? [
            `${formatTokenCount(usage.totalTokens)} tokens`,
            ...(usage.cacheHitRate !== null && usage.cacheHitRate !== undefined ? [`cache ${Math.round(usage.cacheHitRate * 100)}%`] : [])
          ].join(' · ')
        : undefined,
      cost: usage ? formatSessionCost(usage.costUsd, usage.costCny) : undefined,
      todos: sidebarTodos(thread?.todos?.items ?? []),
      todoDone: (thread?.todos?.items ?? []).filter((item) => item.status === 'completed').length,
      todoTotal: thread?.todos?.items.length ?? 0,
      agents: [...(projection?.childRuns ?? [])].reverse().slice(0, MAX_AGENTS),
      approval: projection?.pendingApproval?.toolName,
      input: Boolean(projection?.pendingUserInput),
      graph: describeGraphProgress(state),
      workspace: displayWorkspace(currentWorkspace(state, app.controller)),
      version: sanitizeTerminalText(app.controller.runtime.runtimeInfo.serviceVersion),
      connection: state.connection
    }
  })
  const todoMark = (status: SidebarTodo['status']): SegInput =>
    status === 'completed' ? seg.success('✓') : status === 'in_progress' ? seg.focus('•') : seg.muted('○')
  return (
    <box
      width={SIDEBAR_WIDTH}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      border={['left']}
      borderColor={RULE_COLOR}
      paddingLeft={2}
      paddingRight={1}
      {...(props.overlay ? { backgroundColor: RGBA.defaultBackground() } : {})}
    >
      <AppContext.Provider value={{ ...app, width: () => inner }}>
        <Txt content={styled(app.theme(), [seg.bold(view().title)])} wrapMode="word" flexShrink={0} />
        <Line segments={[
          view().running ? seg.focus(activityFrame('responding', app.session.animationFrame)) : seg.muted('●'),
          ' ',
          seg.muted(sanitizeTerminalText(view().status))
        ]} maxWidth={inner} />
        <scrollbox flexGrow={1} minHeight={0} scrollY verticalScrollbarOptions={{ visible: false }} horizontalScrollbarOptions={{ visible: false }}>
          <Heading text="Context" />
          <Line segments={[seg.muted(view().model)]} maxWidth={inner} />
          <Show when={view().context}><Line segments={[view().context!]} maxWidth={inner} /></Show>
          <Show when={view().usage}><Line segments={[seg.muted(view().usage!)]} maxWidth={inner} /></Show>
          <Show when={view().cost}><Line segments={[seg.muted(`${view().cost} spent`)]} maxWidth={inner} /></Show>
          <Show when={view().approval || view().input}>
            <Heading text="Waiting on you" />
            <Show when={view().approval}><Line segments={[seg.warning('! '), `Approval · ${sanitizeTerminalText(view().approval!)}`]} maxWidth={inner} /></Show>
            <Show when={view().input}><Line segments={[seg.accent('? '), 'A question needs your answer']} maxWidth={inner} /></Show>
          </Show>
          <Show when={view().graph}>
            <Heading text="Graph" right={view().graph!.status} />
            <Line segments={[seg.muted(`${view().graph!.accepted}/${view().graph!.total} accepted · ${view().graph!.activeAgents} agents`)]} maxWidth={inner} />
          </Show>
          <Show when={view().todoTotal > 0}>
            <Heading text="Todo" right={`${view().todoDone}/${view().todoTotal}`} />
            <For each={view().todos.rows}>
              {(todo) => (
                <box flexDirection="row" flexShrink={0}>
                  <box width={2} flexShrink={0}><Line segments={[todoMark(todo.status)]} /></box>
                  <Txt
                    content={styled(app.theme(), [todo.status === 'completed' ? seg.muted(sanitizeTerminalText(todo.content)) : sanitizeTerminalText(todo.content)])}
                    wrapMode="word"
                    flexGrow={1}
                    flexShrink={1}
                  />
                </box>
              )}
            </For>
            <Show when={view().todos.more > 0}><Line segments={[seg.muted(`  +${view().todos.more} more · /tasks`)]} /></Show>
          </Show>
          <Show when={view().agents.length > 0}>
            <Heading text="Subagents" right={String(app.session.state.projection?.childRuns.length ?? 0)} />
            <For each={view().agents}>
              {(child) => (
                <Line
                  segments={[
                    isActiveChildRun(child)
                      ? seg.focus(activityFrame('subagent', app.session.animationFrame))
                      : child.status === 'failed' ? seg.danger('✗') : child.status === 'aborted' ? seg.warning('■') : seg.success('✓'),
                    ' ',
                    sanitizeTerminalText(child.label || child.profileName || child.profile || child.childId),
                    seg.muted(`  ${child.status}`)
                  ]}
                  maxWidth={inner}
                  onMouseDown={() => app.session.handleLiveClick({ kind: 'child', childId: child.childId })}
                />
              )}
            </For>
          </Show>
        </scrollbox>
        <box height={1} flexShrink={0} />
        <Line segments={[seg.muted(view().workspace)]} maxWidth={inner} />
        <Line segments={[
          seg.muted(`Kun ${view().version} · `),
          view().connection === 'connected' ? seg.success('connected') : seg.warning(view().connection)
        ]} maxWidth={inner} />
      </AppContext.Provider>
    </box>
  )
}
