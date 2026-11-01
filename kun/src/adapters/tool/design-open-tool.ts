import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { DESIGN_PREVIEW_INSTRUCTION } from '../../shared/design-preview-policy.js'
import { designToolError, oneOf, stringArg } from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'

export const DESIGN_OPEN_TOOL_NAME = 'design_open'
export const DESIGN_OPEN_REQUEST_VERSION = 2
export const DESIGN_OPEN_TITLE_MAX_CHARS = 120
export const DESIGN_OPEN_NOTE_MAX_CHARS = 2_000
export const DESIGN_OPEN_MAX_SCREENS = 6
export const DESIGN_OPEN_SCREEN_MAX_CHARS = 400_000
export const DESIGN_OPEN_SECTION_MAX_CHARS = 60
const DESIGN_DIR = '.kun-design'

const DEFAULT_SIZE = {
  web: { width: 1280, height: 800 },
  app: { width: 390, height: 844 }
} as const

export type DesignOpenScreenPayload = {
  artifactId: string
  name: string
  relativePath: string
  width: number
  height: number
  /** Canvas section (one labelled row of boards) this screen belongs to. */
  section?: string
}

export type DesignOpenRequestPayload = {
  version: typeof DESIGN_OPEN_REQUEST_VERSION
  requestId: string
  status: 'ready'
  title: string
  /** Design document (canvas) the screens belong to; stable per conversation and title. */
  documentId: string
  screens: DesignOpenScreenPayload[]
  note?: string
  target?: 'web' | 'app'
}

/**
 * The Code agent's entry into Design: it writes finished screens straight
 * into a design document beside the conversation, in the same turn. The
 * desktop workbench registers the screens on the canvas and shows a card in
 * the transcript; no separate design pass runs.
 *
 * Code whiteboard turns can use this entry too, but Design canvas turns edit
 * their existing document instead. Discovery and execution use the same gate.
 *
 * Delegated Code harnesses (Claude Code via the Agent SDK bridge, Codex and
 * ACP agents via the Kun Tools MCP server) reach it too: the tool only writes
 * workspace files, and the transcript card comes from its result item.
 */
export function shouldAdvertiseDesignOpen(context: ToolHostContext): boolean {
  return context.clientSurface === 'gui' &&
    context.agentSurface === 'code' &&
    context.threadMode !== 'plan' &&
    context.guiDesignMode !== true &&
    context.imContext !== true &&
    context.roomAgent !== true &&
    context.roomPeer !== true &&
    context.roomStepKind === undefined &&
    context.executionUnitKind === undefined &&
    Boolean(context.workspace.trim())
}

function shortHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/** Same conversation + same title reuses one design document, so revisions land on the same canvas. */
export function designOpenDocumentId(threadId: string, title: string): string {
  return shortHash('design-open-document', threadId, normalizedKey(title)).slice(0, 8)
}

/** Same document + same screen name rewrites that screen in place. */
export function designOpenScreenId(documentId: string, name: string): string {
  return shortHash('design-open-screen', documentId, normalizedKey(name)).slice(0, 8)
}

export function designOpenRequestId(
  context: Pick<ToolHostContext, 'threadId' | 'turnId' | 'activeToolCallId'>,
  documentId: string
): string {
  return `design_${shortHash(context.threadId, context.turnId, context.activeToolCallId ?? '', documentId).slice(0, 16)}`
}

/** Fragments become a minimal standalone document so the canvas webview renders them. */
export function normalizeDesignScreenHtml(html: string): string {
  const trimmed = html.trim()
  if (/<html[\s>]/iu.test(trimmed)) return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '</head>',
    '<body>',
    trimmed,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

function clampSize(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : fallback
}

type ScreenInput = { name: string; html: string; width: number; height: number; section?: string }

function normalizeScreens(raw: unknown, target: 'web' | 'app'): ScreenInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'design_open requires at least one screen with a name and html'
  if (raw.length > DESIGN_OPEN_MAX_SCREENS) return `design_open accepts at most ${DESIGN_OPEN_MAX_SCREENS} screens per call`
  const seen = new Set<string>()
  const screens: ScreenInput[] = []
  for (const [index, item] of raw.entries()) {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const name = stringArg(entry.name)?.slice(0, DESIGN_OPEN_TITLE_MAX_CHARS)
    const html = typeof entry.html === 'string' ? entry.html : ''
    if (!name) return `screen ${index + 1} needs a name`
    if (!html.trim()) return `screen "${name}" needs html`
    if (html.length > DESIGN_OPEN_SCREEN_MAX_CHARS) return `screen "${name}" html is larger than ${DESIGN_OPEN_SCREEN_MAX_CHARS} characters`
    const key = normalizedKey(name)
    if (seen.has(key)) return `screen names must be unique; "${name}" appears twice`
    seen.add(key)
    const section = stringArg(entry.section)?.slice(0, DESIGN_OPEN_SECTION_MAX_CHARS)
    screens.push({
      name,
      html,
      width: clampSize(entry.width, DEFAULT_SIZE[target].width, 240, 2400),
      height: clampSize(entry.height, DEFAULT_SIZE[target].height, 240, 4000),
      ...(section ? { section } : {})
    })
  }
  return screens
}

export function createDesignOpenTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_OPEN_TOOL_NAME,
    description: [
      'Put a visual design on the Design canvas beside this conversation, in this turn.',
      'Use it when the user asks to design, mock up, prototype, redesign, or visually compare UI, or wants to see a design before code is written.',
      'Do not use it for code-only changes, bug fixes, diagrams of existing code, or a single inline component (use design_component for that).',
      'The canvas holds many boards. Before writing, plan the board set the request needs and decide the count yourself: one board per distinct screen, key state, variant, theme, or spec sheet, never several screens squeezed into one long page.',
      'A small tweak may need one board; a feature redesign usually needs several, for example an overview of the flow, each main screen, important states (empty, loading, error, success), light and dark, and a component or token sheet.',
      'Group related boards with the same `section` label (for example "01 Home", "02 States", "Components"); each section becomes its own labelled row on the canvas, in the order you send them.',
      'Gather the code context first (current UI, components, tokens, constraints), then write every board yourself as one complete, self-contained HTML document: inline CSS, realistic content in the user\'s language, clear hierarchy; no external scripts beyond well-known CDNs or web fonts. Keep boards in one design consistent: same tokens, type scale, and components.',
      `Send at most ${DESIGN_OPEN_MAX_SCREENS} boards per call; for a larger set, call again with the same title, one or two sections per call, until the plan is complete. Each call adds to the same canvas, and a board with an existing name is replaced.`,
      'The conversation shows a card the user clicks to open the canvas.',
      'To revise one screen you can also edit its HTML file directly (paths are returned); the canvas reloads.',
      DESIGN_PREVIEW_INSTRUCTION,
      'After the last call, summarise the board set in a sentence or two. Do not implement the design in code until the user approves it.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: shouldAdvertiseDesignOpen,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: DESIGN_OPEN_TITLE_MAX_CHARS,
          description: 'Design name shown on the conversation card and the canvas, in the user\'s language.'
        },
        screens: {
          type: 'array',
          minItems: 1,
          maxItems: DESIGN_OPEN_MAX_SCREENS,
          description: 'Boards to place on the canvas in this call, in reading order.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, description: 'Board label shown above the board, unique within the design.' },
              html: { type: 'string', minLength: 1, description: 'Complete standalone HTML document for this screen.' },
              width: { type: 'number', description: 'Board width in px (default 1280 for web, 390 for app).' },
              height: { type: 'number', description: 'Board height in px (default 800 for web, 844 for app).' },
              section: {
                type: 'string',
                maxLength: DESIGN_OPEN_SECTION_MAX_CHARS,
                description: 'Optional section label; boards sharing it sit in one labelled row.'
              }
            },
            required: ['name', 'html'],
            additionalProperties: false
          }
        },
        target: {
          type: 'string',
          enum: ['web', 'app'],
          description: 'Optional platform. web = desktop/web layout, app = mobile layout. Default web.'
        },
        note: {
          type: 'string',
          maxLength: DESIGN_OPEN_NOTE_MAX_CHARS,
          description: 'Optional short design rationale kept with the request.'
        }
      },
      required: ['title', 'screens'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      const title = stringArg(args.title)?.slice(0, DESIGN_OPEN_TITLE_MAX_CHARS)
      if (!title) return designToolError('design_open requires a non-empty title')
      const target = oneOf(args.target, ['web', 'app'] as const)
      const screens = normalizeScreens(args.screens, target ?? 'web')
      if (typeof screens === 'string') return designToolError(screens)
      const note = stringArg(args.note)?.slice(0, DESIGN_OPEN_NOTE_MAX_CHARS)
      const documentId = designOpenDocumentId(context.threadId, title)
      const written: DesignOpenScreenPayload[] = []
      for (const screen of screens) {
        const artifactId = designOpenScreenId(documentId, screen.name)
        const relativePath = `${DESIGN_DIR}/${documentId}/${artifactId}/v1.html`
        const resolved = await resolveWorkspacePath(relativePath, context, { enforceWorkspaceBoundary: true })
        assertCanWritePath(resolved.absolutePath, context)
        await mkdir(dirname(resolved.absolutePath), { recursive: true })
        await writeFile(resolved.absolutePath, normalizeDesignScreenHtml(screen.html), 'utf8')
        written.push({
          artifactId,
          name: screen.name,
          relativePath,
          width: screen.width,
          height: screen.height,
          ...(screen.section ? { section: screen.section } : {})
        })
      }
      const designRequest: DesignOpenRequestPayload = {
        version: DESIGN_OPEN_REQUEST_VERSION,
        requestId: designOpenRequestId(context, documentId),
        status: 'ready',
        title,
        documentId,
        screens: written,
        ...(note ? { note } : {}),
        ...(target ? { target } : {})
      }
      return {
        output: {
          ok: true,
          status: 'ready',
          designRequest,
          message: [
            `Added ${written.length} board(s) to "${title}" on the design canvas:`,
            ...written.map((screen) => `- ${screen.section ? `[${screen.section}] ` : ''}${screen.name}: ${screen.relativePath}`),
            'If your board plan has more boards, call design_open again with the same title now. Edit a file above to revise that board. Do not implement the design in code until the user approves it.'
          ].join('\n')
        }
      }
    })
  })
}

export function buildDesignOpenLocalTools(): LocalTool[] {
  return [createDesignOpenTool()]
}
