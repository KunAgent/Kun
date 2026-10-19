import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import {
  GEN_UI_HTML_MAX_BYTES,
  GEN_UI_PROVIDER_ID,
  GEN_UI_TOOL_NAME,
  GenUiRenderInputSchema,
  utf8ByteLength,
  type GenUiWidgetRef
} from '../../contracts/gen-ui.js'
import type { GenUiStore } from '../../gen-ui/gen-ui-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export type GenUiToolConfig = {
  enabled?: boolean
}

const inputSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      maxLength: 120,
      description: 'Short visible title of the widget, for example "Sine wave explorer".'
    },
    html: {
      type: 'string',
      description:
        'Self-contained HTML fragment (no <html>, <head> or <body>): markup plus optional <style> and <script>. ' +
        'Keep it under 1 MB. Give the root element a unique id and select it with document.getElementById.'
    },
    path: {
      type: 'string',
      description:
        'Alternative to html: an existing .html file inside the workspace whose content is the fragment. ' +
        'Use it to re-render a large widget you edited with file tools.'
    },
    mode: {
      type: 'string',
      enum: ['inline', 'wide'],
      description: 'inline (default) fits the conversation column; wide is only for full desktop app mockups or side-by-side panels.'
    }
  },
  required: ['title'],
  additionalProperties: false
} as const

const description = [
  'Render an interactive HTML widget (Gen UI) inline in the current desktop conversation.',
  'Use it when the user benefits from seeing or manipulating something: parameter explorers, simulations,',
  'algorithm step-throughs, interactive charts, calculators, or UI mockups with design alternatives.',
  'Do not use it for plain tables (Markdown), static diagrams (Mermaid), simple structured charts (render_chart when available),',
  'or for requests to change project files, websites or components (edit the project instead).',
  'The fragment runs in an isolated page with no network access except static libraries from cdn.jsdelivr.net,',
  'cdnjs.cloudflare.com, unpkg.com and esm.sh (d3@7.9.0, echarts@5.6.0 and lucide@0.544.0 load offline).',
  'Use theme CSS variables (--foreground, --muted-foreground, --card, --border, --brand, --viz-series-1..6) instead of fixed colors.',
  'The page API is window.kun: widgetState (saved snapshot or null), setWidgetState({ modelContent, privateContent }) to',
  'remember choices (16 KiB; only modelContent is shared with you on the next user message),',
  'sendFollowUpMessage({ prompt, title }) to ask a follow-up from a user click, and the "kun:set_globals" window event.',
  'Afterwards, give at most a short conclusion in text; never describe the HTML or say a widget was created.'
].join(' ')

/** Extract the usable part of a full HTML document; fragments pass through. */
export function normalizeGenUiFragment(html: string): string {
  if (!/<html[\s>]|<body[\s>]/i.test(html)) return html.trim()
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const headAssets = [...head.matchAll(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<link\b[^>]*>/gi)].map((match) => match[0])
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html.replace(/<!doctype[^>]*>/i, '')
  return [...headAssets, body.trim()].join('\n').trim()
}

async function readFragmentFile(path: string, context: ToolHostContext): Promise<string> {
  const resolved = await resolveWorkspacePath(path, context, { enforceWorkspaceBoundary: true })
  const extension = extname(resolved.absolutePath).toLowerCase()
  if (extension !== '.html' && extension !== '.htm') throw new Error('path must point to an .html file')
  const info = await stat(resolved.absolutePath)
  if (!info.isFile()) throw new Error('path is not a file')
  if (info.size > GEN_UI_HTML_MAX_BYTES) throw new Error(`widget file exceeds ${GEN_UI_HTML_MAX_BYTES} bytes`)
  return readFile(resolved.absolutePath, 'utf8')
}

export function buildGenUiToolProvider(
  config: () => GenUiToolConfig | undefined,
  store: () => GenUiStore | undefined
): CapabilityToolProvider[] {
  const enabled = (): boolean => config()?.enabled === true && store() !== undefined
  return [{
    id: GEN_UI_PROVIDER_ID,
    kind: 'gui',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [LocalToolHost.defineTool({
      name: GEN_UI_TOOL_NAME,
      description,
      inputSchema: inputSchema as unknown as Record<string, unknown>,
      toolKind: 'tool_call',
      policy: 'auto',
      sideEffect: 'read-only',
      shouldAdvertise: enabled,
      execute: async (args, context) => {
        const target = store()
        if (!enabled() || !target) {
          return { output: { status: 'failed', error: 'render_widget is disabled in Lab settings' }, isError: true }
        }
        const parsed = GenUiRenderInputSchema.safeParse(args)
        if (!parsed.success) {
          return { output: { status: 'failed', error: z.prettifyError(parsed.error) }, isError: true }
        }
        try {
          const source = parsed.data.html ?? await readFragmentFile(parsed.data.path!, context)
          const fragment = normalizeGenUiFragment(source)
          if (!fragment) throw new Error('widget HTML is empty')
          if (utf8ByteLength(fragment) > GEN_UI_HTML_MAX_BYTES) {
            throw new Error(`widget HTML exceeds ${GEN_UI_HTML_MAX_BYTES} bytes; aggregate or downsample the data`)
          }
          const stored = await target.putWidget(fragment)
          const genUi: GenUiWidgetRef = {
            ...stored,
            title: parsed.data.title,
            mode: parsed.data.mode ?? 'inline'
          }
          return {
            output: {
              status: 'completed',
              summary: `Displayed the interactive widget "${parsed.data.title}" to the user.`
            },
            // UI-only sideband consumed by the desktop; never projected to the model.
            meta: { genUi }
          }
        } catch (error) {
          return {
            output: { status: 'failed', error: error instanceof Error ? error.message : String(error) },
            isError: true
          }
        }
      }
    })]
  }]
}
