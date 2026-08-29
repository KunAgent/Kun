import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { emptyResourcePolicy, validateRemoteResources } from './component-design-resource-policy.js'
import { LocalToolHost } from './local-tool-host.js'

export const DIAGRAM_VISUALIZATION_TOOL_NAME = 'show_diagram'
export const DIAGRAM_VISUALIZATION_CONTRACT_VERSION = 1

const FORBIDDEN_EMBED_RE = /<\s*(?:iframe|webview|object|embed|base)\b/i
const STORAGE_RE = /\b(?:localStorage|sessionStorage|indexedDB|caches|navigator\.storage)\b/i
const SCRIPT_RE = /<\s*script\b/i
const CSP_META_RE = /<meta\b[^>]*http-equiv\s*=\s*(?:(["'])content-security-policy\1|content-security-policy)[^>]*>\s*/gi
const DIAGRAM_PATH_RE = /^\.kun-design\/diagram-prototypes\/[^/]+\/diagram\.html$/i

type DiagramPayload = {
  version: 1
  status: 'preparing' | 'running' | 'completed' | 'failed'
  artifactId: string
  title: string
  relativePath: string
  diagramType: string
  sizePreset: string
  viewport: { width: number; height: number }
  producer: 'main-agent' | 'diagram-designer'
  profile?: 'diagram-designer'
  childId?: string
  byteSize?: number
  contentHash?: string
  summary?: string
  error?: string
}

export function buildDiagramVisualizationToolProvider(
  config: () => { enabled?: boolean } | undefined,
  runtime?: Pick<DelegationRuntime, 'enabled' | 'runChild'>
): CapabilityToolProvider[] {
  const enabled = (): boolean => config()?.enabled === true
  return [{
    id: 'diagram-visualization',
    kind: 'gui',
    enabled: true,
    available: true,
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    tools: [LocalToolHost.defineTool({
      name: DIAGRAM_VISUALIZATION_TOOL_NAME,
      description: [
        'Publish one complex diagram as safe self-contained HTML with inline accessible SVG in the current GUI conversation.',
        'Use show_visualization for short cards or simple flows. Use show_diagram for real diagram layout, icons, connectors, charts, or explanatory motion.',
        'Provide complete HTML directly, or an existing workspace artifactPath. This tool does not implement production UI.'
      ].join(' '),
      toolKind: 'file_change',
      policy: 'auto',
      shouldAdvertise: (context) => enabled() && context.clientSurface === 'gui' && Boolean(context.workspace.trim()),
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          diagramType: { type: 'string', minLength: 1, maxLength: 80 },
          request: { type: 'string', minLength: 1, maxLength: 12000 },
          html: { type: 'string', minLength: 1 },
          artifactPath: { type: 'string', minLength: 1, maxLength: 1024 },
          sizePreset: { type: 'string', enum: ['doc-inline', 'doc-wide', 'slide-16x9', 'slide-4x3', 'social-og', 'social-square', 'fit'] },
          viewport: {
            type: 'object',
            properties: { width: { type: 'integer', minimum: 280, maximum: 1600 }, height: { type: 'integer', minimum: 240, maximum: 1200 } },
            required: ['width', 'height'],
            additionalProperties: false
          }
        },
        required: ['title', 'diagramType'],
        additionalProperties: false
      },
      execute: async (raw, context, onUpdate) => withToolBoundary(async () => {
        if (!enabled()) return failed('show_diagram is disabled in Lab settings')
        const title = string(raw.title, 'title', 120)
        const diagramType = string(raw.diagramType, 'diagramType', 80)
        const html = optionalString(raw.html)
        const request = optionalString(raw.request)
        const suppliedPath = optionalString(raw.artifactPath)
        if (!html && !suppliedPath && !request) return failed('html, artifactPath, or request is required')
        const sizePreset = oneOf(raw.sizePreset, ['doc-inline', 'doc-wide', 'slide-16x9', 'slide-4x3', 'social-og', 'social-square', 'fit']) ?? 'doc-inline'
        const viewport = normalizeViewport(raw.viewport)
        const artifactId = `diagram_${randomUUID().replaceAll('-', '')}`
        const relativePath = suppliedPath ? normalizeDiagramPath(suppliedPath) : diagramRelativePath(title, artifactId)
        const target = await resolveWorkspacePath(relativePath, context, { enforceWorkspaceBoundary: true })
        assertCanWritePath(target.absolutePath, context)
        if (!suppliedPath) await mkdir(dirname(target.absolutePath), { recursive: true, mode: 0o700 })
        const base: Omit<DiagramPayload, 'status'> = {
          version: 1,
          artifactId,
          title,
          relativePath: target.relativePath,
          diagramType,
          sizePreset,
          viewport,
          producer: html || suppliedPath ? 'main-agent' : 'diagram-designer',
          ...(!html && !suppliedPath ? { profile: 'diagram-designer' as const } : {})
        }
        await onUpdate?.({ output: output({ ...base, status: 'preparing' }) })
        if (html || suppliedPath) {
          try {
            const source = suppliedPath ? await readFile(target.absolutePath, 'utf8') : html!
            const hardened = hardenDiagramHtml(source)
            await writeFile(target.absolutePath, hardened, { encoding: 'utf8', mode: 0o600 })
            const info = await stat(target.absolutePath)
            return { output: output({
              ...base,
              status: 'completed',
              byteSize: info.size,
              contentHash: createHash('sha256').update(hardened).digest('hex'),
              summary: `Published a ${diagramType} diagram.`
            }) }
          } catch (error) {
            return failed(error instanceof Error ? error.message : String(error), base)
          }
        }
        if (!runtime?.enabled()) return failed('diagram designer is unavailable; provide complete HTML directly', base)
        const childWorkspace = dirname(target.absolutePath)
        try {
          await mkdir(childWorkspace, { recursive: true, mode: 0o700 })
          await onUpdate?.({ output: output({ ...base, status: 'running' }) })
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            launcher: 'diagram_design',
            label: `Design ${title}`,
            prompt: buildDiagramDesignerPrompt({ request, title, diagramType, sizePreset, viewport }),
            workspace: childWorkspace,
            profile: 'diagram-designer',
            agentSurface: 'design',
            ...(context.model?.id ? { inheritedModel: context.model.id } : {}),
            ...(context.modelProviderId ? { inheritedProviderId: context.modelProviderId } : {}),
            approvalPolicy: context.approvalPolicy,
            sandboxMode: 'workspace-write',
            security: {
              sandboxRoot: childWorkspace,
              ...(context.allowedProviderIds ? { allowedProviderIds: [...context.allowedProviderIds] } : {}),
              ...(context.blockedProviderIds ? { blockedProviderIds: [...context.blockedProviderIds] } : {}),
              memoryEnabled: false
            },
            signal: context.abortSignal
          })
          if (record.status !== 'completed') return failed(record.error?.trim() || `diagram designer ${record.status}`, { ...base, childId: record.id })
          const unexpected = (await readdir(childWorkspace)).filter((entry) => entry !== 'diagram.html')
          if (unexpected.length > 0) throw new Error(`diagram designer wrote unexpected files: ${unexpected.slice(0, 8).join(', ')}`)
          const generated = await readFile(target.absolutePath, 'utf8')
          const hardened = hardenDiagramHtml(generated)
          await writeFile(target.absolutePath, hardened, { encoding: 'utf8', mode: 0o600 })
          const info = await stat(target.absolutePath)
          return { output: output({ ...base, status: 'completed', childId: record.id, byteSize: info.size, contentHash: createHash('sha256').update(hardened).digest('hex'), summary: record.summary?.trim() || `Created a ${diagramType} diagram.` }) }
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error), base)
        }
      })
    })]
  }]
}

export function normalizeDiagramPath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/')
  if (!DIAGRAM_PATH_RE.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('artifactPath must match .kun-design/diagram-prototypes/<id>/diagram.html')
  }
  return normalized
}

export function diagramRelativePath(title: string, artifactId: string): string {
  const slug = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'diagram'
  return `.kun-design/diagram-prototypes/${slug}-${artifactId.replace(/^diagram_/, '').slice(0, 10)}/diagram.html`
}

export function hardenDiagramHtml(content: string): string {
  let html = content.trim()
  if (!/^<!doctype\s+html\b/i.test(html) || !/<html\b/i.test(html) || !/<\/html\s*>\s*$/i.test(html)) throw new Error('diagram must be complete standalone HTML')
  if (!/<head\b/i.test(html) || !/<body\b/i.test(html)) throw new Error('diagram must contain head and body')
  if (FORBIDDEN_EMBED_RE.test(html)) throw new Error('diagram contains a forbidden embedded document')
  if (STORAGE_RE.test(html)) throw new Error('diagram must not use browser storage')
  if (SCRIPT_RE.test(html)) throw new Error('diagram must be static HTML without scripts')
  validateRemoteResources(html, emptyResourcePolicy())
  const roots = html.match(/<[a-z][^>]*\sdata-kun-diagram-root(?:\s*=\s*(?:["'][^"']*["']|[^\s>]+))?[^>]*>/gi) ?? []
  if (roots.length !== 1) throw new Error('diagram must contain exactly one data-kun-diagram-root')
  const svg = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(html)
  if (!svg) throw new Error('diagram must contain inline SVG')
  if (!/\brole\s*=\s*(["'])img\1/i.test(svg[1] ?? '') || !/\baria-labelledby\s*=\s*(["'])[^"']+\1/i.test(svg[1] ?? '')) throw new Error('diagram SVG must have role="img" and aria-labelledby')
  if (!/^\s*<title\b[^>]*>[^<]+<\/title>\s*<desc\b[^>]*>[^<]+<\/desc>/i.test(svg[2] ?? '')) throw new Error('diagram SVG must begin with non-empty title and desc')
  html = html.replace(CSP_META_RE, '')
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'">'
  return `${html.replace(/<head\b([^>]*)>/i, `<head$1>\n  ${csp}`)}\n`
}

function normalizeViewport(value: unknown): { width: number; height: number } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const width = typeof record.width === 'number' && Number.isInteger(record.width) ? record.width : 960
  const height = typeof record.height === 'number' && Number.isInteger(record.height) ? record.height : 600
  if (width < 280 || width > 1600 || height < 240 || height > 1200) throw new Error('viewport is out of range')
  return { width, height }
}

function string(value: unknown, field: string, max: number): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`${field} is required`)
  if (normalized.length > max) throw new Error(`${field} exceeds ${max} characters`)
  return normalized
}
function optionalString(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T | undefined { return values.includes(value as T) ? value as T : undefined }
function buildDiagramDesignerPrompt(input: {
  request: string
  title: string
  diagramType: string
  sizePreset: string
  viewport: { width: number; height: number }
}): string {
  return [
    `Create the diagram requested below: ${input.request}`,
    `Title: ${input.title}. Type: ${input.diagramType}. Size preset: ${input.sizePreset}. Viewport: ${input.viewport.width}x${input.viewport.height}.`,
    'Write exactly diagram.html in the assigned workspace. It must be complete standalone HTML with one data-kun-diagram-root, one inline SVG, role="img", aria-labelledby, non-empty title and desc, and no script, remote URL, embed, storage, or external resource.',
    'Do not touch any other file; do not modify source code, graph state, or conversation history.'
  ].join('\\n')
}

function output(payload: DiagramPayload): { status: DiagramPayload['status']; summary?: string; error?: string; diagramPrototype: DiagramPayload } {
  return { status: payload.status, ...(payload.summary ? { summary: payload.summary } : {}), ...(payload.error ? { error: payload.error } : {}), diagramPrototype: payload }
}
function failed(error: string, base?: Omit<DiagramPayload, 'status'>): { output: Record<string, unknown>; isError: true } {
  return { output: base ? output({ ...base, status: 'failed', error }) : { status: 'failed', error }, isError: true }
}
