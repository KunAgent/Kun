import type { NodeGraphNode, NodeGraphNodeKind } from './node-graph-types'

/**
 * Obsidian-style graph query. Whitespace separates AND terms; a leading `-`
 * negates a term. Field terms are supported so groups and the filter box can
 * target structure rather than only text:
 *
 *   `kind:document`  `path:docs/`  `folder:notes`  `tag:testing`
 *   `state:running`  `workspace:/repo`  `link` (plain substring)
 */
export type NodeGraphQueryTerm = {
  field: 'kind' | 'path' | 'folder' | 'tag' | 'state' | 'workspace' | 'text'
  value: string
  negated: boolean
}

const FIELDS: Record<string, NodeGraphQueryTerm['field']> = {
  kind: 'kind',
  path: 'path',
  folder: 'folder',
  tag: 'tag',
  state: 'state',
  workspace: 'workspace'
}

export function parseNodeGraphQuery(query: string): NodeGraphQueryTerm[] {
  const terms: NodeGraphQueryTerm[] = []
  for (const raw of query.trim().toLocaleLowerCase().split(/\s+/)) {
    if (!raw) continue
    const negated = raw.startsWith('-')
    const body = negated ? raw.slice(1) : raw
    if (!body) continue
    const separator = body.indexOf(':')
    const field = separator > 0 ? FIELDS[body.slice(0, separator)] : undefined
    if (field && separator + 1 < body.length) {
      terms.push({ field, value: body.slice(separator + 1), negated })
    } else {
      terms.push({ field: 'text', value: body, negated })
    }
  }
  return terms
}

function termMatches(node: NodeGraphNode, term: NodeGraphQueryTerm): boolean {
  const value = term.value
  switch (term.field) {
    case 'kind':
      return node.kind.toLocaleLowerCase() === value
    case 'path':
      return (node.path ?? '').toLocaleLowerCase().includes(value)
    case 'folder': {
      const folder = (node.folder ?? '').toLocaleLowerCase()
      return folder === value || folder.startsWith(value.endsWith('/') ? value : `${value}/`)
    }
    case 'tag':
      return (node.tag ?? '').toLocaleLowerCase() === value.replace(/^#/, '')
    case 'state':
      return (node.state ?? '').toLocaleLowerCase() === value
    case 'workspace':
      return (node.workspace ?? '').toLocaleLowerCase().includes(value)
    case 'text':
      return [node.label, node.subtitle, node.path, node.tag]
        .some((field) => (field ?? '').toLocaleLowerCase().includes(value))
  }
}

/** An empty query matches nothing, so a blank group never colors the graph. */
export function matchesNodeGraphQuery(node: NodeGraphNode, terms: readonly NodeGraphQueryTerm[]): boolean {
  if (terms.length === 0) return false
  return terms.every((term) => termMatches(node, term) !== term.negated)
}

export function nodeGraphKindQuery(kind: NodeGraphNodeKind): string {
  return `kind:${kind}`
}
