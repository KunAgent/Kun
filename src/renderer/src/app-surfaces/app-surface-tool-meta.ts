import { GenUiWidgetRefSchema, type GenUiWidgetRef } from '../../../../kun/src/contracts/gen-ui'
import {
  MCP_APP_CONTENT_MAX_BYTES,
  MCP_APP_STRUCTURED_CONTENT_MAX_BYTES,
  parseMcpAppToolOutputMeta,
  type McpAppToolOutputMeta
} from '../../../../kun/src/contracts/mcp-apps'
import type { ToolBlock } from '../agent/types'

const MAX_ARGUMENT_BYTES = 16 * 1024
const MAX_RESULT_META_BYTES = 16 * 1024

type ToolItemLike = {
  kind: string
  toolName?: string
  arguments?: unknown
  output?: unknown
  isError?: boolean
  meta?: unknown
}

export type McpAppBlockMeta = McpAppToolOutputMeta & {
  /** CallToolResult forwarded to the page; oversized fields are dropped and listed. */
  result?: Record<string, unknown>
  omitted?: string[]
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function boundedMcpToolResult(value: unknown): { result?: Record<string, unknown>; omitted: string[] } {
  const source = record(value)
  if (!source) return { omitted: [] }
  const result: Record<string, unknown> = {}
  const omitted: string[] = []
  const keep = (key: string, limit: number): void => {
    if (source[key] === undefined) return
    if (jsonBytes(source[key]) <= limit) result[key] = source[key]
    else omitted.push(key)
  }
  keep('content', MCP_APP_CONTENT_MAX_BYTES)
  keep('structuredContent', MCP_APP_STRUCTURED_CONTENT_MAX_BYTES)
  keep('_meta', MAX_RESULT_META_BYTES)
  if (source.isError === true) result.isError = true
  return { result, omitted }
}

/**
 * Project app-surface metadata from a runtime tool item into its block meta.
 * The runtime puts UI references in the tool-result `meta` sideband; MCP tool
 * arguments come from the matching call item and merge into the same block.
 */
export function applyAppSurfaceToolMeta(meta: Record<string, unknown>, item: ToolItemLike): void {
  if (item.kind === 'tool_call' && item.toolName?.startsWith('mcp_')) {
    const args = item.toolName === 'mcp_call' ? record(record(item.arguments)?.arguments) : record(item.arguments)
    if (args && jsonBytes(args) <= MAX_ARGUMENT_BYTES) meta.mcpAppArguments = args
    return
  }
  if (item.kind !== 'tool_result' || item.isError) return
  const sideband = record(item.meta)
  const genUi = GenUiWidgetRefSchema.safeParse(sideband?.genUi)
  if (genUi.success) meta.genUi = genUi.data
  const mcpApp = parseMcpAppToolOutputMeta(sideband?.mcpApp)
  if (mcpApp) {
    const bounded = boundedMcpToolResult(record(item.output)?.result)
    const value: McpAppBlockMeta = {
      ...mcpApp,
      ...(bounded.result ? { result: bounded.result } : {}),
      ...(bounded.omitted.length ? { omitted: bounded.omitted } : {})
    }
    meta.mcpApp = value
  }
}

export function genUiRefFromBlock(block: ToolBlock): GenUiWidgetRef | null {
  const parsed = GenUiWidgetRefSchema.safeParse(block.meta?.genUi)
  return parsed.success ? parsed.data : null
}

export function mcpAppFromBlock(block: ToolBlock): McpAppBlockMeta | null {
  const meta = parseMcpAppToolOutputMeta(block.meta?.mcpApp)
  if (!meta) return null
  const source = record(block.meta?.mcpApp)
  return {
    ...meta,
    ...(record(source?.result) ? { result: record(source?.result) } : {}),
    ...(Array.isArray(source?.omitted) ? { omitted: source.omitted.filter((entry): entry is string => typeof entry === 'string') } : {})
  }
}

export function mcpAppArgumentsFromBlock(block: ToolBlock): Record<string, unknown> {
  return record(block.meta?.mcpAppArguments) ?? {}
}

export function isAppSurfaceBlock(block: ToolBlock): boolean {
  return block.status === 'success' && (Boolean(genUiRefFromBlock(block)) || Boolean(mcpAppFromBlock(block)))
}
