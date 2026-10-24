import type { RGBA } from '@opentui/core'
import { createMemo, For, Show, type JSX } from 'solid-js'
import type { ContextSnapshotEvent } from '../../../contracts/events.js'
import { activityFrame, formatTokenCount } from '../../activity.js'
import { currentModel, currentWorkspace, describeActivity, displayWorkspace } from '../../chat-format.js'
import { contextBarRuns, contextCapacity, formatWindowShare, type ContextBarCell, type ContextCapacity } from '../../context-capacity.js'
import { formatGoalDuration } from '../../render-utils.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { contextRing, formatSessionCost, SIDEBAR_WIDTH, sidebarTodos, type SidebarTodo } from '../../session-view-model.js'
import { matchingRequestContextSnapshot } from '../../state.js'
import { childBriefMetrics, isActiveChildRun } from '../../subagent-format.js'
import { formatTokensPerSecond, formatTtft } from '../../turn-timing.js'
import { AppContext, useApp, type AppContextValue } from '../context.js'
import { ringColor, type KunTheme } from '../theme.js'
import { Line, seg, SplitRow, styled, type SegInput } from '../ui.js'
import { Txt } from '../txt.js'
import { activityColor } from '../chat/status-rows.js'

const MAX_AGENTS = 6
const MAX_CHANGES = 4

export type ContextUsage = { used: number; window: number; percent: number }

/** The latest request's context snapshot, when it belongs to the selected model. */
function sessionContextSnapshot(app: Pick<AppContextValue, 'session' | 'controller'>): ContextSnapshotEvent | undefined {
  const projection = app.session.state.projection
  return matchingRequestContextSnapshot(projection, {
    model: app.controller.options.model ?? projection?.thread.model,
    providerId: app.controller.options.providerId ?? projection?.thread.providerId
  })
}

/** Tokens in the latest request against the selected model's window. */
export function sessionContextUsage(app: Pick<AppContextValue, 'session' | 'controller'>): ContextUsage | undefined {
  const snapshot = sessionContextSnapshot(app)
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

/** One hue per context category, matching the GUI popover's legend order. */
function contextCellColor(theme: KunTheme, kind: ContextBarCell): RGBA {
  switch (kind) {
    case 'tools': return theme.info
    case 'system': return theme.accent
    case 'skills': return theme.think
    case 'messages': return theme.brand
    case 'other': return theme.muted
    case 'free': return theme.edge
    case 'marker': return theme.warning
  }
}

function Heading(props: { text: string; right?: SegInput[] }): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box height={1} flexShrink={0} />
      <SplitRow left={[seg.bold(props.text)]} right={props.right ?? []} />
    </box>
  )
}

function ProgressBar(props: { done: number; total: number; tone: 'brand' | 'success'; width?: number }): JSX.Element {
  const app = useApp()
  const width = () => props.width ?? app.width()
  const filled = () => (props.total > 0 ? Math.round((props.done / props.total) * width()) : 0)
  return <Line segments={[{ text: '▰'.repeat(filled()), tone: props.tone }, seg.faint('▱'.repeat(Math.max(0, width() - filled())))]} />
}

/**
 * The window bar and legend: what the latest request spent the window on,
 * with free space, so the rows add up to the whole window.
 */
function ContextBreakdown(props: { capacity: ContextCapacity }): JSX.Element {
  const app = useApp()
  const bar = (): SegInput[] => contextBarRuns(props.capacity, app.width()).map((run) => seg.color(
    (run.kind === 'marker' ? '┃' : run.kind === 'free' ? '─' : '━').repeat(run.count),
    contextCellColor(app.theme(), run.kind)
  ))
  const share = (ratio: number): string => formatWindowShare(ratio).padStart(7)
  return (
    <box flexDirection="column" flexShrink={0}>
      <SplitRow
        left={[seg.muted(`${props.capacity.used.toLocaleString()} / ${formatTokenCount(props.capacity.window)} tokens`)]}
        right={props.capacity.compactRatio !== undefined ? [seg.faint(`compacts ${Math.round(props.capacity.compactRatio * 100)}%`)] : []}
      />
      <Line segments={bar()} />
      <box height={1} flexShrink={0} />
      <For each={props.capacity.categories}>
        {(category) => (
          <SplitRow
            left={[
              seg.color('■ ', contextCellColor(app.theme(), category.key)),
              seg.muted(category.label),
              category.key === 'skills' && props.capacity.activeSkills ? seg.faint(` · ${props.capacity.activeSkills} active`) : undefined
            ]}
            right={[formatTokenCount(category.tokens), seg.faint(share(category.ratio))]}
          />
        )}
      </For>
      <SplitRow
        left={[seg.faint('□ Free space')]}
        right={[seg.muted(formatTokenCount(props.capacity.free.tokens)), seg.faint(share(props.capacity.free.ratio))]}
      />
      <Show when={props.capacity.note}><Line segments={[seg.faint(props.capacity.note!)]} /></Show>
    </box>
  )
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
    const summary = projection?.usageSummary
    const items = thread?.todos?.items ?? []
    const changes = app.session.git?.changes ?? []
    const snapshot = sessionContextSnapshot(app)
    const cacheHitRate = usage ? usage.cacheHitRate : summary?.cacheHitRate
    return {
      title: sanitizeTerminalText(thread?.title || 'Untitled'),
      activity: describeActivity(state, app.controller, inner),
      context: sessionContextUsage(app),
      capacity: snapshot ? contextCapacity(snapshot) : undefined,
      model: currentModel(state, app.controller),
      cost: formatSessionCost(usage?.costUsd ?? summary?.costUsd, usage?.costCny ?? summary?.costCny),
      cache: cacheHitRate !== null && cacheHitRate !== undefined ? cacheHitRate : undefined,
      ttft: formatTtft(usage?.avgTtftMs ?? summary?.avgTtftMs),
      tps: formatTokensPerSecond(usage?.avgTokensPerSecond ?? summary?.avgTokensPerSecond),
      turns: thread?.turns.filter((turn) => turn.status !== 'running' && turn.status !== 'queued').length ?? 0,
      goal: thread?.goal,
      todos: sidebarTodos(items),
      todoDone: items.filter((item) => item.status === 'completed').length,
      todoTotal: items.length,
      agents: [...(projection?.childRuns ?? [])].reverse().slice(0, MAX_AGENTS),
      agentsRunning: (projection?.childRuns ?? []).filter(isActiveChildRun).length,
      agentsDone: (projection?.childRuns ?? []).filter((child) => child.status === 'completed').length,
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
  const hasUsage = () => Boolean(view().cost || view().cache !== undefined || view().ttft || view().tps)
  const speed = (): SegInput[] => [
    ...(view().ttft ? [seg.faint('TTFT '), view().ttft!] : []),
    ...(view().ttft && view().tps ? [seg.faint(' · ')] : []),
    ...(view().tps ? [view().tps!, seg.faint(' tok/s')] : [])
  ]
  const agentsSummary = (): SegInput[] => [
    view().agentsRunning ? seg.muted(`${view().agentsRunning} running`) : undefined,
    view().agentsRunning && view().agentsDone ? seg.faint(' · ') : undefined,
    view().agentsDone ? seg.faint(`${view().agentsDone} done`) : undefined
  ]
  return (
    <box width={SIDEBAR_WIDTH} height="100%" flexShrink={0} flexDirection="column" backgroundColor={app.theme().raised} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <AppContext.Provider value={{ ...app, width: () => inner }}>
        <Txt content={styled(app.theme(), [seg.bold(view().title)])} wrapMode="word" flexShrink={0} />
        <Line segments={status()} maxWidth={inner} />
        <scrollbox flexGrow={1} minHeight={0} scrollY verticalScrollbarOptions={{ visible: false }} horizontalScrollbarOptions={{ visible: false }}>
          <Heading text="Context" right={view().context ? ringSegments(app.theme(), view().context!) : []} />
          <Show when={view().capacity} fallback={<Line segments={[seg.muted(view().model)]} maxWidth={inner} />}>
            <ContextBreakdown capacity={view().capacity!} />
          </Show>
          <Show when={hasUsage()}>
            <Heading text="Usage" right={view().turns ? [seg.faint(`${view().turns} turn${view().turns === 1 ? '' : 's'}`)] : []} />
            <Show when={view().cost}><Line segments={[view().cost!, seg.faint(' spent')]} maxWidth={inner} /></Show>
            <Show when={view().cache !== undefined}>
              <box flexDirection="row" flexShrink={0}>
                <Line segments={[seg.faint('cache ')]} />
                <ProgressBar done={view().cache!} total={1} tone="success" width={inner - 11} />
                <Line segments={[seg.muted(`${Math.round(view().cache! * 100)}%`.padStart(5))]} />
              </box>
            </Show>
            <Show when={view().ttft || view().tps}>
              <SplitRow left={speed()} right={[seg.faint('avg')]} />
            </Show>
          </Show>
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
            <Heading text="Agents" right={agentsSummary()} />
            <For each={view().agents}>
              {(child) => {
                const failed = () => child.status === 'failed' || child.status === 'aborted'
                const name = () => sanitizeTerminalText(child.profileName || child.profile || child.label || child.childId)
                return (
                  <box flexShrink={0} onMouseDown={() => app.session.handleLiveClick({ kind: 'child', childId: child.childId })}>
                    <SplitRow
                      left={[
                        isActiveChildRun(child)
                          ? seg.brand(activityFrame('subagent', app.session.animationFrame))
                          : failed() ? seg.danger('✗') : seg.success('✓'),
                        ' ',
                        isActiveChildRun(child) ? name() : seg.muted(name())
                      ]}
                      right={failed()
                        ? [seg.danger(child.status === 'aborted' ? 'stopped' : 'failed')]
                        : isActiveChildRun(child)
                          ? [seg.faint(childBriefMetrics(child))]
                          : [seg.faint(`done · ${childBriefMetrics(child)}`)]}
                    />
                  </box>
                )
              }}
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
