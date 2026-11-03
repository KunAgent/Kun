import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../locales/en/common/agent-center.json'
import zh from '../../locales/zh/common/agent-center.json'

/**
 * Every Agent Center string must exist as a plain string in both authored
 * locales. The repository-wide usage test only sees literal keys, and a key
 * that is both a label and a group of labels silently becomes an object, so the
 * dynamic key families and the form's own translator are enumerated here.
 */
type Tree = Record<string, unknown>
const lookup = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((node, part) =>
  node && typeof node === 'object' ? (node as Tree)[part] : undefined, tree)

const STATES = ['detecting', 'notInstalled', 'installing', 'installFailed', 'versionLow', 'adapterMissing', 'available', 'checking', 'ready', 'needsRecheck', 'signedOut', 'connectFailed']
const dynamic = [
  ...['connected', 'available', 'notInstalled'].map((id) => `agentCenter.group.${id}`),
  ...['nativeLogin', 'provider', 'kunGateway'].map((id) => `agentCenter.modeDesc.${id}`),
  ...['signedOut', 'needsRecheck', 'connectFailed', 'versionLow'].flatMap((state) => [`agentCenter.notice.${state}.title`, `agentCenter.notice.${state}.body`]),
  ...['enable', 'recheck', 'cancelCheck', 'login', 'configureProvider', 'docs', 'update', 'install', 'cancelInstall', 'reinstall'].map((kind) => `agentCenter.next.${kind}`),
  ...['derive', 'acp', 'import'].flatMap((kind) => [`agentCenter.addDialog.kind_${kind}.title`, `agentCenter.addDialog.kind_${kind}.desc`]),
  ...['choose', 'form'].map((step) => `agentCenter.addDialog.step_${step}`),
  ...STATES.flatMap((state) => state === 'notInstalled'
    ? ['install', 'docs', 'none'].flatMap((variant) => [`agentCenter.state.${state}.list_${variant}`, `agentCenter.state.${state}.status_${variant}`])
    : [`agentCenter.state.${state}.list`, `agentCenter.state.${state}.status`]),
  'agentCenter.state.ready.statusModels', 'agentCenter.state.needsRecheck.statusChanged',
  ...['starting', 'waiting', 'running', 'verifying', 'switching'].map((phase) => `agentCenter.activity.step.${phase}`),
  ...['update', 'rollback'].flatMap((kind) => ['list', 'status', 'done', 'failed', 'running', 'runningPlain', 'doneDetail', 'failedDetail']
    .map((key) => `agentCenter.activity.${kind}.${key}`)),
  ...['ok', 'failed', 'never'].map((outcome) => `agentCenter.check.${outcome}`)
]

const sourceKeys = (): string[] => {
  const directory = resolve(import.meta.dirname)
  const keys = new Set<string>()
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts')).filter((name) => !name.includes('.test.'))) {
    const text = readFileSync(resolve(directory, file), 'utf8')
    for (const match of text.matchAll(/\b(?:tc|t)\(\s*'(agentCenter\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]!)
  }
  return [...keys]
}

describe('Agent Center resources', () => {
  const keys = [...new Set([...sourceKeys(), ...dynamic])]
  it('finds the literal keys the components use', () => {
    expect(keys.length).toBeGreaterThan(100)
  })
  it.each([['en', en], ['zh', zh]] as const)('has every key as a string in %s', (_locale, tree) => {
    const missing = keys.filter((key) => typeof lookup(tree as Tree, key) !== 'string')
    expect(missing).toEqual([])
  })
  it('has the same keys in both locales', () => {
    const flat = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string' ? [`${prefix}${key}`] : flat(value as Tree, `${prefix}${key}.`))
    expect(flat(zh as Tree).sort()).toEqual(flat(en as Tree).sort())
  })
})
