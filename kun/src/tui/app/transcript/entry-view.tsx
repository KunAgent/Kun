import { createMemo, For, Match, Switch, type Accessor, type JSX } from 'solid-js'
import type { AttachmentMetadata } from '../../../contracts/attachments.js'
import type { TranscriptEntry, TranscriptItemEntry } from '../../transcript-model.js'
import { AssistantText, MarkdownBlockView } from './assistant-text.js'
import { ApprovalReviewView, CompactItemView, ErrorView, ThinkingView, UserMessageView } from './items.js'
import { ChildRunGroupView, ChildRunView } from './subagents.js'
import { ExplorationView, ToolCallView, ToolResultView } from './tools.js'
import { Line, seg } from '../ui.js'

export type EntryRenderOptions = {
  details: boolean
  showReasoning: boolean
  frame: number
  legacyGui: boolean
  attachments: Readonly<Record<string, AttachmentMetadata>>
  /** Rendering in the bounded live window (compact groups, click hints). */
  live: boolean
  /** Pointer interactions are available (live window in Pointer mode, pages). */
  clickable: boolean
  reasoningExpanded: (itemId: string, fallback: boolean) => boolean
  onToggleReasoning?: (itemId: string) => void
  onOpenChild?: (childId: string) => void
}

export function TranscriptEntryView(props: { entry: TranscriptEntry; options: EntryRenderOptions; first: boolean }): JSX.Element {
  const entry = () => props.entry
  return (
    <box flexDirection="column" flexShrink={0} marginTop={(entry().separated && !props.first) || isFollowingMarkdownBlock(entry()) ? 1 : 0}>
      <Switch>
        <Match when={entry().kind === 'reply-header'}>
          <Line segments={[' ', seg.brand('Kun', { bold: true })]} />
        </Match>
        <Match when={entry().kind === 'item'}>
          <ItemEntryView entry={entry() as TranscriptItemEntry} options={props.options} />
        </Match>
        <Match when={entry().kind === 'exploration'}>
          <ExplorationView
            stage={(entry() as Extract<TranscriptEntry, { kind: 'exploration' }>).stage}
            details={props.options.details}
            showReasoning={props.options.showReasoning}
            frame={props.options.frame}
            live={props.options.live}
          />
        </Match>
        <Match when={entry().kind === 'child'}>
          {(() => {
            const child = () => (entry() as Extract<TranscriptEntry, { kind: 'child' }>).child
            return (
              <ChildRunView
                child={child()}
                expanded={props.options.details}
                frame={props.options.frame}
                live={props.options.live && props.options.clickable}
                {...(props.options.clickable && props.options.onOpenChild ? { onOpen: () => props.options.onOpenChild!(child().childId) } : {})}
              />
            )
          })()}
        </Match>
        <Match when={entry().kind === 'child-group'}>
          <ChildRunGroupView
            children={(entry() as Extract<TranscriptEntry, { kind: 'child-group' }>).children}
            expanded={props.options.details}
            frame={props.options.frame}
            live={props.options.live && props.options.clickable}
            {...(props.options.clickable && props.options.onOpenChild ? { onOpen: props.options.onOpenChild } : {})}
          />
        </Match>
        <Match when={entry().kind === 'approval-review'}>
          <ApprovalReviewView review={(entry() as Extract<TranscriptEntry, { kind: 'approval-review' }>).review} frame={props.options.frame} />
        </Match>
      </Switch>
    </box>
  )
}

/** Markdown blocks after the first keep the paragraph gap of the source. */
function isFollowingMarkdownBlock(entry: TranscriptEntry): boolean {
  return entry.kind === 'item' && Boolean(entry.markdown && entry.markdown.index > 0)
}

function ItemEntryView(props: { entry: TranscriptItemEntry; options: EntryRenderOptions }): JSX.Element {
  const item = () => props.entry.item
  return (
    <Switch fallback={<CompactItemView item={item()} />}>
      <Match when={item().kind === 'user_message'}>
        <UserMessageView
          item={item() as Extract<TranscriptItemEntry['item'], { kind: 'user_message' }>}
          attachmentIds={props.entry.userAttachmentIds}
          attachments={props.options.attachments}
        />
      </Match>
      <Match when={item().kind === 'assistant_text'}>
        {props.entry.markdown
          ? <MarkdownBlockView text={props.entry.markdown.text} streaming={props.entry.markdown.streaming} />
          : (
            <AssistantText
              text={(item() as Extract<TranscriptItemEntry['item'], { kind: 'assistant_text' }>).text}
              streaming={props.entry.turnRunning && item().status === 'running'}
            />
          )}
      </Match>
      <Match when={item().kind === 'assistant_reasoning'}>
        <ThinkingView
          item={item() as Extract<TranscriptItemEntry['item'], { kind: 'assistant_reasoning' }>}
          expanded={props.options.reasoningExpanded(item().id, props.entry.showReasoning)}
          running={props.entry.reasoningRunning}
          {...(props.entry.reasoningEndedAt ? { endedAt: props.entry.reasoningEndedAt } : {})}
          frame={props.options.frame}
          clickable={props.options.clickable}
          {...(props.options.clickable && props.options.onToggleReasoning
            ? { onToggle: () => props.options.onToggleReasoning!(item().id) }
            : {})}
        />
      </Match>
      <Match when={item().kind === 'tool_call'}>
        <ToolCallView
          item={item() as Extract<TranscriptItemEntry['item'], { kind: 'tool_call' }>}
          {...(props.entry.toolResult ? { result: props.entry.toolResult } : {})}
          turnRunning={props.entry.turnRunning}
          details={props.options.details}
          frame={props.options.frame}
        />
      </Match>
      <Match when={item().kind === 'tool_result'}>
        <ToolResultView item={item() as Extract<TranscriptItemEntry['item'], { kind: 'tool_result' }>} details={props.options.details} />
      </Match>
      <Match when={item().kind === 'error'}>
        <ErrorView item={item() as Extract<TranscriptItemEntry['item'], { kind: 'error' }>} legacyGui={props.options.legacyGui} />
      </Match>
    </Switch>
  )
}

/**
 * Keyed list of entries. Rows are keyed by their stable entry key so a
 * streaming update re-renders the changed row in place instead of
 * recreating every Markdown renderable on each frame.
 */
export function TranscriptList(props: { entries: Accessor<readonly TranscriptEntry[]>; options: Accessor<EntryRenderOptions> }): JSX.Element {
  const byKey = createMemo(() => new Map(props.entries().map((entry, index) => [entry.key, { entry, index }] as const)))
  const keys = createMemo(() => props.entries().map((entry) => entry.key), undefined, {
    equals: (left, right) => left.length === right.length && left.every((key, index) => key === right[index])
  })
  return (
    <For each={keys()}>
      {(key) => {
        const value = createMemo(() => byKey().get(key))
        return (
          <>
            {value() ? <TranscriptEntryView entry={value()!.entry} options={props.options()} first={value()!.index === 0} /> : null}
          </>
        )
      }}
    </For>
  )
}
