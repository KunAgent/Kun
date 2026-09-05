import type { ModelRequestTraceToolCatalogEntry } from './model-request-traces'

export type ToolProvenanceSource = 'kun' | 'mcp' | 'extension' | 'unclassified'
export type ToolProvenanceCategory =
  | 'kun-core'
  | 'kun-gui'
  | 'kun-runtime'
  | 'mcp-server'
  | 'extension-provider'
  | 'unknown'
export type ToolProvenanceManagement = 'kun-managed' | 'discovery'

export type ToolProvenance = {
  source: ToolProvenanceSource
  category: ToolProvenanceCategory
  providerKind?: string
  providerId?: string
  providerName?: string
  management?: ToolProvenanceManagement
  inferred: boolean
}

export type ToolWithProvenance = {
  name: string
  provenance: ToolProvenance
}

export type ToolProvenanceSubgroup<T extends ToolWithProvenance> = {
  id: string
  category: ToolProvenanceCategory
  providerName?: string
  management?: ToolProvenanceManagement
  tools: T[]
}

export type ToolProvenanceGroup<T extends ToolWithProvenance> = {
  source: ToolProvenanceSource
  tools: T[]
  subgroups: ToolProvenanceSubgroup<T>[]
}

const SOURCE_ORDER: readonly ToolProvenanceSource[] = [
  'kun', 'mcp', 'extension', 'unclassified'
]
const KUN_CATEGORY_ORDER: readonly ToolProvenanceCategory[] = [
  'kun-core', 'kun-gui', 'kun-runtime'
]
const RUNTIME_PROVIDER_KINDS = new Set([
  'web', 'skill', 'memory', 'delegation', 'image', 'audio', 'video'
])
const LEGACY_KUN_CORE_TOOLS = new Set([
  'read', 'bash', 'background_shell', 'edit', 'write', 'grep', 'find', 'ls', 'lsp',
  'repo_map', 'git_inspect', 'verify_changes', 'send_im_attachment', 'echo', 'user_input',
  'request_user_input', 'create_plan', 'read_artifact', 'task_graph'
])
const LEGACY_KUN_GUI_TOOLS = new Set([
  'computer_use', 'browser_use', 'get_goal', 'create_goal', 'update_goal', 'todo_list', 'todo_write'
])
const LEGACY_KUN_RUNTIME_TOOLS = new Set([
  'web_search', 'web_fetch', 'load_skill', 'memory_create', 'memory_update',
  'memory_delete', 'delegate_task', 'fast_context', 'generate_image', 'generate_speech',
  'generate_music', 'generate_video'
])

export function resolveToolProvenance(
  toolName: string,
  catalog: readonly ModelRequestTraceToolCatalogEntry[] | undefined
): ToolProvenance {
  if (catalog !== undefined) {
    const matches = catalog.filter((tool) => tool.name === toolName)
    return matches.length === 1
      ? exactProvenance(matches[0])
      : unknownProvenance(false)
  }
  return inferLegacyProvenance(toolName)
}

export function groupToolsByProvenance<T extends ToolWithProvenance>(
  tools: readonly T[]
): ToolProvenanceGroup<T>[] {
  const bySource = new Map<ToolProvenanceSource, T[]>()
  for (const tool of tools) {
    const bucket = bySource.get(tool.provenance.source) ?? []
    bucket.push(tool)
    bySource.set(tool.provenance.source, bucket)
  }
  return SOURCE_ORDER.flatMap((source) => {
    const sourceTools = bySource.get(source)
    if (!sourceTools?.length) return []
    const sorted = [...sourceTools].sort((left, right) => left.name.localeCompare(right.name))
    return [{ source, tools: sorted, subgroups: buildSubgroups(source, sorted) }]
  })
}

function exactProvenance(entry: ModelRequestTraceToolCatalogEntry): ToolProvenance {
  const providerKind = entry.providerKind?.trim()
  const providerId = entry.providerId?.trim()
  if (providerKind === 'built-in') {
    return provenance('kun', 'kun-core', providerKind, providerId)
  }
  if (providerKind === 'gui') {
    return provenance('kun', 'kun-gui', providerKind, providerId)
  }
  if (providerKind && RUNTIME_PROVIDER_KINDS.has(providerKind)) {
    return provenance('kun', 'kun-runtime', providerKind, providerId)
  }
  if (providerKind === 'mcp') {
    const providerName = providerId?.startsWith('mcp:')
      ? providerId.slice('mcp:'.length) || undefined
      : providerId
    // `github` is deliberately not inferred here: a user override has the
    // same provider id, so ownership must not be guessed from its name alone.
    const management = providerName === 'gui_schedule'
      ? 'kun-managed'
      : providerName === 'search' || providerName === 'facade'
        ? 'discovery'
        : undefined
    return {
      ...provenance('mcp', 'mcp-server', providerKind, providerId),
      ...(providerName ? { providerName } : {}),
      ...(management ? { management } : {})
    }
  }
  if (providerKind === 'extension') {
    const providerName = providerId?.startsWith('extension:')
      ? providerId.slice('extension:'.length) || undefined
      : providerId
    return {
      ...provenance('extension', 'extension-provider', providerKind, providerId),
      ...(providerName ? { providerName } : {})
    }
  }
  return {
    ...unknownProvenance(false),
    ...(providerKind ? { providerKind } : {}),
    ...(providerId ? { providerId, providerName: providerId } : {})
  }
}

function inferLegacyProvenance(toolName: string): ToolProvenance {
  if (toolName.startsWith('mcp_')) {
    return {
      source: 'mcp',
      category: 'mcp-server',
      inferred: true
    }
  }
  if (LEGACY_KUN_CORE_TOOLS.has(toolName)) {
    return { source: 'kun', category: 'kun-core', inferred: true }
  }
  if (LEGACY_KUN_GUI_TOOLS.has(toolName) || toolName.startsWith('design_') || toolName === 'ppt_to_board') {
    return { source: 'kun', category: 'kun-gui', inferred: true }
  }
  if (LEGACY_KUN_RUNTIME_TOOLS.has(toolName)) {
    return { source: 'kun', category: 'kun-runtime', inferred: true }
  }
  return unknownProvenance(true)
}

function provenance(
  source: ToolProvenanceSource,
  category: ToolProvenanceCategory,
  providerKind?: string,
  providerId?: string
): ToolProvenance {
  return {
    source,
    category,
    ...(providerKind ? { providerKind } : {}),
    ...(providerId ? { providerId } : {}),
    inferred: false
  }
}

function unknownProvenance(inferred: boolean): ToolProvenance {
  return { source: 'unclassified', category: 'unknown', inferred }
}

function buildSubgroups<T extends ToolWithProvenance>(
  source: ToolProvenanceSource,
  tools: readonly T[]
): ToolProvenanceSubgroup<T>[] {
  if (source === 'kun') {
    return KUN_CATEGORY_ORDER.flatMap((category) => {
      const matches = tools.filter((tool) => tool.provenance.category === category)
      return matches.length ? [{ id: category, category, tools: [...matches] }] : []
    })
  }
  const buckets = new Map<string, ToolProvenanceSubgroup<T>>()
  for (const tool of tools) {
    const providerName = tool.provenance.providerName
    const id = `${tool.provenance.category}:${providerName ?? 'unknown'}`
    const existing = buckets.get(id)
    if (existing) {
      existing.tools.push(tool)
      if (!existing.management && tool.provenance.management) {
        existing.management = tool.provenance.management
      }
      continue
    }
    buckets.set(id, {
      id,
      category: tool.provenance.category,
      ...(providerName ? { providerName } : {}),
      ...(tool.provenance.management ? { management: tool.provenance.management } : {}),
      tools: [tool]
    })
  }
  return [...buckets.values()].sort((left, right) => (
    (left.providerName ?? '').localeCompare(right.providerName ?? '') || left.id.localeCompare(right.id)
  ))
}
