import { Check, ChevronRight, Clipboard } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './TrajectoryJsonTree.module.css'

type CopyKind = 'value' | 'json' | 'path'

interface TreeNode {
  children: TreeNode[]
  depth: number
  key: string
  parentPath: string | null
  path: string
  value: unknown
}

export function TrajectoryJsonTree({
  value,
  rootName = '$',
  ariaLabel = 'JSON'
}: {
  value: unknown
  rootName?: string
  ariaLabel?: string
}): ReactElement {
  const root = useMemo(() => buildNode(rootName, '$', null, value, 1), [rootName, value])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['$']))
  const [activePath, setActivePath] = useState('$')
  const [copied, setCopied] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useMemo(() => visibleNodes(root, expanded), [expanded, root])

  useEffect(() => {
    setExpanded(new Set(['$']))
    setActivePath('$')
  }, [value])
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const focus = (path: string): void => {
    setActivePath(path)
    queueMicrotask(() => rowRefs.current.get(path)?.focus())
  }
  const toggle = (node: TreeNode, next?: boolean): void => {
    if (!node.children.length) return
    setExpanded((current) => {
      const updated = new Set(current)
      const shouldExpand = next ?? !updated.has(node.path)
      if (shouldExpand) updated.add(node.path)
      else updated.delete(node.path)
      return updated
    })
  }
  const copy = (node: TreeNode, kind: CopyKind): void => {
    const text = kind === 'path'
      ? node.path
      : kind === 'value'
        ? primitiveCopyValue(node.value)
        : safeJson(node.value)
    const showStatus = (id: string, duration: number): void => {
      setCopied(id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), duration)
    }
    const writeText = navigator.clipboard?.writeText
    if (!writeText) {
      showStatus(`${node.path}:${kind}:failed`, 1_500)
      return
    }
    void writeText.call(navigator.clipboard, text)
      .then(() => showStatus(`${node.path}:${kind}`, 900))
      .catch(() => showStatus(`${node.path}:${kind}:failed`, 1_500))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: TreeNode): void => {
    const index = visible.findIndex((entry) => entry.path === node.path)
    if (event.key === 'ArrowDown' && index < visible.length - 1) focus(visible[index + 1]!.path)
    else if (event.key === 'ArrowUp' && index > 0) focus(visible[index - 1]!.path)
    else if (event.key === 'ArrowRight' && node.children.length) {
      if (!expanded.has(node.path)) toggle(node, true)
      else focus(node.children[0]!.path)
    } else if (event.key === 'ArrowLeft') {
      if (node.children.length && expanded.has(node.path)) toggle(node, false)
      else if (node.parentPath) focus(node.parentPath)
    } else if ((event.key === 'Enter' || event.key === ' ') && node.children.length) toggle(node)
    else return
    event.preventDefault()
  }

  return (
    <div className={styles.tree} role="tree" aria-label={ariaLabel}>
      {visible.map((node) => (
        <JsonTreeRow
          key={node.path}
          node={node}
          open={expanded.has(node.path)}
          active={activePath === node.path}
          copied={copied}
          onCopy={copy}
          onFocus={focus}
          onKeyDown={onKeyDown}
          onToggle={toggle}
          setRef={(element) => {
            if (element) rowRefs.current.set(node.path, element)
            else rowRefs.current.delete(node.path)
          }}
        />
      ))}
    </div>
  )
}

function JsonTreeRow({
  node,
  open,
  active,
  copied,
  onCopy,
  onFocus,
  onKeyDown,
  onToggle,
  setRef
}: {
  node: TreeNode
  open: boolean
  active: boolean
  copied: string | null
  onCopy: (node: TreeNode, kind: CopyKind) => void
  onFocus: (path: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: TreeNode) => void
  onToggle: (node: TreeNode) => void
  setRef: (element: HTMLDivElement | null) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const container = isContainer(node.value)
  const expandable = node.children.length > 0
  const type = valueType(node.value)
  const action = (kind: CopyKind, label: string, child: ReactElement | string): ReactElement => (
    <button
      type="button"
      className={styles.copyButton}
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onCopy(node, kind) }}
    >
      {copied === `${node.path}:${kind}`
        ? <Check />
        : copied === `${node.path}:${kind}:failed` ? <span className={styles.copyFailed}>!</span> : child}
    </button>
  )
  return (
    <div
      ref={setRef}
      className={styles.row}
      role="treeitem"
      aria-level={node.depth}
      aria-expanded={expandable ? open : undefined}
      tabIndex={active ? 0 : -1}
      data-path={node.path}
      data-type={type}
      style={{ '--tree-depth': node.depth - 1 } as React.CSSProperties}
      onFocus={() => onFocus(node.path)}
      onKeyDown={(event) => onKeyDown(event, node)}
    >
      <span className={styles.guide} aria-hidden="true" />
      {expandable ? (
        <button type="button" className={styles.nodeButton} onClick={() => onToggle(node)} tabIndex={-1}>
          <ChevronRight className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
          <span className={styles.key}>{node.key}</span>
        </button>
      ) : (
        <span className={styles.nodeLabel}><span className={styles.spacer} /><span className={styles.key}>{node.key}</span></span>
      )}
      <span className={styles.separator}>:</span>
      <code className={styles.value} data-value-type={type}>{displayValue(node.value)}</code>
      <span className={styles.actions}>
        {!container ? action('value', t('trajectoryCopyValue'), <span className={styles.valueGlyph}>v</span>) : null}
        {action('json', t('trajectoryCopyJson'), <Clipboard />)}
        {action('path', t('trajectoryCopyPath'), '$')}
      </span>
    </div>
  )
}

function buildNode(key: string, path: string, parentPath: string | null, value: unknown, depth: number): TreeNode {
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : isObject(value) ? Object.entries(value) : []
  return {
    children: entries.map(([childKey, child]) => buildNode(
      childKey,
      Array.isArray(value) ? `${path}[${childKey}]` : objectPath(path, childKey),
      path,
      child,
      depth + 1
    )),
    depth,
    key,
    parentPath,
    path,
    value
  }
}

function visibleNodes(root: TreeNode, expanded: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    rows.push(node)
    if (expanded.has(node.path)) node.children.forEach(visit)
  }
  visit(root)
  return rows
}

function objectPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isObject(value)
}

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value === 'object' ? 'object' : typeof value
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`
  if (isObject(value)) return `{${Object.keys(value).length}}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'undefined') return 'undefined'
  return String(value)
}

function primitiveCopyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'undefined') return 'undefined'
  return String(value)
}

function safeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? `${entry}n` : entry, 2)
    return serialized ?? String(value)
  } catch {
    return String(value)
  }
}
