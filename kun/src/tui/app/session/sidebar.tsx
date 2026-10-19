import { createMemo, For, Show, type JSX } from 'solid-js'
import { activityFrame, formatTokenCount } from '../../activity.js'
import { currentModel, currentWorkspace, describeActivity, displayWorkspace } from '../../chat-format.js'
import { formatGoalDuration } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { contextRing, formatSessionCost, SIDEBAR_WIDTH, sidebarTodos, type SidebarTodo } from '../../session-view-model.js'
import { matchingRequestContextSnapshot } from '../../state.js'
import { childMetrics, isActiveChildRun } from '../../subagent-format.js'
import { AppContext, useApp, type AppContextValue } from '../context.js'
import { ringColor, type KunTheme } from '../theme.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'
import { activityColor } from '../chat/status-rows.js'

const MAX_AGENTS = 6
const MAX_CHANGES = 4

export type ContextUsage = { used: number; window: number; percent: number }

/** Tokens in the latest request against the selected model's window. */
export function sessionContextUsage(app: Pick<AppContextValue, 'session' | 'controller'>): ContextUsage | undefined {
  const projection = app.session.state.projection
  const snapshot = matchingRequestContextSnapshot(projection, {
    model: app.controller.options.model ?? projection?.thread.model,
    providerId: app.controller.options.providerId ?? projection?.thread.providerId
  })
  if (!snapshot || snapshot.contextWindowTokens <= 0) return undefined
  const used = Math.max(0, snapshot.estimatedInputTokens)
  return { used, window: snapshot.contextWindowTokens, percent: Math.round((used / snapshot.contextWindowTokens) * 100) }
}

/** "◔ 13%" in the ring's level color. */
export function ringSegments(theme: KunTheme, usage: ContextUsage): SegInput[] {
  const ring = contextRing(usage.percent)
  return [seg.color(ring.glyph, ringColor(theme, ring.level)), seg.muted(` ${usage.percent}%`)]
}

/** Workspace with the branch appended: "~/ds_project/DeepSeek-GUI:develop". */
export function workspaceLabel(app: AppContextValue): SegInput[] {
  const workspace = displayWorkspace(currentWorkspace(app.session.state, app.controller))
  const branch = app.session.git?.branch
  return [seg.muted(workspace), ...(branch ? [seg.faint(`:${sanitizeTerminalText(branch)}`)] : [])]
}

export function sharedWithGui(app: AppContextValue): boolean {
  return app.controller.runtime.attached?.ownerKind === 'gui'
}

function Heading(props: { text: string; right?: SegInput[] }): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexShrink={0} />
      <SplitRow left={[seg.bold(props.text)]} right={props.right ?? []} />
    </box>
  )
}

function ProgressBar(props: { done: number; total: number; tone: 'brand' | 'success' }): JSX.Element {
  const app = useApp()
  const width = () => app.width()
  const filled = () => (props.total > 0 ? Math.round((props.done / props.total) * width()) : 0)
  return <Line segments={[{ text: '▰'.repeat(filled()), tone: props.tone }, seg.faint('▱'.repeat(Math.max(0, width() - filled())))]} />
}

/**
 * Session overview beside the conversation: what Kun is doing, context and
 * spend, the goal and plan, subagents and uncommitted changes.
 */
export function Sidebar(): JSX.Element {
  const app = useApp()
  const inner = SIDEBAR_WIDTH - 4
  const view = createMemo(() => {
    app.tick()
    const state = app.session.state
    const projection = state.projection
    const thread = projection?.thread
    const usage = projection?.usage
    const items = thread?.todos?.items ?? []
    const changes = app.session.git?.changes ?? []
    return {
      title: sanitizeTerminalText(thread?.title || 'Untitled'),
      activity: describeActivity(state, app.controller, inner),
      context: sessionContextUsage(app),
      model: currentModel(state, app.controller),
      spend: [
        ...(usage ? [formatSessionCost(usage.costUsd, usage.costCny)].filter(Boolean).map((cost) => `${cost} spent`) : []),
        ...(usage?.cacheHitRate !== null && usage?.cacheHitRate !== undefined ? [`cache ${Math.round(usage.cacheHitRate * 100)}%`] : [])
      ].join(' · '),
      goal: thread?.goal,
      todos: sidebarTodos(items),
      todoDone: items.filter((item) => item.status === 'completed').length,
      todoTotal: items.length,
      agents: [...(projection?.childRuns ?? [])].reverse().slice(0, MAX_AGENTS),
      agentsRunning: (projection?.childRuns ?? []).filter(isActiveChildRun).length,
      changes: changes.slice(0, MAX_CHANGES),
      moreChanges: Math.max(0, changes.length - MAX_CHANGES),
      added: changes.reduce((sum, change) => sum + change.added, 0),
      deleted: changes.reduce((sum, change) => sum + change.deleted, 0),
      version: sanitizeTerminalText(app.controller.runtime.runtimeInfo.serviceVersion)
    }
  })
  const todoRow = (todo: SidebarTodo): SegInput[] => {
    const text = sanitizeTerminalText(todo.content)
    if (todo.status === 'completed') return [seg.muted(`[✓] ${text}`)]
    if (todo.status === 'in_progress') return [seg.warning(`[•] ${text}`)]
    return [`[ ] ${text}`]
  }
  const status = (): SegInput[] => {
    const activity = view().activity
    if (activity?.active) {
      return [seg.color(activityFrame(activity.visualKind, app.session.animationFrame), activityColor(app.theme(), activity.visualKind)), seg.muted(` ${activity.text.toLowerCase()} ${activity.elapsed}`)]
    }
    return [seg.faint('● idle')]
  }
  return (
    <box width={SIDEBAR_WIDTH} height="100%" flexShrink={0} flexDirection="column" backgroundColor={app.theme().raised} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <AppContext.Provider value={{ ...app, width: () => inner }}>
        <Txt content={styled(app.theme(), [seg.bold(view().title)])} wrapMode="word" flexShrink={0} />
        <Line segments={status()} maxWidth={inner} />
        <scrollbox flexGrow={1} minHeight={0} scrollY verticalScrollbarOptions={{ visible: false }} horizontalScrollbarOptions={{ visible: false }}>
          <Heading text="Context" right={view().context ? ringSegments(app.theme(), view().context!) : []} />
          <Show when={view().context} fallback={<Line segments={[seg.muted(view().model)]} maxWidth={inner} />}>
            <Line segments={[seg.muted(`${view().context!.used.toLocaleString()} / ${formatTokenCount(view().context!.window)} tokens`)]} maxWidth={inner} />
          </Show>
          <Show when={view().spend}><Line segments={[seg.muted(view().spend)]} maxWidth={inner} /></Show>
          <Show when={view().goal}>
            <Heading text="Goal" right={[seg.success(sanitizeTerminalText(view().goal!.status))]} />
            <Txt content={styled(app.theme(), [seg.muted(sanitizeTerminalText(view().goal!.objective))])} wrapMode="word" flexShrink={0} />
            <Line segments={[seg.faint(`${formatTokenCount(view().goal!.tokensUsed)} tokens · ${formatGoalDuration(view().goal!.timeUsedSeconds)}`)]} maxWidth={inner} />
          </Show>
          <Show when={view().todoTotal > 0}>
            <Heading text="Plan" right={[seg.faint(`${view().todoDone}/${view().todoTotal}`)]} />
            <ProgressBar done={view().todoDone} total={view().todoTotal} tone="brand" />
            <For each={view().todos.rows}>{(todo) => <Line segments={todoRow(todo)} maxWidth={inner} />}</For>
            <Show when={view().todos.more > 0}><Line segments={[seg.faint(`+${view().todos.more} more · /tasks`)]} /></Show>
          </Show>
          <Show when={view().agents.length > 0}>
            <Heading text="Agents" right={view().agentsRunning ? [seg.muted(`${view().agentsRunning} running`)] : []} />
            <For each={view().agents}>
              {(child) => (
                <box flexShrink={0} onMouseDown={() => app.session.handleLiveClick({ kind: 'child', childId: child.childId })}>
                  <SplitRow
                    left={[
                      isActiveChildRun(child)
                        ? seg.brand(activityFrame('subagent', app.session.animationFrame))
                        : child.status === 'failed' ? seg.danger('✗') : child.status === 'aborted' ? seg.warning('■') : seg.success('✓'),
                      ' ',
                      isActiveChildRun(child) ? sanitizeTerminalText(child.label || child.profileName || child.profile || child.childId) : seg.muted(sanitizeTerminalText(child.label || child.profileName || child.profile || child.childId))
                    ]}
                    right={[seg.muted(isActiveChildRun(child) ? childMetrics(child) || child.status : child.status === 'completed' ? 'done' : child.status)]}
                  />
                </box>
              )}
            </For>
          </Show>
          <Show when={view().changes.length > 0}>
            <Heading text="Changes" right={[seg.success(`+${view().added}`), seg.danger(` −${view().deleted}`)]} />
            <For each={view().changes}>
              {(change) => (
                <SplitRow
                  left={[seg.muted(sanitizeTerminalText(change.path))]}
                  right={change.binary ? [seg.faint('bin')] : [
                    ...(change.added ? [seg.success(`+${change.added}`)] : []),
                    ...(change.deleted ? [seg.danger(` −${change.deleted}`)] : [])
                  ]}
                />
              )}
            </For>
            <Show when={view().moreChanges > 0}><Line segments={[seg.faint(`+${view().moreChanges} more · /diff`)]} /></Show>
          </Show>
        </scrollbox>
        <box height={1} flexShrink={0} />
        <Line segments={workspaceLabel(app)} maxWidth={inner} />
        <SplitRow
          left={sharedWithGui(app) ? [seg.brand('⧉'), seg.muted(' shared with GUI')] : []}
          right={[seg.brand('◆'), seg.bold(' Kun'), seg.muted(` ${view().version}`)]}
        />
      </AppContext.Provider>
    </box>
  )
}
