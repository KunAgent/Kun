import { NodeGraphProjectionSchema } from '../../contracts/node-graph.js'
import type { NodeGraphService } from '../../node-graph/index.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

/**
 * GET /v1/node-graph
 *
 * Read-only Obsidian-style projection of a workspace: threads, knowledge-base
 * documents and their `[[wikilinks]]`, memories, tags, agents, and changed
 * files. Query params:
 * - `workspace` — restrict to one workspace root (omit for every workspace)
 * - `changed_files=false` — skip the Graph Mode run scan
 * - `refresh=true` — bypass the short projection cache
 */
export async function getNodeGraph(
  service: NodeGraphService | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('node graph projection is not available')
  const url = new URL(request.url)
  const workspace = url.searchParams.get('workspace')?.trim()
  try {
    const projection = await service.project({
      ...(workspace ? { workspace } : {}),
      includeChangedFiles: url.searchParams.get('changed_files') !== 'false',
      refresh: url.searchParams.get('refresh') === 'true'
    })
    return jsonResponse(NodeGraphProjectionSchema.parse(projection))
  } catch (error) {
    return ERRORS.internal(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Requests above this are rejected outright rather than truncated: no client
 * of ours sends this many roots, so such a request is malformed or hostile.
 * Below it, `NodeGraphService` still truncates to its own root cap with a
 * diagnostic, so an over-eager legitimate load degrades instead of failing.
 */
export const MAX_NODE_GRAPH_FOLDER_ROOTS = 64

/**
 * GET /v1/node-graph/folder
 *
 * Folder projection for the Work tab: markdown files in one directory, their
 * `[[wikilinks]]`, and the folders nesting them. Query params:
 * - `root` (required, repeatable, at most 64) — absolute directory paths
 * - `refresh=true` — bypass the short projection cache
 */
export async function getNodeGraphFolder(
  service: NodeGraphService | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('node graph projection is not available')
  const params = new URL(request.url).searchParams
  const roots = params.getAll('root').map((root) => root.trim()).filter(Boolean)
  if (roots.length === 0) return ERRORS.validation('a root query parameter is required')
  if (roots.length > MAX_NODE_GRAPH_FOLDER_ROOTS) {
    return ERRORS.validation(`at most ${MAX_NODE_GRAPH_FOLDER_ROOTS} root parameters are accepted`)
  }
  try {
    const projection = await service.projectFolder(roots, {
      refresh: params.get('refresh') === 'true'
    })
    return jsonResponse(NodeGraphProjectionSchema.parse(projection))
  } catch (error) {
    return ERRORS.internal(error instanceof Error ? error.message : String(error))
  }
}
