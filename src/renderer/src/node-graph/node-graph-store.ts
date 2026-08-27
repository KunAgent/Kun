import { create } from 'zustand'
import { fetchNodeGraph, fetchNodeGraphFolder } from './node-graph-client'
import {
  DEFAULT_NODE_GRAPH_SETTINGS,
  MAX_NODE_GRAPH_GROUPS,
  NODE_GRAPH_GROUP_COLORS,
  MAX_NODE_GRAPH_GROUP_MEMBERS,
  nextGroupColor,
  normalizeNodeGraphColor,
  readStoredNodeGraphSettings,
  writeStoredNodeGraphSettings,
  type NodeGraphGroup,
  type NodeGraphSettings
} from './node-graph-settings'
import {
  EMPTY_NODE_GRAPH_PROJECTION,
  type NodeGraphNodeKind,
  type NodeGraphProjection
} from './node-graph-types'

export type NodeGraphStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * What the currently loaded projection describes. The Code graph spans threads
 * and knowledge in a workspace; the Work graph is one directory tree. Keeping
 * the source on the store means Refresh reloads whichever one is on screen.
 */
export type NodeGraphSource =
  | { kind: 'workspace'; workspace: string }
  | { kind: 'folder'; roots: readonly string[] }

export type NodeGraphState = {
  projection: NodeGraphProjection
  status: NodeGraphStatus
  error: string | null
  /** Workspace the loaded projection belongs to; '' means every workspace. */
  workspace: string
  /** What the loaded projection describes, so a refresh reloads the same thing. */
  source: NodeGraphSource
  settings: NodeGraphSettings
  selectedNodeId: string | null
  /** Local-graph anchor. Null renders the global graph. */
  focusNodeId: string | null
  /** Endpoints of the "how are these connected" path query. */
  pathFrom: string | null
  pathTo: string | null
  load: (options?: { workspace?: string; refresh?: boolean }) => Promise<void>
  /** Loads one or more directory trees instead of a workspace projection. */
  loadFolder: (
    roots: readonly string[],
    options?: { refresh?: boolean; background?: boolean }
  ) => Promise<void>
  /** Reloads whichever projection is currently loaded. */
  reload: (options?: { refresh?: boolean; background?: boolean }) => Promise<void>
  /** Whether the Work tab is showing the graph instead of the editor. */
  workGraphOpen: boolean
  toggleWorkGraph: () => void
  patchSettings: (patch: Partial<NodeGraphSettings>) => void
  toggleKind: (kind: NodeGraphNodeKind) => void
  resetSettings: () => void
  addGroup: (input?: Partial<Omit<NodeGraphGroup, 'id'>>) => string | null
  updateGroup: (id: string, patch: Partial<Omit<NodeGraphGroup, 'id'>>) => void
  removeGroup: (id: string) => void
  /** Moves nodes into one group; a node may belong to at most one. */
  assignNodesToGroup: (nodeIds: readonly string[], groupId: string) => void
  clearNodesGroup: (nodeIds: readonly string[]) => void
  /** Creates a group seeded with the given nodes. */
  createGroupForNodes: (nodeIds: readonly string[], name: string, color?: string) => void
  /** Colors nodes directly, reusing or creating a plain group for that color. */
  colorNodes: (nodeIds: readonly string[], color: string) => void
  selectNode: (id: string | null) => void
  focusNode: (id: string | null) => void
  setPathEndpoint: (end: 'from' | 'to', id: string | null) => void
  clearPath: () => void
  /** Replaces every group with one per detected cluster. */
  applyClusterGroups: (clusters: readonly (readonly string[])[]) => void
}


function nextGroupId(groups: readonly NodeGraphGroup[]): string {
  return `group-${Date.now().toString(36)}-${groups.length}`
}

/**
 * Rewrites group membership for `nodeIds` in a single pass: every other group
 * loses them (a node has exactly one colour, so it belongs to one group), and
 * `targetId` gains them. A null target just clears them.
 */
function withGroupMembership(
  groups: readonly NodeGraphGroup[],
  nodeIds: readonly string[],
  targetId: string | null
): NodeGraphGroup[] {
  const moving = new Set(nodeIds)
  if (moving.size === 0) return [...groups]
  let changed = false
  const next = groups.map((group) => {
    if (group.id === targetId) {
      const kept = group.nodeIds.filter((id) => !moving.has(id))
      const room = Math.max(0, MAX_NODE_GRAPH_GROUP_MEMBERS - kept.length)
      const added = [...moving].slice(0, room)
      const nodeIdsNext = [...kept, ...added]
      if (nodeIdsNext.length === group.nodeIds.length &&
          nodeIdsNext.every((id, index) => id === group.nodeIds[index])) {
        return group
      }
      changed = true
      return { ...group, nodeIds: nodeIdsNext }
    }
    if (!group.nodeIds.some((id) => moving.has(id))) return group
    changed = true
    return { ...group, nodeIds: group.nodeIds.filter((id) => !moving.has(id)) }
  })
  return changed ? next : [...groups]
}

/**
 * Whole-projection comparison, minus `builtAt` (which changes on every build
 * and would always report a difference). Everything else — labels, subtitles,
 * paths, timestamps, sizes, states, counts, truncation, diagnostics — is
 * user-visible somewhere (canvas, inspector, insights), so a content-only
 * change with identical topology must still count as a new projection.
 * Comparing serialized forms is safe because the runtime builder is
 * deterministic for a given input.
 */
function sameProjection(left: NodeGraphProjection, right: NodeGraphProjection): boolean {
  if (left.nodes.length !== right.nodes.length) return false
  if (left.edges.length !== right.edges.length) return false
  return JSON.stringify({ ...left, builtAt: '' }) === JSON.stringify({ ...right, builtAt: '' })
}

let loadToken = 0
/** True while a background folder poll is in flight, so polls coalesce. */
let folderPollInFlight = false

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  projection: EMPTY_NODE_GRAPH_PROJECTION,
  status: 'idle',
  error: null,
  workspace: '',
  source: { kind: 'workspace', workspace: '' },
  settings: readStoredNodeGraphSettings(),
  workGraphOpen: false,
  selectedNodeId: null,
  focusNodeId: null,
  pathFrom: null,
  pathTo: null,

  /**
   * Late responses from a superseded request are discarded, so switching
   * workspace mid-load cannot leave the previous graph on screen.
   */
  load: async (options = {}) => {
    const token = ++loadToken
    const workspace = options.workspace ?? get().workspace
    set({
      status: 'loading',
      error: null,
      workspace,
      source: { kind: 'workspace', workspace }
    })
    try {
      const projection = await fetchNodeGraph({
        ...(workspace ? { workspace } : {}),
        includeChangedFiles: get().settings.includeChangedFiles,
        ...(options.refresh ? { refresh: true } : {})
      })
      if (token !== loadToken) return
      const { selectedNodeId, focusNodeId, pathFrom, pathTo } = get()
      const present = new Set(projection.nodes.map((node) => node.id))
      const keep = (id: string | null): string | null =>
        id && present.has(id) ? id : null
      set({
        projection,
        status: 'ready',
        error: null,
        selectedNodeId: keep(selectedNodeId),
        focusNodeId: keep(focusNodeId),
        pathFrom: keep(pathFrom),
        pathTo: keep(pathTo)
      })
    } catch (error) {
      if (token !== loadToken) return
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  loadFolder: async (roots, options = {}) => {
    const background = options.background === true
    // Polls coalesce: while one scan is still running, the next tick is
    // dropped instead of queued. Combined with the token rule below, a scan
    // slower than the poll interval still lands — before, every new poll
    // invalidated the previous one and a large workspace could refresh forever
    // without ever applying a result.
    if (background && folderPollInFlight) return
    // Only a user-visible load supersedes older requests. A background poll
    // adopts the current token, so it can never discard a foreground load —
    // but a foreground load started mid-poll does discard the poll's result.
    const token = background ? loadToken : ++loadToken
    if (background) folderPollInFlight = true
    // A background poll must not flip the UI into its loading state, or the
    // refresh button would spin every few seconds for no user-visible reason.
    set(background
      ? { source: { kind: 'folder', roots } }
      : { status: 'loading', error: null, source: { kind: 'folder', roots } })
    try {
      const projection = await fetchNodeGraphFolder(roots, {
        ...(options.refresh ? { refresh: true } : {})
      })
      if (token !== loadToken) return
      // An unchanged projection keeps its existing object, so nothing
      // downstream recomputes and the force layout never twitches on a poll
      // that found no edits.
      if (background && sameProjection(get().projection, projection)) {
        set({ status: 'ready', error: null })
        return
      }
      const present = new Set(projection.nodes.map((node) => node.id))
      const keep = (id: string | null): string | null => (id && present.has(id) ? id : null)
      const { selectedNodeId, focusNodeId, pathFrom, pathTo } = get()
      set({
        projection,
        status: 'ready',
        error: null,
        selectedNodeId: keep(selectedNodeId),
        focusNodeId: keep(focusNodeId),
        pathFrom: keep(pathFrom),
        pathTo: keep(pathTo)
      })
    } catch (error) {
      if (token !== loadToken) return
      // A failed poll keeps the graph that is on screen; only an explicit load
      // is allowed to replace it with an error state.
      if (background) return
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (background) folderPollInFlight = false
    }
  },

  toggleWorkGraph: () => set((state) => ({ workGraphOpen: !state.workGraphOpen })),

  /** Reloads whichever projection is on screen. */
  reload: async (options = {}) => {
    const source = get().source
    if (source.kind === 'folder') return get().loadFolder(source.roots, options)
    const { background: _background, ...rest } = options
    return get().load({ workspace: source.workspace, ...rest })
  },

  patchSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    writeStoredNodeGraphSettings(settings)
    // The changed-file layer is produced upstream, so toggling it needs a
    // fresh projection rather than a client-side filter pass.
    if (patch.includeChangedFiles !== undefined) void get().reload({ refresh: true })
  },

  toggleKind: (kind) => {
    const settings = get().settings
    get().patchSettings({
      kinds: { ...settings.kinds, [kind]: !settings.kinds[kind] }
    })
  },


  resetSettings: () => {
    const settings = { ...DEFAULT_NODE_GRAPH_SETTINGS }
    set({ settings })
    writeStoredNodeGraphSettings(settings)
  },

  addGroup: (input = {}) => {
    const groups = get().settings.groups
    if (groups.length >= MAX_NODE_GRAPH_GROUPS) return null
    const id = nextGroupId(groups)
    get().patchSettings({
      groups: [
        ...groups,
        {
          id,
          name: input.name ?? '',
          color: normalizeNodeGraphColor(input.color, nextGroupColor(groups)),
          query: input.query ?? '',
          nodeIds: (input.nodeIds ?? []).slice(0, MAX_NODE_GRAPH_GROUP_MEMBERS)
        }
      ]
    })
    return id
  },

  updateGroup: (id, patch) => {
    get().patchSettings({
      groups: get().settings.groups.map((group) =>
        group.id === id
          ? {
              ...group,
              ...patch,
              ...(patch.color !== undefined
                ? { color: normalizeNodeGraphColor(patch.color, group.color) }
                : {})
            }
          : group
      )
    })
  },

  removeGroup: (id) => {
    get().patchSettings({ groups: get().settings.groups.filter((group) => group.id !== id) })
  },

  assignNodesToGroup: (nodeIds, groupId) => {
    const groups = get().settings.groups
    if (!groups.some((group) => group.id === groupId)) return
    get().patchSettings({ groups: withGroupMembership(groups, nodeIds, groupId) })
  },

  clearNodesGroup: (nodeIds) => {
    const groups = get().settings.groups
    const next = withGroupMembership(groups, nodeIds, null)
    if (next === groups) return
    get().patchSettings({ groups: next })
  },

  createGroupForNodes: (nodeIds, name, color) => {
    const groups = get().settings.groups
    if (groups.length >= MAX_NODE_GRAPH_GROUPS) return
    const created: NodeGraphGroup = {
      id: nextGroupId(groups),
      name,
      color: normalizeNodeGraphColor(color, nextGroupColor(groups)),
      query: '',
      nodeIds: []
    }
    get().patchSettings({
      groups: withGroupMembership([...groups, created], nodeIds, created.id)
    })
  },

  colorNodes: (nodeIds, color) => {
    const normalized = normalizeNodeGraphColor(color, color)
    const groups = get().settings.groups
    // Reuse a plain colour group so repeated colouring cannot pile up groups,
    // but never hijack a named or query-driven group the user built.
    const reusable = groups.find(
      (group) => group.color === normalized && !group.name.trim() && !group.query.trim()
    )
    if (reusable) {
      get().patchSettings({ groups: withGroupMembership(groups, nodeIds, reusable.id) })
      return
    }
    if (groups.length >= MAX_NODE_GRAPH_GROUPS) return
    const created: NodeGraphGroup = {
      id: nextGroupId(groups),
      name: '',
      color: normalized,
      query: '',
      nodeIds: []
    }
    get().patchSettings({
      groups: withGroupMembership([...groups, created], nodeIds, created.id)
    })
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  focusNode: (id) => set({ focusNodeId: id, ...(id ? { selectedNodeId: id } : {}) }),

  setPathEndpoint: (end, id) =>
    set(end === 'from' ? { pathFrom: id } : { pathTo: id }),

  clearPath: () => set({ pathFrom: null, pathTo: null }),

  applyClusterGroups: (clusters) => {
    const usable = clusters.filter((members) => members.length > 1)
    if (usable.length === 0) return
    const groups: NodeGraphGroup[] = usable
      .slice(0, MAX_NODE_GRAPH_GROUPS)
      .map((members, index) => ({
        id: `cluster-${index + 1}`,
        name: `Cluster ${index + 1}`,
        color: NODE_GRAPH_GROUP_COLORS[index % NODE_GRAPH_GROUP_COLORS.length]!,
        query: '',
        nodeIds: [...members].slice(0, MAX_NODE_GRAPH_GROUP_MEMBERS)
      }))
    // Clustering owns the whole colour space, so it replaces the group list
    // rather than layering on top of groups the user built by hand.
    get().patchSettings({ groups })
  }
}))
