import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { ToolHostContext, ToolExecutionUpdate } from '../../ports/tool-host.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export const COMPONENT_DESIGN_TOOL_NAME = 'design_component'
export const COMPONENT_DESIGN_PROFILE_NAME = 'component-designer'
export const COMPONENT_PROTOTYPE_CONTRACT_VERSION = 1

const MAX_REQUEST_CHARS = 12_000
const MAX_EXISTING_IMPLEMENTATION_CHARS = 50_000
const MAX_SOURCE_FILES = 12
const MAX_SOURCE_FILE_CHARS = 16_000
const MAX_SOURCE_CONTEXT_CHARS = 64_000
const MAX_PROTOTYPE_BYTES = 768 * 1024
const DEFAULT_VIEWPORT = { width: 720, height: 460 }
const OFFLINE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const FORBIDDEN_EMBED_RE = /<\s*(?:iframe|webview|object|embed|base)\b/i
const REMOTE_ATTRIBUTE_RE = /\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:)?\/\//i
const REMOTE_CSS_RE = /(?:@import\s+(?:url\()?\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/)/i
const NETWORK_SCRIPT_RE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i
const BROWSER_STORAGE_RE = /\b(?:localStorage|sessionStorage|indexedDB|caches|navigator\.storage)\b/i
const CSP_META_RE = /<meta\b[^>]*http-equiv\s*=\s*(?:(["'])content-security-policy\1|content-security-policy)[^>]*>\s*/gi

type ComponentDesignRuntime = Pick<DelegationRuntime, 'enabled' | 'runChild'>

type ComponentDesignArgs = {
  title: string
  request?: string
  html?: string
  existingImplementation?: string
  sourceFiles: string[]
  viewport: { width: number; height: number }
}

export type ComponentPrototypeProducer = 'main-agent' | 'component-designer'

export type ComponentPrototypePayload = {
  version: 1
  status: 'preparing' | 'running' | 'completed' | 'failed'
  artifactId: string
  title: string
  relativePath: string
  viewport: { width: number; height: number }
  producer: ComponentPrototypeProducer
  profile?: typeof COMPONENT_DESIGN_PROFILE_NAME
  childId?: string
  byteSize?: number
  contentHash?: string
  summary?: string
  error?: string
}

export function buildComponentDesignToolProviders(
  runtime: ComponentDesignRuntime | undefined
): CapabilityToolProvider[] {
  return [{
    id: 'component-design',
    kind: 'built-in',
    enabled: true,
    available: true,
    tools: [LocalToolHost.defineTool({
      name: COMPONENT_DESIGN_TOOL_NAME,
      description: [
        'Publish one interactive UI component prototype inline in the current conversation.',
        'Prefer passing complete standalone HTML in `html`; this direct path does not start a child agent and works even when subagents are disabled.',
        'If HTML is not ready, pass `request` plus optional existing implementation/sourceFiles to ask the component-designer child agent to generate it.',
        'Do not use for complete pages, multi-page flows, production implementation, or non-UI tasks.'
      ].join(' '),
      toolKind: 'file_change',
      policy: 'auto',
      shouldAdvertise: (context) => Boolean(context.workspace.trim()),
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            maxLength: 120,
            description: 'Short component name shown above the inline prototype.'
          },
          request: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_REQUEST_CHARS,
            description: 'Optional design request. Used only when complete HTML is not supplied.'
          },
          html: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_PROTOTYPE_BYTES,
            description: 'Complete standalone component HTML to validate, persist, and display directly without a child agent.'
          },
          existingImplementation: {
            type: 'string',
            maxLength: MAX_EXISTING_IMPLEMENTATION_CHARS,
            description: 'Optional relevant existing frontend implementation or excerpt.'
          },
          sourceFiles: {
            type: 'array',
            maxItems: MAX_SOURCE_FILES,
            items: { type: 'string', minLength: 1, maxLength: 1_024 },
            description: 'Optional workspace-relative frontend files whose bounded excerpts should be given to the designer.'
          },
          viewport: {
            type: 'object',
            properties: {
              width: { type: 'integer', minimum: 280, maximum: 1_200 },
              height: { type: 'integer', minimum: 240, maximum: 900 }
            },
            required: ['width', 'height'],
            additionalProperties: false
          }
        },
        additionalProperties: false
      },
      execute: async (rawArgs, context, onUpdate) => withToolBoundary(async () => {
        const args = normalizeComponentDesignArgs(rawArgs)
        const artifactId = `component_${randomUUID().replaceAll('-', '')}`
        const relativePath = componentPrototypeRelativePath(args.title, artifactId)
        const target = await resolveWorkspacePath(relativePath, context, {
          enforceWorkspaceBoundary: true
        })
        assertCanWritePath(target.absolutePath, context)
        await mkdir(dirname(target.absolutePath), { recursive: true, mode: 0o700 })
        await writeFile(
          target.absolutePath,
          buildPreparingComponentPrototype(args.title),
          { encoding: 'utf8', mode: 0o600 }
        )

        const direct = Boolean(args.html)
        const basePayload: Omit<ComponentPrototypePayload, 'status'> = {
          version: COMPONENT_PROTOTYPE_CONTRACT_VERSION,
          artifactId,
          title: args.title,
          relativePath: target.relativePath,
          viewport: args.viewport,
          producer: direct ? 'main-agent' : 'component-designer',
          ...(!direct ? { profile: COMPONENT_DESIGN_PROFILE_NAME } : {})
        }
        await emitComponentPrototypeUpdate(onUpdate, { ...basePayload, status: 'preparing' })

        if (args.html) {
          try {
            const artifact = await persistComponentPrototypeHtml(target.absolutePath, args.html)
            return {
              output: componentPrototypeOutput({
                ...basePayload,
                status: 'completed',
                ...artifact,
                summary: `Published an interactive ${args.title} component prototype.`
              })
            }
          } catch (error) {
            return {
              output: componentPrototypeOutput({
                ...basePayload,
                status: 'failed',
                error: error instanceof Error ? error.message : String(error)
              }),
              isError: true
            }
          }
        }

        if (!runtime?.enabled()) {
          const error = 'component designer is unavailable; provide complete HTML to publish this prototype directly'
          return {
            output: componentPrototypeOutput({
              ...basePayload,
              status: 'failed',
              error
            }),
            isError: true
          }
        }

        let childId = ''
        let runningUpdate: Promise<void> | undefined
        try {
          const sourceContext = await loadSourceContext(args.sourceFiles, context)
          const childWorkspace = dirname(target.absolutePath)
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: `设计 ${args.title}`,
            prompt: buildComponentDesignerPrompt({
              ...args,
              request: args.request!,
              relativePath: 'prototype.html',
              sourceContext
            }),
            // The parent wrapper has already copied bounded source context
            // into the prompt. Confining the child to this artifact directory
            // makes write/edit physically incapable of touching product code.
            workspace: childWorkspace,
            profile: COMPONENT_DESIGN_PROFILE_NAME,
            ...(context.model?.id ? { inheritedModel: context.model.id } : {}),
            ...(context.modelProviderId ? { inheritedProviderId: context.modelProviderId } : {}),
            approvalPolicy: context.approvalPolicy,
            // This is a deliberate narrowing from danger-full-access. The
            // parent tool cannot reach this point in read-only/external modes
            // because its own file_change write is rejected first.
            sandboxMode: 'workspace-write',
            onStart: (startedChildId) => {
              childId = startedChildId
              runningUpdate = emitComponentPrototypeUpdate(onUpdate, {
                ...basePayload,
                status: 'running',
                childId: startedChildId
              })
            },
            signal: context.abortSignal
          })
          childId = record.id || childId
          await runningUpdate

          if (record.status !== 'completed') {
            const error = record.error?.trim() || `component designer ${record.status}`
            return {
              output: componentPrototypeOutput({
                ...basePayload,
                status: 'failed',
                ...(record.id || childId ? { childId: record.id || childId } : {}),
                error,
                summary: record.summary
              }),
              isError: true
            }
          }

          const unexpectedEntries = (await readdir(childWorkspace))
            .filter((entry) => entry !== 'prototype.html')
          if (unexpectedEntries.length > 0) {
            throw new Error(`component designer wrote unexpected files: ${unexpectedEntries.slice(0, 8).join(', ')}`)
          }
          const generated = await readFile(target.absolutePath, 'utf8')
          const artifact = await persistComponentPrototypeHtml(target.absolutePath, generated)
          return {
            output: componentPrototypeOutput({
              ...basePayload,
              status: 'completed',
              childId: record.id,
              ...artifact,
              summary: record.summary?.trim() || `Created an interactive ${args.title} component prototype.`
            })
          }
        } catch (error) {
          return {
            output: componentPrototypeOutput({
              ...basePayload,
              status: 'failed',
              ...(childId ? { childId } : {}),
              error: error instanceof Error ? error.message : String(error)
            }),
            isError: true
          }
        }
      })
    })]
  }]
}

function normalizeComponentDesignArgs(raw: Record<string, unknown>): ComponentDesignArgs {
  const request = boundedString(raw.request, 'request', MAX_REQUEST_CHARS, false)
  const html = boundedString(raw.html, 'html', MAX_PROTOTYPE_BYTES, false)
  if (!request && !html) throw new Error('either html or request is required')
  const title = boundedString(raw.title, 'title', 120, false) || 'UI component'
  const existingImplementation = boundedString(
    raw.existingImplementation,
    'existingImplementation',
    MAX_EXISTING_IMPLEMENTATION_CHARS,
    false
  )
  const sourceFiles = Array.isArray(raw.sourceFiles)
    ? raw.sourceFiles.map((value, index) => boundedString(value, `sourceFiles[${index}]`, 1_024, true))
    : []
  if (sourceFiles.length > MAX_SOURCE_FILES) {
    throw new Error(`sourceFiles may contain at most ${MAX_SOURCE_FILES} paths`)
  }
  const viewportRaw = raw.viewport && typeof raw.viewport === 'object' && !Array.isArray(raw.viewport)
    ? raw.viewport as Record<string, unknown>
    : {}
  const width = boundedInteger(viewportRaw.width, DEFAULT_VIEWPORT.width, 280, 1_200, 'viewport.width')
  const height = boundedInteger(viewportRaw.height, DEFAULT_VIEWPORT.height, 240, 900, 'viewport.height')
  return {
    title,
    ...(request ? { request } : {}),
    ...(html ? { html } : {}),
    ...(existingImplementation ? { existingImplementation } : {}),
    sourceFiles,
    viewport: { width, height }
  }
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  required: boolean
): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`)
    return ''
  }
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.trim()
  if (required && !normalized) throw new Error(`${field} is required`)
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`)
  return normalized
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`)
  }
  return value
}

async function loadSourceContext(sourceFiles: readonly string[], context: ToolHostContext): Promise<string> {
  const sections: string[] = []
  let remaining = MAX_SOURCE_CONTEXT_CHARS
  for (const sourceFile of sourceFiles) {
    if (remaining <= 0) break
    const resolved = await resolveWorkspacePath(sourceFile, context, { enforceWorkspaceBoundary: true })
    const content = await readFile(resolved.absolutePath, 'utf8')
    const excerpt = content.slice(0, Math.min(MAX_SOURCE_FILE_CHARS, remaining))
    remaining -= excerpt.length
    sections.push(`--- ${resolved.relativePath} ---\n${excerpt}${content.length > excerpt.length ? '\n[truncated]' : ''}`)
  }
  return sections.join('\n\n')
}

export function componentPrototypeRelativePath(title: string, artifactId: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'component'
  const suffix = artifactId.replace(/^component_/, '').slice(0, 10)
  return `.kun-design/component-prototypes/${slug}-${suffix}/prototype.html`
}

export function buildComponentDesignerPrompt(input: ComponentDesignArgs & {
  request: string
  relativePath: string
  sourceContext: string
}): string {
  const lines = [
    '# Component prototype task',
    '',
    `Component: ${input.title}`,
    `Required output path: ${input.relativePath}`,
    `Target viewport: ${input.viewport.width} x ${input.viewport.height}`,
    '',
    '## Requested interaction change',
    '<user_request>',
    input.request,
    '</user_request>'
  ]
  if (input.existingImplementation) {
    lines.push(
      '',
      '## Existing implementation supplied by the parent agent',
      '<existing_implementation>',
      input.existingImplementation,
      '</existing_implementation>'
    )
  }
  if (input.sourceContext) {
    lines.push(
      '',
      '## Bounded workspace source excerpts',
      '<source_excerpts>',
      input.sourceContext,
      '</source_excerpts>'
    )
  }
  lines.push(
    '',
    '## Output contract',
    `- Read any supplied context and the reserved placeholder at \`${input.relativePath}\` first; then replace it and write exactly one file: \`${input.relativePath}\`.`,
    '- The file must be a complete standalone HTML document with all CSS and JavaScript inline.',
    '- Include `<meta name="kun-component-prototype" content="1">` in `<head>`.',
    '- Put the single visible component demo inside one root with `data-kun-component-root`.',
    '- Render only this component and the minimum neutral stage needed to operate it; no site header, sidebar, page navigation, dashboard, or marketing copy.',
    '- Implement the meaningful hover, focus, keyboard, pointer, disabled, loading, empty, validation, and responsive states required by the request.',
    '- Use semantic controls, visible focus, touch-friendly hit targets, reduced-motion handling, and readable contrast.',
    '- Do not use network URLs, external assets, imports, iframes, embeds, forms that submit, or browser storage.',
    '- Do not modify any production source file.',
    '- Before finishing, read the written file once and fix incomplete tags or non-working interactions.'
  )
  return lines.join('\n')
}

export function hardenComponentPrototypeHtml(content: string): string {
  const byteSize = Buffer.byteLength(content, 'utf8')
  if (byteSize > MAX_PROTOTYPE_BYTES) {
    throw new Error(`component prototype exceeds ${MAX_PROTOTYPE_BYTES} bytes`)
  }
  const trimmed = content.trim()
  if (!trimmed || trimmed.startsWith('```')) throw new Error('component prototype must be raw standalone HTML')
  if (!/^<!doctype\s+html\b/i.test(trimmed)) throw new Error('component prototype must start with <!doctype html>')
  if (!/<html\b[^>]*>/i.test(trimmed) || !/<\/html\s*>\s*$/i.test(trimmed)) {
    throw new Error('component prototype must contain a complete html document')
  }
  if (!/<head\b[^>]*>/i.test(trimmed) || !/<\/head\s*>/i.test(trimmed)) {
    throw new Error('component prototype must contain a complete head element')
  }
  if (!/<body\b[^>]*>/i.test(trimmed) || !/<\/body\s*>/i.test(trimmed)) {
    throw new Error('component prototype must contain a complete body element')
  }
  if (!/<meta\b[^>]*name\s*=\s*(["'])kun-component-prototype\1[^>]*>/i.test(trimmed)) {
    throw new Error('component prototype is missing the kun-component-prototype marker')
  }
  const roots = trimmed.match(/<[a-z][^>]*\sdata-kun-component-root(?:\s*=\s*(?:["'][^"']*["']|[^\s>]+))?[^>]*>/gi) ?? []
  if (roots.length !== 1) throw new Error('component prototype must contain exactly one data-kun-component-root')
  if (FORBIDDEN_EMBED_RE.test(trimmed)) throw new Error('component prototype contains a forbidden embedded document')
  if (REMOTE_ATTRIBUTE_RE.test(trimmed) || REMOTE_CSS_RE.test(trimmed)) {
    throw new Error('component prototype must not load remote resources')
  }
  if (NETWORK_SCRIPT_RE.test(trimmed)) throw new Error('component prototype must not perform network requests')
  if (BROWSER_STORAGE_RE.test(trimmed)) throw new Error('component prototype must not use browser storage')

  const withoutExistingCsp = trimmed.replace(CSP_META_RE, '')
  const csp = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`
  return `${withoutExistingCsp.replace(/<head\b([^>]*)>/i, `<head$1>\n  ${csp}`)}\n`
}

async function persistComponentPrototypeHtml(
  absolutePath: string,
  content: string
): Promise<{ byteSize: number; contentHash: string }> {
  const hardened = hardenComponentPrototypeHtml(content)
  await writeFile(absolutePath, hardened, { encoding: 'utf8', mode: 0o600 })
  const info = await stat(absolutePath)
  return {
    byteSize: info.size,
    contentHash: createHash('sha256').update(hardened).digest('hex')
  }
}

function buildPreparingComponentPrototype(title: string): string {
  const safeTitle = escapeHtml(title)
  return hardenComponentPrototypeHtml(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="kun-component-prototype" content="1">
  <title>Generating component prototype</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #34445d; background: #f7f9fc; }
    body { display: grid; place-items: center; padding: 24px; }
    [data-kun-component-root] { display: grid; justify-items: center; gap: 14px; text-align: center; }
    .pulse { width: 34px; height: 34px; border-radius: 12px; background: #6c7cff; opacity: .72; animation: pulse 1.2s ease-in-out infinite; }
    p { margin: 0; color: #70809a; font-size: 14px; }
    @keyframes pulse { 50% { transform: scale(.82); opacity: .38; } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  </style>
</head>
<body>
  <main data-kun-component-root aria-live="polite">
    <span class="pulse" aria-hidden="true"></span>
    <strong>Designing ${safeTitle}</strong>
    <p>Kun is preparing a live component prototype.</p>
  </main>
</body>
</html>`)
}

function componentPrototypeOutput(payload: ComponentPrototypePayload): {
  status: ComponentPrototypePayload['status']
  childId?: string
  summary?: string
  error?: string
  componentPrototype: ComponentPrototypePayload
} {
  return {
    status: payload.status,
    ...(payload.childId ? { childId: payload.childId } : {}),
    ...(payload.summary ? { summary: payload.summary } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    componentPrototype: payload
  }
}

async function emitComponentPrototypeUpdate(
  onUpdate: ((update: ToolExecutionUpdate) => Promise<void> | void) | undefined,
  payload: ComponentPrototypePayload
): Promise<void> {
  await onUpdate?.({ output: componentPrototypeOutput(payload), isError: payload.status === 'failed' })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
