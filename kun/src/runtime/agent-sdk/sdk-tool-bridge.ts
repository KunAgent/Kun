/**
 * Re-exposes kun's own tools to the Claude Agent SDK as in-process MCP tools.
 * This is the inbound half of the fusion: the SDK owns the loop, but when the
 * model calls one of kun's tools the handler runs kun's real executor in-process
 * — so generate_image, computer_use, memory, web search, delegate_task (and thus
 * kun's richer subagents), etc. all keep working on a subscription turn.
 *
 * Decision (per design): tools that OVERLAP Claude Code's built-ins
 * (read/bash/edit/write/grep/find/ls) are NOT bridged — the model uses the SDK's
 * native ones. We only bridge kun-EXCLUSIVE tools. `delegate_task` is bridged
 * rather than mapped to the SDK `agents` option because kun's delegation is
 * richer (async detach, live profile overlays, per-child deny-lists).
 *
 * The selection + result-mapping + handler wiring is pure and unit-tested. The
 * final `toSdkMcpServer` binding (which touches the real SDK) is thin.
 */
import { z } from 'zod'
import type { SdkApi, SdkMcpServerInstance } from './sdk-protocol.js'

/** Structural view of a kun LocalTool (decoupled from kun's tool internals). */
export interface BridgeableTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface KunToolResult {
  output: unknown
  isError?: boolean
}

/** Executes a kun tool by name for the active turn (closes over ToolHostContext). */
export type KunToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<KunToolResult>

export interface SdkToolContent {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface BridgedToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<SdkToolContent>
}

/** kun built-ins that overlap Claude Code built-ins — use the SDK's instead. */
export const DEFAULT_OVERLAP_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls'
])

/**
 * kun tools better handled by the SDK's own surfaces or meaningless here.
 * user_input/request_user_input are excluded so the SDK's native
 * AskUserQuestion + canUseTool flow owns interactive input (avoids two UIs).
 */
export const DEFAULT_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'echo',
  'user_input',
  'request_user_input'
])

export interface SelectBridgeableOptions {
  overlap?: ReadonlySet<string>
  excluded?: ReadonlySet<string>
}

/** Filter a tool catalog down to the kun-exclusive tools worth bridging. */
export function selectBridgeableTools(
  tools: readonly BridgeableTool[],
  opts: SelectBridgeableOptions = {}
): BridgeableTool[] {
  const overlap = opts.overlap ?? DEFAULT_OVERLAP_TOOL_NAMES
  const excluded = opts.excluded ?? DEFAULT_EXCLUDED_TOOL_NAMES
  const seen = new Set<string>()
  const out: BridgeableTool[] = []
  for (const tool of tools) {
    const name = tool.name?.trim()
    if (!name || overlap.has(name) || excluded.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(tool)
  }
  return out
}

/** Collapse a kun tool result into the SDK MCP tool content shape. */
export function mapKunResultToSdkContent(result: KunToolResult): SdkToolContent {
  const text =
    typeof result.output === 'string'
      ? result.output
      : result.output === undefined
        ? ''
        : safeStringify(result.output)
  return { content: [{ type: 'text', text }], ...(result.isError ? { isError: true } : {}) }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Build SDK MCP tool specs whose handlers run kun's executor. A throwing or
 * rejecting executor is surfaced to the model as an error result rather than
 * crashing the SDK turn.
 */
export function buildBridgedToolSpecs(
  tools: readonly BridgeableTool[],
  execute: KunToolExecutor
): BridgedToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (args: Record<string, unknown>): Promise<SdkToolContent> => {
      try {
        const result = await execute(tool.name, args ?? {})
        return mapKunResultToSdkContent(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `kun tool "${tool.name}" failed: ${message}` }],
          isError: true
        }
      }
    }
  }))
}

/**
 * Best-effort JSON-Schema(object) -> Zod raw shape for the SDK `tool()` helper.
 * kun validates arguments inside its own executor, so this only needs to convey
 * the parameter surface to the model; unknown/complex types fall back to a
 * permissive `z.any()`. Top-level only (the SDK tool schema is one object).
 */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): z.ZodRawShape {
  const shape: Record<string, z.ZodTypeAny> = {}
  const properties = (schema?.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const required = new Set((schema?.required as string[] | undefined) ?? [])
  for (const [key, prop] of Object.entries(properties)) {
    let base: z.ZodTypeAny
    switch (prop?.type) {
      case 'string':
        base = z.string()
        break
      case 'number':
      case 'integer':
        base = z.number()
        break
      case 'boolean':
        base = z.boolean()
        break
      case 'array':
        base = z.array(z.any())
        break
      default:
        base = z.any()
    }
    if (typeof prop?.description === 'string') base = base.describe(prop.description)
    shape[key] = required.has(key) ? base : base.optional()
  }
  return shape
}

/**
 * Thin binding to the real SDK: wraps the bridged specs into an in-process MCP
 * server named `kun`. The model sees these as `mcp__kun__<toolName>`.
 * Not unit-tested (needs the real SDK); kept deliberately trivial.
 */
export function toSdkMcpServer(
  sdk: SdkApi,
  specs: readonly BridgedToolSpec[],
  serverName = 'kun'
): SdkMcpServerInstance {
  const tools = specs.map((spec) =>
    sdk.tool(spec.name, spec.description, jsonSchemaToZodShape(spec.inputSchema), async (args) =>
      spec.handler((args ?? {}) as Record<string, unknown>)
    )
  )
  return sdk.createSdkMcpServer({ name: serverName, version: '1.0.0', tools })
}

/** The `mcp__<server>__<tool>` names the model will see, for allowedTools wiring. */
export function bridgedToolModelNames(specs: readonly BridgedToolSpec[], serverName = 'kun'): string[] {
  return specs.map((spec) => `mcp__${serverName}__${spec.name}`)
}
