import { createMemo, Index, Show, type JSX } from 'solid-js'
import { classifyMarkdownBlock, splitStableMarkdown } from '../../markdown-blocks.js'
import { codeFenceLanguage, highlightTerminalCode } from '../../markdown-code.js'
import { sanitizeTerminalText } from '../../safe-text.js'
import { ansiToStyled } from '../ansi.js'
import { useApp } from '../context.js'
import { Line, seg } from '../ui.js'
import { Txt } from '../txt.js'

const STREAM_CURSOR = ' ▍'

/** Fenced code rendered as a labeled terminal block (╭─ lang … ╰─). */
export function CodeBlock(props: { language: string; code: string; closed: boolean; streaming: boolean }): JSX.Element {
  const language = createMemo(() => {
    const value = codeFenceLanguage(props.language)
    return !value || value === 'text' || value === 'plaintext' ? 'code' : value
  })
  const lines = createMemo(() => highlightTerminalCode(sanitizeTerminalText(props.code), props.language))
  return (
    <box flexDirection="column" paddingLeft={3} flexShrink={0}>
      <Line segments={[seg.muted(`╭─ ${language()}`)]} />
      <Index each={lines()}>
        {(line, index) => (
          <box flexDirection="row" flexShrink={0}>
            <Line segments={[seg.muted('│ ')]} />
            <Txt
              content={ansiToStyled(props.streaming && index === lines().length - 1 ? `${line()}${STREAM_CURSOR}` : line())}
              wrapMode="none"
              truncate
              flexShrink={1}
            />
          </box>
        )}
      </Index>
      <Show when={props.closed}>
        <Line segments={[seg.muted('╰─')]} />
      </Show>
    </box>
  )
}

/** One Markdown block of assistant output (paragraph, list, table, quote…). */
export function MarkdownBlockView(props: { text: string; streaming: boolean }): JSX.Element {
  const app = useApp()
  const block = createMemo(() => classifyMarkdownBlock(props.text))
  return (
    <Show
      when={block().kind === 'markdown'}
      fallback={(() => {
        const code = block() as Extract<ReturnType<typeof classifyMarkdownBlock>, { kind: 'code' }>
        return <CodeBlock language={code.language} code={code.code} closed={code.closed} streaming={props.streaming} />
      })()}
    >
      <box paddingLeft={3} flexShrink={0}>
        <markdown
          content={`${sanitizeTerminalText((block() as { text: string }).text)}${props.streaming ? STREAM_CURSOR : ''}`}
          syntaxStyle={app.syntax()}
          conceal
          streaming={props.streaming}
        />
      </box>
    </Show>
  )
}

/** Whole assistant answer, split into blocks (used by the transcript page). */
export function AssistantText(props: { text: string; streaming: boolean }): JSX.Element {
  const split = createMemo(() => splitStableMarkdown(props.text, props.streaming))
  const blocks = () => split().blocks
  return (
    <box flexDirection="column" flexShrink={0}>
      <Index each={blocks()}>
        {(block, index) => (
          <box marginTop={index === 0 ? 0 : 1} flexShrink={0}>
            <MarkdownBlockView text={block()} streaming={index >= split().stable} />
          </box>
        )}
      </Index>
    </box>
  )
}
