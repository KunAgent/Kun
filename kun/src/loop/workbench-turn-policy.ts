import { isAbsolute, relative, resolve } from 'node:path'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { intersectAllowedToolNames } from './continuation-instructions.js'

const union = (...lists: Array<readonly string[] | undefined>) => [...new Set(lists.flatMap((list) => list ?? []))]
const contains = (root: string, path: string) => {
  const value = relative(root, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

/** Common discovery/execution ceiling, also used by delegated native tool bridges. */
export function applyWorkbenchToolPolicy(context: ToolHostContext, thread: ThreadRecord): ToolHostContext {
  const policy = thread.workbenchOrigin?.capabilityCeiling
  if (!policy) return context
  const paths = (left?: readonly string[], right?: readonly string[]) => {
    if (left === undefined) return right
    if (right === undefined) return left
    return union(left.flatMap((a) => right.flatMap((b) => {
      const parent = resolve(thread.workspace, a), child = resolve(thread.workspace, b)
      return contains(parent, child) ? [b] : contains(child, parent) ? [a] : []
    })))
  }
  const providers = union(policy.blockedProviderIds, policy.blockedProviderIds.map((id) => id.startsWith('mcp:') ? id : `mcp:${id}`))
  return { ...context,
    allowedToolNames: intersectAllowedToolNames(context.allowedToolNames, policy.allowedToolNames),
    allowedProviderIds: intersectAllowedToolNames(context.allowedProviderIds, policy.allowedProviderIds),
    allowedSkillIds: policy.skillsEnabled === false ? [] : intersectAllowedToolNames(context.allowedSkillIds, policy.allowedSkillIds),
    allowedReadPaths: paths(context.allowedReadPaths, policy.allowedReadPaths),
    allowedWritePaths: paths(context.allowedWritePaths, policy.allowedWritePaths),
    ...(policy.allowedReadPaths !== undefined ? { allowHostReads: undefined } : {}),
    blockedProviderIds: union(context.blockedProviderIds, providers),
    blockedToolNames: union(context.blockedToolNames, policy.blockedToolNames,
      policy.skillsEnabled === false ? ['load_skill', 'load_skill_asset'] : []),
    blockedSkillIds: union(context.blockedSkillIds, policy.blockedSkillIds) }
}
